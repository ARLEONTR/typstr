import { useState, useEffect } from 'react';
import { useGemini } from '../../hooks/useGemini';
import { useGeminiContext } from '../../context/GeminiContext';
import { getGeminiModels, collaborateWithAI, getAiApiKeyStatus, getAiHistory } from '../../api/gemini';
import type { AiCollaborationEditedFile, AiCollaborationProjectFile, ProjectEcosystemState } from '../../types';
import { Check, Settings, Sparkles, RefreshCw, ChevronUp, X, Brain, Bot, Users, AlertTriangle, FileText } from '../../icons';
import styles from './EditorPage.module.css';

interface Props {
  context: string;
  activeSource: string;
  projectId: string;
  fileId: string;
  ecosystem: ProjectEcosystemState | null;
  onSaveSettings: (settings: any) => Promise<any>;
  onAddBibEntry: (entry: string) => Promise<void>;
  onCreateComment: (excerpt: string, content: string) => Promise<void>;
  onSuggestDocumentEdits: (editedDocument: string) => number;
  onSuggestProjectEdits: (editedFiles: AiCollaborationEditedFile[]) => { editCount: number; filePaths: string[] };
  loadProjectFilesForAi: () => Promise<AiCollaborationProjectFile[]>;
  aiEditCount?: number;
  aiEditFileCount?: number;
  onAcceptAllAiEdits?: () => void;
  onRejectAllAiEdits?: () => void;
  onClose?: () => void;
  inSidebar?: boolean;
}

interface GeminiModel {
  id: string;
  name: string;
  description: string;
}

export function GeminiPanel({
  context,
  activeSource,
  projectId,
  fileId,
  ecosystem,
  onSaveSettings,
  onAddBibEntry,
  onCreateComment,
  onSuggestDocumentEdits,
  onSuggestProjectEdits,
  loadProjectFilesForAi,
  aiEditCount = 0,
  aiEditFileCount = 0,
  onAcceptAllAiEdits,
  onRejectAllAiEdits,
  onClose,
  inSidebar = false,
}: Props) {
  const { generate, loading } = useGemini();
  const { isCoAuthorEnabled, setIsCoAuthorEnabled, sessionUsage, messages, setMessages, provider, setProvider } = useGeminiContext();
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [availableModels, setAvailableModels] = useState<GeminiModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isAutomating, setIsAutomating] = useState<'bib' | 'comments' | 'collab' | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<{ gemini: boolean; anthropic: boolean; openai: boolean }>({ gemini: false, anthropic: false, openai: false });

  const aiSettings = ecosystem?.settings.aiSettings ?? {
    model: '',
    systemInstructions: null
  };

  const [selectedModel, setSelectedModel] = useState(aiSettings.model);
  const [claudeModel, setClaudeModel] = useState('claude-sonnet-4-6');
  const [chatgptModel, setChatgptModel] = useState('gpt-4o');
  const [instructions, setInstructions] = useState(aiSettings.systemInstructions ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const CLAUDE_MODELS = [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (recommended)' },
    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
  ];

  const CHATGPT_MODELS = [
    { id: 'gpt-4o', name: 'GPT-4o (recommended)' },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'o1', name: 'o1' },
    { id: 'o1-mini', name: 'o1-mini' },
  ];

  useEffect(() => {
    setSelectedModel(aiSettings.model);
    setInstructions(aiSettings.systemInstructions ?? '');
  }, [aiSettings.model, aiSettings.systemInstructions]);

  useEffect(() => {
    if (showSettings && availableModels.length === 0 && provider === 'gemini') {
      fetchModels();
    }
  }, [showSettings, availableModels.length, provider]);

  useEffect(() => {
    if (!showSettings) return;
    void getAiApiKeyStatus()
      .then(setApiKeyStatus)
      .catch(() => undefined);
  }, [showSettings]);

  useEffect(() => {
    void getAiHistory(projectId, fileId, provider)
      .then(({ messages: hist, historyDisabled }) => {
        if (historyDisabled || hist.length === 0) return;
        setMessages(hist.map(m => ({ role: m.role, text: m.content })));
      })
      .catch(() => undefined);
  }, [projectId, fileId, provider]);

  const fetchModels = async () => {
    setIsLoadingModels(true);
    try {
      const models = await getGeminiModels();
      setAvailableModels(models);
    } catch (e) {
      console.error('Failed to fetch Gemini models', e);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const activeModel = provider === 'claude' ? claudeModel : provider === 'chatgpt' ? chatgptModel : undefined;

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMessage = input;
    setInput('');
    try {
      await generate(userMessage, context, projectId, activeModel, fileId);
    } catch (e) {
      console.error('AI generation failed', e);
    }
  };

  const saveAiSettings = async () => {
    setIsSaving(true);
    try {
      await onSaveSettings({
        aiSettings: {
          model: selectedModel,
          systemInstructions: instructions.trim() || null
        }
      });
      setShowSettings(false);
    } catch (e) {
      console.error('Failed to save AI settings', e);
    } finally {
      setIsSaving(false);
    }
  };

  const automateBibliography = async () => {
    setIsAutomating('bib');
    setMessages((prev) => [...prev, { role: 'user', text: 'Automate Bibliography: Scan document and propose references.' }]);
    try {
      const prompt = `Based on the provided document context, identify topics or statements that require academic citations.
      Generate a set of high-quality BibTeX entries that would be appropriate for this document.
      Return the result ONLY as a JSON array of strings, where each string is a complete BibTeX entry.
      Example: ["@article{key, ...}", "@book{key, ...}"]`;

      const response = await generate(prompt, context, projectId, activeModel, fileId);

      const startIdx = response.indexOf('[');
      const endIdx = response.lastIndexOf(']');

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const jsonStr = response.substring(startIdx, endIdx + 1);
        const entries = JSON.parse(jsonStr) as string[];
        if (entries.length > 0) {
          await onAddBibEntry(entries.join('\n\n'));
        }
        setMessages((prev) => [...prev, { role: 'user', text: prompt }, { role: 'ai', text: `Successfully identified and added ${entries.length} references to your bibliography.` }]);
      } else {
        setMessages((prev) => [...prev, { role: 'user', text: prompt }, { role: 'ai', text: 'AI suggested some references, but I could not parse them into BibTeX format automatically.' }]);
      }
    } catch (e) {
      console.error('Automation failed', e);
    } finally {
      setIsAutomating(null);
    }
  };

  const automateComments = async () => {
    setIsAutomating('comments');
    setMessages((prev) => [...prev, { role: 'user', text: 'Automate Review: Scan document and add review comments.' }]);
    try {
      const prompt = `Review the active document content. Identify areas for improvement (clarity, grammar, technical accuracy, or structural issues).
      Provide a set of review comments.
      Return the result ONLY as a JSON array of objects with "excerpt" (the exact text to comment on) and "content" (your feedback).
      Example: [{"excerpt": "some text", "content": "This could be clearer..."}]`;

      const response = await generate(prompt, context, projectId, activeModel, fileId);

      const startIdx = response.indexOf('[');
      const endIdx = response.lastIndexOf(']');

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const jsonStr = response.substring(startIdx, endIdx + 1);
        const proposals = JSON.parse(jsonStr) as Array<{ excerpt: string; content: string }>;
        let count = 0;
        for (const prop of proposals) {
          if (prop.excerpt && prop.content) {
            await onCreateComment(prop.excerpt, prop.content);
            count++;
          }
        }
        setMessages((prev) => [...prev, { role: 'user', text: prompt }, { role: 'ai', text: `Successfully added ${count} review comments to your document.` }]);
      } else {
        setMessages((prev) => [...prev, { role: 'user', text: prompt }, { role: 'ai', text: 'AI provided some feedback, but I could not automatically place it as comments.' }]);
      }
    } catch (e) {
      console.error('Automation failed', e);
    } finally {
      setIsAutomating(null);
    }
  };

  const handleCollaborate = async () => {
    if (!input.trim() || loading || !!isAutomating) return;
    const prompt = input.trim();
    setInput('');
    setIsAutomating('collab');
    setMessages((prev) => [...prev, { role: 'user', text: `Collaborate: ${prompt}` }]);
    try {
      const projectFiles = await loadProjectFilesForAi();
      const result = await collaborateWithAI(fileId, prompt, provider, activeModel, activeSource, projectFiles);
      const summary = result.files?.length
        ? onSuggestProjectEdits(result.files)
        : { editCount: result.content ? onSuggestDocumentEdits(result.content) : 0, filePaths: [] };
      const fileList = summary.filePaths.slice(0, 3).join(', ');
      const fileSuffix = summary.filePaths.length > 0
        ? ` across ${summary.filePaths.length} file${summary.filePaths.length === 1 ? '' : 's'}${fileList ? `: ${fileList}${summary.filePaths.length > 3 ? ', ...' : ''}` : ''}`
        : '';
      setMessages((prev) => [...prev, {
        role: 'ai',
        text: summary.editCount > 0
          ? `I prepared ${summary.editCount} suggested edit${summary.editCount === 1 ? '' : 's'}${fileSuffix}. Use the green check to keep an edit or the red X to reject it.`
          : 'I reviewed the document and did not find any text changes to suggest.',
      }]);
    } catch (e: any) {
      const message = e?.response?.data?.error || e?.message || 'Collaboration failed.';
      setMessages((prev) => [...prev, { role: 'ai', text: `⚠️ ${message}` }]);
    } finally {
      setIsAutomating(null);
    }
  };

  return (
    <div className={inSidebar ? styles.themePanel : styles.sidebarSection} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className={inSidebar ? styles.panelHeader : ''} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={18} color="var(--accent)" />
          <span className={styles.sidebarLabel}>AI Writing Assistant</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={styles.sidebarIconBtn}
            title="AI Settings"
            style={{
              background: showSettings ? 'var(--action-bg-hover)' : 'transparent',
              color: showSettings ? 'var(--text-bright)' : 'inherit'
            }}
          >
            {showSettings ? <ChevronUp size={16} /> : <Settings size={16} />}
          </button>
          {!inSidebar && onClose && (
            <button className={styles.sidebarIconBtn} onClick={onClose} title="Close">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {aiEditCount > 0 ? (
        <div className={styles.aiEditSummary}>
          <span>{aiEditCount} pending AI edit{aiEditCount === 1 ? '' : 's'}{aiEditFileCount > 1 ? ` in ${aiEditFileCount} files` : ''}</span>
          <div className={styles.aiEditSummaryActions}>
            <button
              className={styles.aiEditAcceptBtn}
              onClick={onAcceptAllAiEdits}
              title="Accept all AI edits"
              aria-label="Accept all AI edits"
            >
              <Check size={15} aria-hidden />
            </button>
            <button
              className={styles.aiEditRejectBtn}
              onClick={onRejectAllAiEdits}
              title="Reject all AI edits"
              aria-label="Reject all AI edits"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {showSettings && (
        <div style={{
          background: 'var(--card-bg)',
          padding: '12px',
          borderRadius: '12px',
          marginBottom: '16px',
          fontSize: '13px',
          border: '1px solid var(--panel-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, color: 'var(--text-bright)' }}>Provider</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['gemini', 'claude', 'chatgpt'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  style={{
                    flex: 1,
                    padding: '6px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    background: provider === p ? 'var(--accent-strong)' : 'var(--editor-bg)',
                    color: provider === p ? 'white' : 'var(--text-soft)',
                    border: '1px solid var(--panel-border)',
                    cursor: 'pointer'
                  }}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {provider === 'gemini' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: apiKeyStatus.gemini ? 'var(--success)' : 'var(--muted-text)', flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: 'var(--text-soft)' }}>
                    {apiKeyStatus.gemini ? 'Google AI API key connected.' : 'No Google AI API key. Using OAuth quota.'}
                  </span>
                </div>
                <a
                  href="/"
                  style={{ fontSize: '12px', color: 'var(--accent)', textDecoration: 'none' }}
                >
                  Manage API keys in Account Settings →
                </a>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontWeight: 500, color: 'var(--text-bright)' }}>Gemini Model</label>
                  <button
                    onClick={(e) => { e.preventDefault(); fetchModels(); }}
                    disabled={isLoadingModels}
                    title="Refresh models"
                    style={{ background: 'transparent', border: 'none', color: 'var(--muted-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
                  >
                    <RefreshCw size={12} className={isLoadingModels ? styles.spin : ''} />
                  </button>
                </div>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '8px',
                    background: 'var(--editor-bg)',
                    border: '1px solid var(--panel-border)',
                    color: 'var(--text-bright)',
                    fontSize: '12px'
                  }}
                >
                  <option value="">Auto (Most efficient available)</option>
                  {availableModels.length > 0 && availableModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {(provider === 'claude' || provider === 'chatgpt') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: (provider === 'claude' ? apiKeyStatus.anthropic : apiKeyStatus.openai) ? 'var(--success)' : 'var(--muted-text)', flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: 'var(--text-soft)' }}>
                    {provider === 'claude'
                      ? (apiKeyStatus.anthropic ? 'Anthropic key connected.' : 'No Anthropic key.')
                      : (apiKeyStatus.openai ? 'OpenAI key connected.' : 'No OpenAI key.')}
                  </span>
                </div>
                <a href="/" style={{ fontSize: '12px', color: 'var(--accent)', textDecoration: 'none' }}>
                  Manage API keys in Account Settings →
                </a>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, color: 'var(--text-bright)' }}>Model</label>
                <select
                  value={provider === 'claude' ? claudeModel : chatgptModel}
                  onChange={(e) => provider === 'claude' ? setClaudeModel(e.target.value) : setChatgptModel(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', background: 'var(--editor-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-bright)', fontSize: '12px' }}
                >
                  {(provider === 'claude' ? CLAUDE_MODELS : CHATGPT_MODELS).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, color: 'var(--text-bright)' }}>System Instructions</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. You are an expert academic writer. Use formal tone..."
              style={{
                width: '100%',
                height: '80px',
                padding: '8px',
                borderRadius: '8px',
                background: 'var(--editor-bg)',
                border: '1px solid var(--panel-border)',
                color: 'var(--text-bright)',
                resize: 'vertical',
                fontSize: '12px',
                fontFamily: 'inherit'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button
              onClick={() => setShowSettings(false)}
              title="Cancel settings"
              aria-label="Cancel settings"
              className={styles.panelIconBtn}
            >
              <X size={16} aria-hidden />
            </button>
            <button
              onClick={saveAiSettings}
              disabled={isSaving}
              title={isSaving ? 'Saving AI settings' : 'Save AI settings'}
              aria-label={isSaving ? 'Saving AI settings' : 'Save AI settings'}
              className={styles.primaryIconBtn}
            >
              {isSaving ? <RefreshCw size={16} className={styles.spin} aria-hidden /> : <Check size={16} aria-hidden />}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', padding: '10px 12px', background: 'var(--card-bg)', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Brain size={16} color="var(--accent)" />
          <span style={{ fontSize: '13px', color: 'var(--text-soft)' }}>Co-author Mode</span>
        </div>
        <button
          onClick={() => setIsCoAuthorEnabled(!isCoAuthorEnabled)}
          title={isCoAuthorEnabled ? 'Disable co-author mode' : 'Enable co-author mode'}
          aria-label={isCoAuthorEnabled ? 'Disable co-author mode' : 'Enable co-author mode'}
          style={{
            width: '34px',
            height: '34px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            borderRadius: '8px',
            fontWeight: 600,
            cursor: 'pointer',
            background: isCoAuthorEnabled ? 'var(--accent-strong)' : 'transparent',
            color: 'white',
            border: isCoAuthorEnabled ? 'none' : '1px solid var(--panel-border)',
            transition: 'all 0.2s ease'
          }}
        >
          <Brain size={15} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          onClick={automateBibliography}
          disabled={loading || !!isAutomating}
          className={styles.sidebarMiniBtn}
          style={{ flex: 1, fontSize: '10px', padding: '6px' }}
          title="AI scans your doc and adds relevant BibTeX entries"
          aria-label="Auto-cite document"
        >
          {isAutomating === 'bib' ? <RefreshCw size={15} className={styles.spin} aria-hidden /> : <FileText size={15} aria-hidden />}
        </button>
        <button
          onClick={automateComments}
          disabled={loading || !!isAutomating}
          className={styles.sidebarMiniBtn}
          style={{ flex: 1, fontSize: '10px', padding: '6px' }}
          title="AI reviews your doc and adds inline comments"
          aria-label="Auto-review document"
        >
          {isAutomating === 'comments' ? <RefreshCw size={15} className={styles.spin} aria-hidden /> : <AlertTriangle size={15} aria-hidden />}
        </button>
        <button
          onClick={handleCollaborate}
          disabled={loading || !!isAutomating || !input.trim()}
          className={styles.sidebarMiniBtn}
          style={{ flex: 1, fontSize: '10px', padding: '6px', background: input.trim() ? 'var(--action-bg)' : undefined }}
          title="AI joins the document and applies changes directly"
          aria-label="Collaborate on document"
        >
          {isAutomating === 'collab' ? <RefreshCw size={15} className={styles.spin} aria-hidden /> : <Users size={15} aria-hidden />}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '12px', fontSize: '13px', minHeight: '100px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.length === 0 && !showSettings && (
          <div style={{ color: 'var(--muted-text)', textAlign: 'center', marginTop: '40px', fontSize: '12px', padding: '0 20px', lineHeight: 1.5 }}>
            Ask the AI to help with your document or enable Co-author mode for automatic suggestions.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            padding: '10px',
            borderRadius: '10px',
            background: m.role === 'user' ? 'var(--action-bg)' : 'transparent',
            border: m.role === 'ai' ? '1px solid var(--panel-border)' : '1px solid transparent'
          }}>
            <div style={{
              fontWeight: 700,
              fontSize: '10px',
              textTransform: 'uppercase',
              color: m.role === 'user' ? 'var(--accent)' : 'var(--success)',
              marginBottom: '4px',
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              {m.role === 'user' ? <Users size={10} /> : <Bot size={10} />}
              {m.role === 'user' ? 'You' : provider.toUpperCase()}
            </div>
            <div style={{ color: 'var(--text-soft)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.text}</div>
          </div>
        ))}
        {loading && <div style={{ color: 'var(--muted-text)', fontStyle: 'italic', fontSize: '12px', paddingLeft: '10px' }}>AI is thinking...</div>}
      </div>

      <div style={{
        padding: '12px',
        fontSize: '10px',
        color: 'var(--muted-text)',
        background: 'var(--sidebar-bg)',
        borderRadius: '12px',
        marginBottom: '12px',
        border: '1px solid var(--panel-border)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span>Session Usage: <strong>{sessionUsage.totalTokenCount.toLocaleString()}</strong> tokens</span>
          <span title="Models have different limits, usually 128k to 2M tokens.">Quota: Active</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 }}>
          <AlertTriangle size={12} />
          <span>Using <strong>{provider.toUpperCase()}</strong></span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'auto', padding: '2px' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Ask AI..."
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'var(--editor-bg)',
            border: '1px solid var(--panel-border)',
            color: 'var(--text-bright)',
            fontSize: '13px',
            boxSizing: 'border-box'
          }}
        />
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={sendMessage}
            disabled={loading || !!isAutomating || !input.trim()}
            title="Send message (chat only)"
            aria-label="Send AI message"
            style={{
              width: '36px',
              flex: '0 0 auto',
              height: '36px',
              borderRadius: '10px',
              background: 'var(--accent-strong)',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 600,
              opacity: (loading || !!isAutomating || !input.trim()) ? 0.5 : 1,
              transition: 'opacity 0.2s'
            }}
          >
            <Sparkles size={14} aria-hidden />
          </button>
          <button
            onClick={handleCollaborate}
            disabled={loading || !!isAutomating || !input.trim()}
            title="AI applies changes directly to your document"
            aria-label="Apply AI changes to document"
            style={{
              width: '36px',
              flex: '0 0 auto',
              height: '36px',
              borderRadius: '10px',
              background: 'var(--card-bg)',
              color: 'var(--text-bright)',
              border: '1px solid var(--panel-border)',
              cursor: (loading || !!isAutomating || !input.trim()) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 600,
              opacity: (loading || !!isAutomating || !input.trim()) ? 0.4 : 1,
              transition: 'opacity 0.2s'
            }}
          >
            <FileText size={14} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
