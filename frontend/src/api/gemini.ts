import { apiClient } from './client';
import type { AiCollaborationProjectFile, AiCollaborationResponse } from '../types';

export interface GeminiResponse {
  text: string;
  usage?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export async function getGeminiModels(): Promise<Array<{ id: string; name: string; description: string }>> {
  const response = await apiClient.get<{ models: Array<{ id: string; name: string; description: string }> }>('/api/ai/models');
  return response.data.models;
}

export async function askGemini(prompt: string, context?: string, projectId?: string, fileId?: string): Promise<GeminiResponse> {
  const response = await apiClient.post<GeminiResponse>('/api/ai/gemini', {
    prompt,
    context,
    projectId,
    fileId,
  });
  return response.data;
}

export async function askClaude(prompt: string, context?: string, model?: string, projectId?: string, fileId?: string): Promise<GeminiResponse> {
  const response = await apiClient.post<GeminiResponse>('/api/ai/claude', {
    prompt,
    context,
    model,
    projectId,
    fileId,
  });
  return response.data;
}

export async function askChatGPT(prompt: string, context?: string, model?: string, projectId?: string, fileId?: string): Promise<GeminiResponse> {
  const response = await apiClient.post<GeminiResponse>('/api/ai/chatgpt', {
    prompt,
    context,
    model,
    projectId,
    fileId,
  });
  return response.data;
}

export interface AiHistoryMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  provider: string;
  createdAt: number;
}

export async function getAiHistory(projectId: string, fileId?: string, provider?: string): Promise<{ messages: AiHistoryMessage[]; historyDisabled?: boolean }> {
  const params = new URLSearchParams({ projectId });
  if (fileId) params.set('fileId', fileId);
  if (provider) params.set('provider', provider);
  const response = await apiClient.get<{ messages: AiHistoryMessage[]; historyDisabled?: boolean }>(`/api/ai/history?${params}`);
  return response.data;
}

export async function getAiApiKeyStatus(): Promise<{ gemini: boolean; anthropic: boolean; openai: boolean }> {
  const response = await apiClient.get<{ gemini: boolean; anthropic: boolean; openai: boolean }>('/api/ai/keys');
  return response.data;
}

export async function saveAiApiKey(provider: 'gemini' | 'anthropic' | 'openai', apiKey: string): Promise<void> {
  await apiClient.put(`/api/ai/keys/${provider}`, { apiKey });
}

export async function deleteAiApiKey(provider: 'gemini' | 'anthropic' | 'openai'): Promise<void> {
  await apiClient.delete(`/api/ai/keys/${provider}`);
}

export async function collaborateWithAI(
  fileId: string,
  prompt: string,
  provider: 'gemini' | 'claude' | 'chatgpt',
  model?: string,
  source?: string,
  files?: AiCollaborationProjectFile[],
): Promise<AiCollaborationResponse> {
  const response = await apiClient.post<AiCollaborationResponse>('/api/ai/collaborate', {
    fileId,
    prompt,
    provider,
    model,
    source,
    files,
    mode: 'suggest',
  });
  return response.data;
}
