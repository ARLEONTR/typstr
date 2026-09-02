import { useState } from 'react';
import { askGemini, askClaude, askChatGPT } from '../api/gemini';
import { useGeminiContext } from '../context/GeminiContext';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

export function useGemini() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { messages, setMessages, setSessionUsage, provider } = useGeminiContext();

  const generate = async (prompt: string, context?: string, projectId?: string, model?: string, fileId?: string) => {
    setLoading(true);
    setError(null);
    try {
      let response;
      if (provider === 'claude') {
        response = await askClaude(prompt, context, model, projectId, fileId);
      } else if (provider === 'chatgpt') {
        response = await askChatGPT(prompt, context, model, projectId, fileId);
      } else {
        response = await askGemini(prompt, context, projectId, fileId);
      }
      
      // Update history
      setMessages((prev: Message[]) => [...prev, { role: 'user', text: prompt }, { role: 'ai', text: response.text }]);
      
      // Update session usage
      if (response.usage) {
        setSessionUsage(prev => ({
          promptTokenCount: prev.promptTokenCount + (response.usage!.promptTokenCount || 0),
          candidatesTokenCount: prev.candidatesTokenCount + (response.usage!.candidatesTokenCount || 0),
          totalTokenCount: prev.totalTokenCount + (response.usage!.totalTokenCount || 0),
        }));
      }

      return response.text;
    } catch (e: any) {
      const serverMsg = e?.response?.data?.error;
      const code = e?.response?.data?.code;
      const status = e?.response?.status;
      const baseMsg = serverMsg || (e instanceof Error ? e.message : 'Failed to generate content');
      const friendly = code === 'gemini_rate_limited' || status === 429
        ? `${baseMsg}`
        : baseMsg;
      setError(friendly);
      // Surface the failure inline in the chat so the user sees it next to the prompt that triggered it.
      setMessages((prev: Message[]) => [...prev, { role: 'user', text: prompt }, { role: 'ai', text: `⚠️ ${friendly}` }]);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  return { generate, loading, error, messages };
}
