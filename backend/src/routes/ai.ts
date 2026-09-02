import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { OAuth2Client } from 'google-auth-library';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { env } from '../env.js';
import { getUserRefreshToken, getUserAiApiKey, updateUserAiApiKey, getProjectEcosystemSettings, canAccessProject, getProjectFileForUser, saveAiMessage, getAiMessages } from '../db.js';
import { getAuthenticatedUser } from '../auth.js';
import { aiCollaborateOnDocument } from '../services/aiCollaborator.js';
import { getBillingStatus, consumeAiRequestQuota, getAiHistoryCutoff } from '../services/billing.js';

export const aiRouter = Router();
const oauth2Client = new OAuth2Client(
  env.googleClientId,
  env.googleClientSecret,
  env.googleCallbackUrl
);

// In-memory cache for model discovery. Each Gemini API call counts against
// quota, and discovery hits both v1 and v1beta — so an uncached endpoint call
// costs 3 quota units instead of 1. Model list rarely changes.
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const modelDiscoveryCache = new Map<string, { models: any[]; expiresAt: number }>();

const GEMINI_FALLBACK_MODELS = [
  {
    id: 'gemini-2.5-flash',
    fullName: 'models/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast general-purpose Gemini model.',
  },
  {
    id: 'gemini-2.5-pro',
    fullName: 'models/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Higher-capability Gemini model for more complex tasks.',
  },
];

function modelCacheKey(accessToken: string | null, apiKey?: string | null): string {
  if (apiKey) return `apikey:${apiKey.slice(0, 8)}`;
  if (accessToken) return `oauth:${accessToken.slice(0, 16)}`;
  return 'anon';
}

function pickRateLimitFallbackModel(currentModel: string, availableModels: Array<{ id: string }>): string | null {
  const normalizedCurrent = currentModel.toLowerCase();
  if (normalizedCurrent.includes('flash')) return null;

  const flashModel = availableModels.find((model) => model.id !== currentModel && model.id.toLowerCase().includes('flash'));
  return flashModel?.id ?? null;
}

// Helper to get compatible models with token-efficiency sorting
async function getAvailableModels(accessToken: string | null, userApiKey?: string | null): Promise<any[]> {
  const resolvedKey = userApiKey ?? null;
  const cacheKey = modelCacheKey(accessToken, resolvedKey);
  const cached = modelDiscoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }

  // Model discovery uses the API key only — the peruserquota OAuth scope does
  // not grant permission to list models, only to call generateContent.
  const fetchFromVersion = async (version: string) => {
    if (!resolvedKey) return null;
    const url = `https://generativelanguage.googleapis.com/${version}/models?key=${resolvedKey}`;
    const resp = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`Gemini: Model list ${version} failed ${resp.status}:`, body);
      return null;
    }
    return resp.json();
  };

  try {
    const data = await fetchFromVersion('v1');
    if (!data) {
      return accessToken ? GEMINI_FALLBACK_MODELS : [];
    }

    let allModels = data.models || [];
    
    // Supplement with v1beta to find experimental/newest models
    try {
      const betaData = await fetchFromVersion('v1beta');
      const betaModels = betaData.models || [];
      const existingNames = new Set(allModels.map((m: any) => m.name));
      for (const bm of betaModels) {
        if (!existingNames.has(bm.name)) allModels.push(bm);
      }
    } catch (e) {
      console.warn('Gemini: Could not supplement with v1beta models');
    }

    const filtered = allModels
      .filter((m: any) => {
        const isCompatible = m.supportedGenerationMethods?.includes('generateContent') && 
                            m.name?.includes('models/gemini-') &&
                            !m.name?.includes('-tuning');
        if (isCompatible) {
          console.log(`Gemini Discovery: Found compatible model ${m.name} (${m.displayName})`);
        }
        return isCompatible;
      })
      .map((m: any) => ({
        id: m.name.split('/').pop(),
        fullName: m.name, // "models/"
        name: m.displayName,
        description: m.description
      }))
      .sort((a: any, b: any) => {
        const getScore = (id: string) => {
          const lower = id.toLowerCase();
          if (lower.includes('lite')) return 1;
          if (lower.includes('flash')) return 2;
          if (lower.includes('pro')) return 3;
          return 4;
        };
        return getScore(a.id) - getScore(b.id);
      });

    console.log(`Gemini: Discovered ${filtered.length} models. First: ${filtered[0]?.fullName}`);
    if (filtered.length > 0) {
      modelDiscoveryCache.set(cacheKey, { models: filtered, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
      return filtered;
    }

    if (accessToken) {
      console.warn('Gemini: Discovery returned no compatible models; using OAuth fallback model list.');
      return GEMINI_FALLBACK_MODELS;
    }

    return filtered;
  } catch (e) {
    console.error('Gemini: Error in model discovery:', e);
    return accessToken ? GEMINI_FALLBACK_MODELS : [];
  }
}

aiRouter.get('/models', async (req: Request, res: Response, next) => {
  try {
    const user = req.user as { id: string } | undefined;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const userGeminiApiKey = await getUserAiApiKey(user.id, 'gemini');

    let accessToken: string | null = null;
    if (!userGeminiApiKey) {
      const refreshToken = await getUserRefreshToken(user.id);
      if (refreshToken) {
        try {
          oauth2Client.setCredentials({ refresh_token: refreshToken });
          const { token } = await oauth2Client.getAccessToken();
          accessToken = token ?? null;
        } catch (e) {
          console.error('Gemini: Failed to refresh token for model list:', e);
        }
      }
    }

    const models = await getAvailableModels(accessToken, userGeminiApiKey);
    res.json({ models: models.map(m => ({ id: m.id, name: m.name, description: m.description })) });
  } catch (error) {
    next(error);
  }
});

aiRouter.get('/history', async (req: Request, res: Response, next) => {
  try {
    const user = req.user as { id: string } | undefined;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { projectId, fileId, provider } = req.query as Record<string, string | undefined>;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const billingStatus = await getBillingStatus(user.id);
    const cutoff = getAiHistoryCutoff(billingStatus.limits);
    if (cutoff === -1) {
      return res.json({ messages: [], historyDisabled: true });
    }

    const messages = await getAiMessages({
      userId: user.id,
      projectId,
      fileId: fileId ?? undefined,
      provider: provider ?? undefined,
      sinceTimestamp: cutoff ?? undefined,
      limit: 200,
    });
    res.json({ messages });
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/gemini', async (req: Request, res: Response, next) => {
  try {
    const { prompt, context, projectId } = req.body;
    const user = req.user as { id: string } | undefined;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    await consumeAiRequestQuota(user.id);

    const fileId = typeof req.body.fileId === 'string' ? req.body.fileId : null;

    // Load prior turns for multi-turn conversation
    let priorMessages: Array<{ role: 'user' | 'ai'; content: string }> = [];
    if (projectId) {
      const hist = await getAiMessages({ userId: user.id, projectId, fileId: fileId ?? undefined, provider: 'gemini', limit: 40 });
      priorMessages = hist.map(m => ({ role: m.role, content: m.content }));
    }

    const saveAndRespond = async (payload: { text: string; usage?: unknown }) => {
      if (projectId) {
        await Promise.all([
          saveAiMessage({ userId: user.id, projectId, fileId, provider: 'gemini', role: 'user', content: prompt }),
          saveAiMessage({ userId: user.id, projectId, fileId, provider: 'gemini', role: 'ai', content: payload.text }),
        ]).catch(e => console.error('AI message save failed:', e));
      }
      return res.json(payload);
    };

    // Prefer user's own API key; fall back to Google OAuth token.
    const userGeminiApiKey = await getUserAiApiKey(user.id, 'gemini');

    let accessToken: string | null = null;
    if (!userGeminiApiKey) {
      const refreshToken = await getUserRefreshToken(user.id);
      if (refreshToken) {
        try {
          oauth2Client.setCredentials({ refresh_token: refreshToken });
          const { token } = await oauth2Client.getAccessToken();
          accessToken = token ?? null;
        } catch (e) {
          console.error('Gemini: Token refresh failed:', e);
        }
      }
    }

    if (!userGeminiApiKey && !accessToken) {
      return res.status(403).json({
        error: 'Add your Google AI API key in AI settings to use Gemini.',
        code: 'user_gemini_key_required',
      });
    }

    const availableModels = await getAvailableModels(userGeminiApiKey ? null : accessToken, userGeminiApiKey);

    let modelName = '';
    let systemInstruction: string | undefined = undefined;

    if (projectId) {
      try {
        const settings = await getProjectEcosystemSettings(projectId);
        if (settings.aiSettings?.model) {
          const stored = settings.aiSettings.model.split('/').pop() || '';
          if (stored && availableModels.some(m => m.id === stored)) {
            modelName = stored;
          } else if (stored) {
            console.warn(`Gemini: Stored model "${stored}" not in discovered list; falling back to discovery.`);
          }
          systemInstruction = settings.aiSettings.systemInstructions || undefined;
        }
      } catch (e) {
        console.warn('Gemini: Error fetching project settings');
      }
    }

    if (!modelName && availableModels.length > 0) {
      modelName = availableModels[0].id;
    }

    if (!modelName) {
      modelName = 'gemini-2.5-flash';
    }

    const currentPrompt = context ? `Context:\n${context}\n\nTask: ${prompt}` : prompt;
    // Gemini role mapping: 'user' → 'user', 'ai' → 'model'
    const geminiHistory = priorMessages.map(m => ({
      role: m.role === 'ai' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const rateLimitFallbackModel = pickRateLimitFallbackModel(modelName, availableModels);

    const isRateLimited = (err: any) => err?.status === 429 || /\b429\b|rate.?limit|quota/i.test(err?.message ?? '');
    const rateLimitError = () => {
      const e: any = new Error('Gemini rate limit reached. Please wait a minute and try again — the free tier has tight per-minute quotas.');
      e.status = 429;
      e.code = 'gemini_rate_limited';
      return e;
    };

    // SDK path — user's own API key
    if (userGeminiApiKey) {
      const genAI = new GoogleGenerativeAI(userGeminiApiKey);

      const runSdkRequest = async (requestedModel: string) => {
        console.log(`Gemini: SDK Request (user key). Model: ${requestedModel}`);
        const model = genAI.getGenerativeModel({ model: requestedModel, systemInstruction }, { apiVersion: 'v1beta' });
        try {
          const chat = model.startChat({ history: geminiHistory });
          const result = await chat.sendMessage(currentPrompt);
          const response = await result.response;
          return { text: response.text(), usage: response.usageMetadata };
        } catch (sdkError: any) {
          if (isRateLimited(sdkError)) throw rateLimitError();
          if (sdkError.message?.includes('404')) {
            console.warn(`Gemini: v1beta failed for ${requestedModel}, retrying with v1...`);
            const v1Model = genAI.getGenerativeModel({ model: requestedModel, systemInstruction });
            try {
              const chat = v1Model.startChat({ history: geminiHistory });
              const v1Result = await chat.sendMessage(currentPrompt);
              const v1Response = await v1Result.response;
              return { text: v1Response.text(), usage: v1Response.usageMetadata };
            } catch (v1Error: any) {
              if (isRateLimited(v1Error)) throw rateLimitError();
              throw v1Error;
            }
          }
          throw sdkError;
        }
      };

      try {
        return saveAndRespond(await runSdkRequest(modelName));
      } catch (sdkError: any) {
        if (sdkError?.code === 'gemini_rate_limited' && rateLimitFallbackModel) {
          console.warn(`Gemini: Rate limited on ${modelName}, retrying with ${rateLimitFallbackModel}...`);
          return saveAndRespond(await runSdkRequest(rateLimitFallbackModel));
        }
        throw sdkError;
      }
    }

    // OAuth path — Google account token (build multi-turn contents array)
    const oauthContents = [
      ...geminiHistory,
      { role: 'user', parts: [{ text: currentPrompt }] },
    ];
    const body: any = { contents: oauthContents };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

    const runOauthRequest = async (requestedModel: string) => {
      console.log(`Gemini: OAuth fetch. Model: ${requestedModel}`);
      const tryFetch = async (version: string) => {
        const url = `https://generativelanguage.googleapis.com/${version}/models/${requestedModel}:generateContent`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        return { ok: resp.ok, status: resp.status, data };
      };

      let result = await tryFetch('v1beta');
      if (!result.ok && result.status === 404) {
        console.warn(`Gemini: OAuth v1beta failed for ${requestedModel}, retrying v1...`);
        result = await tryFetch('v1');
      }

      if (!result.ok) {
        if (result.status === 429) throw rateLimitError();
        console.error('Gemini API Final Error:', JSON.stringify(result.data, null, 2));
        throw new Error(result.data?.error?.message || `Gemini API Error (${result.status})`);
      }

      const text = result.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini returned an empty response.');
      return { text, usage: result.data.usageMetadata };
    };

    try {
      return saveAndRespond(await runOauthRequest(modelName));
    } catch (oauthError: any) {
      if (oauthError?.code === 'gemini_rate_limited' && rateLimitFallbackModel) {
        console.warn(`Gemini: Rate limited on ${modelName}, retrying with ${rateLimitFallbackModel}...`);
        return saveAndRespond(await runOauthRequest(rateLimitFallbackModel));
      }
      throw oauthError;
    }
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/claude', async (req: Request, res: Response, next) => {
  try {
    const { prompt, context, model, projectId, fileId } = req.body;
    const user = req.user as { id: string } | undefined;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    await consumeAiRequestQuota(user.id);

    const apiKey = await getUserAiApiKey(user.id, 'anthropic');
    if (!apiKey) {
      return res.status(403).json({
        error: 'Add your Anthropic API key in AI settings before using Claude.',
        code: 'user_anthropic_key_required',
      });
    }

    const anthropic = new Anthropic({ apiKey });
    const firstUserPrompt = context ? `Context:\n${context}\n\nTask: ${prompt}` : prompt;

    // Load prior turns; inject context only into first user message if no history yet
    let priorMessages: Array<{ role: 'user' | 'ai'; content: string }> = [];
    if (projectId) {
      const hist = await getAiMessages({ userId: user.id, projectId, fileId: fileId ?? undefined, provider: 'claude', limit: 40 });
      priorMessages = hist.map(m => ({ role: m.role, content: m.content }));
    }
    const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...priorMessages.map(m => ({ role: (m.role === 'ai' ? 'assistant' : 'user') as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: firstUserPrompt },
    ];

    try {
      const response = await anthropic.messages.create({
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: claudeMessages,
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      if (projectId) {
        await Promise.all([
          saveAiMessage({ userId: user.id, projectId, fileId: fileId ?? null, provider: 'claude', role: 'user', content: prompt }),
          saveAiMessage({ userId: user.id, projectId, fileId: fileId ?? null, provider: 'claude', role: 'ai', content: text }),
        ]).catch(e => console.error('AI message save failed:', e));
      }
      res.json({ text, usage: response.usage });
    } catch (apiError: any) {
      const msg = apiError?.error?.error?.message || apiError?.message || '';
      if (apiError?.status === 400 && msg.toLowerCase().includes('credit balance')) {
        return res.status(402).json({
          error: 'Your Anthropic credit balance is too low. Please add credits at console.anthropic.com/settings/billing.',
          code: 'anthropic_insufficient_credits',
        });
      }
      if (apiError?.status === 401) {
        return res.status(401).json({
          error: 'Invalid Anthropic API key. Please update your key in AI settings.',
          code: 'anthropic_invalid_key',
        });
      }
      throw apiError;
    }
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/chatgpt', async (req: Request, res: Response, next) => {
  try {
    const { prompt, context, model, projectId, fileId } = req.body;
    const user = req.user as { id: string } | undefined;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    await consumeAiRequestQuota(user.id);

    const apiKey = await getUserAiApiKey(user.id, 'openai');
    if (!apiKey) {
      return res.status(403).json({
        error: 'Add your OpenAI API key in AI settings before using ChatGPT.',
        code: 'user_openai_key_required',
      });
    }

    const openai = new OpenAI({ apiKey });
    const firstUserPrompt = context ? `Context:\n${context}\n\nTask: ${prompt}` : prompt;

    // Load prior turns for multi-turn conversation
    let priorMessages: Array<{ role: 'user' | 'ai'; content: string }> = [];
    if (projectId) {
      const hist = await getAiMessages({ userId: user.id, projectId, fileId: fileId ?? undefined, provider: 'chatgpt', limit: 40 });
      priorMessages = hist.map(m => ({ role: m.role, content: m.content }));
    }
    const openaiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...priorMessages.map(m => ({ role: (m.role === 'ai' ? 'assistant' : 'user') as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: firstUserPrompt },
    ];

    try {
      const response = await openai.chat.completions.create({
        model: model || 'gpt-4o',
        messages: openaiMessages,
      });

      const text = response.choices[0].message.content ?? '';
      if (projectId) {
        await Promise.all([
          saveAiMessage({ userId: user.id, projectId, fileId: fileId ?? null, provider: 'chatgpt', role: 'user', content: prompt }),
          saveAiMessage({ userId: user.id, projectId, fileId: fileId ?? null, provider: 'chatgpt', role: 'ai', content: text }),
        ]).catch(e => console.error('AI message save failed:', e));
      }
      res.json({
        text,
        usage: {
          promptTokenCount: response.usage?.prompt_tokens,
          candidatesTokenCount: response.usage?.completion_tokens,
          totalTokenCount: response.usage?.total_tokens,
        }
      });
    } catch (apiError: any) {
      const code = apiError?.error?.code || apiError?.code || '';
      const status = apiError?.status;
      if (status === 429) {
        return res.status(402).json({
          error: 'Your OpenAI quota is exceeded. Please check your plan and add credits at platform.openai.com/settings/billing.',
          code: 'openai_insufficient_credits',
        });
      }
      if (status === 401) {
        return res.status(401).json({
          error: 'Invalid OpenAI API key. Please update your key in AI settings.',
          code: 'openai_invalid_key',
        });
      }
      throw apiError;
    }
  } catch (error) {
    next(error);
  }
});

aiRouter.get('/keys', async (req: Request, res: Response) => {
  const user = req.user as { id: string } | undefined;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const [gemini, anthropic, openai] = await Promise.all([
    getUserAiApiKey(user.id, 'gemini'),
    getUserAiApiKey(user.id, 'anthropic'),
    getUserAiApiKey(user.id, 'openai'),
  ]);

  res.json({
    gemini: Boolean(gemini),
    anthropic: Boolean(anthropic),
    openai: Boolean(openai),
  });
});

aiRouter.put('/keys/:provider', async (req: Request, res: Response) => {
  const user = req.user as { id: string } | undefined;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const provider = req.params.provider;
  if (provider !== 'gemini' && provider !== 'anthropic' && provider !== 'openai') {
    return res.status(400).json({ error: 'Provider must be gemini, anthropic, or openai.' });
  }

  const apiKey = typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '';
  if (!apiKey) {
    return res.status(400).json({ error: 'API key is required.' });
  }
  if (apiKey.length > 500) {
    return res.status(400).json({ error: 'API key is too long.' });
  }

  await updateUserAiApiKey(user.id, provider, apiKey);
  if (req.user) {
    (req.user as any).aiApiKeys = {
      ...((req.user as any).aiApiKeys ?? {}),
      [provider]: true,
    };
  }
  res.json({ saved: true, provider });
});

aiRouter.delete('/keys/:provider', async (req: Request, res: Response) => {
  const user = req.user as { id: string } | undefined;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const provider = req.params.provider;
  if (provider !== 'gemini' && provider !== 'anthropic' && provider !== 'openai') {
    return res.status(400).json({ error: 'Provider must be gemini, anthropic, or openai.' });
  }

  await updateUserAiApiKey(user.id, provider, null);
  if (req.user) {
    (req.user as any).aiApiKeys = {
      ...((req.user as any).aiApiKeys ?? {}),
      [provider]: false,
    };
  }
  res.json({ deleted: true, provider });
});

aiRouter.post('/collaborate', async (req: Request, res: Response, next) => {
  try {
    const user = getAuthenticatedUser(req);
    const { fileId, prompt, provider, model, source, files } = req.body;
    
    if (!fileId || !prompt) {
      return res.status(400).json({ error: 'fileId and prompt are required' });
    }
    if (typeof source === 'string' && source.length > 2_000_000) {
      return res.status(400).json({ error: 'Source must be at most 2000000 characters' });
    }
    if (files !== undefined && !Array.isArray(files)) {
      return res.status(400).json({ error: 'files must be an array when provided' });
    }
    if (Array.isArray(files)) {
      let totalSourceLength = 0;
      for (const entry of files) {
        if (!entry || typeof entry !== 'object') {
          return res.status(400).json({ error: 'files must contain file objects' });
        }
        const content = (entry as { content?: unknown }).content;
        if (typeof content === 'string') {
          totalSourceLength += content.length;
          if (content.length > 2_000_000) {
            return res.status(400).json({ error: 'Each source file must be at most 2000000 characters' });
          }
        }
      }
      if (totalSourceLength > 8_000_000) {
        return res.status(400).json({ error: 'AI collaboration project context must be at most 8000000 characters' });
      }
    }
    const normalizedProvider =
      provider === 'chatgpt' || provider === 'openai' ? 'openai' :
      provider === 'claude' || provider === 'anthropic' ? 'anthropic' :
      provider === 'gemini' ? 'gemini' : null;
    if (!normalizedProvider) {
      return res.status(400).json({ error: 'AI collaboration requires a valid provider (gemini, claude, or chatgpt) with your API key.' });
    }

    const file = await getProjectFileForUser(fileId, user.id);
    if (!file || !(await canAccessProject(file.projectId, user.id, 'editor'))) {
      return res.status(403).json({ error: 'Editor access required' });
    }

    const apiKey = await getUserAiApiKey(user.id, normalizedProvider);
    if (!apiKey) {
      return res.status(403).json({
        error: normalizedProvider === 'anthropic'
          ? 'Add your Anthropic API key in AI settings before using Claude collaboration.'
          : normalizedProvider === 'openai'
          ? 'Add your OpenAI API key in AI settings before using ChatGPT collaboration.'
          : 'Add your Google AI API key in AI settings before using Gemini collaboration.',
      });
    }

    try {
      const result = await aiCollaborateOnDocument(fileId, prompt, {
        provider: normalizedProvider,
        apiKey,
        model: typeof model === 'string' ? model : undefined,
        source: typeof source === 'string' ? source : undefined,
        files: Array.isArray(files) ? files : undefined,
        apply: req.body.mode !== 'suggest',
      });
      res.json(result);
    } catch (apiError: any) {
      const status = apiError?.status;
      const msg = apiError?.error?.error?.message || apiError?.message || '';
      if (normalizedProvider === 'anthropic') {
        if (status === 400 && msg.toLowerCase().includes('credit balance')) {
          return res.status(402).json({ error: 'Your Anthropic credit balance is too low. Please add credits at console.anthropic.com/settings/billing.', code: 'anthropic_insufficient_credits' });
        }
        if (status === 401) return res.status(401).json({ error: 'Invalid Anthropic API key. Please update your key in AI settings.', code: 'anthropic_invalid_key' });
      } else if (normalizedProvider === 'openai') {
        if (status === 429) return res.status(402).json({ error: 'Your OpenAI quota is exceeded. Please check your plan and add credits at platform.openai.com/settings/billing.', code: 'openai_insufficient_credits' });
        if (status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key. Please update your key in AI settings.', code: 'openai_invalid_key' });
      }
      throw apiError;
    }
  } catch (error) {
    next(error);
  }
});
