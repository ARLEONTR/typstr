import { createContext, useContext, useState, type ReactNode } from 'react';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export type AIProvider = 'gemini' | 'claude' | 'chatgpt';

interface GeminiContextType {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  isChatOpen: boolean;
  setIsChatOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isCoAuthorEnabled: boolean;
  setIsCoAuthorEnabled: (enabled: boolean) => void;
  sessionUsage: UsageMetadata;
  setSessionUsage: React.Dispatch<React.SetStateAction<UsageMetadata>>;
  provider: AIProvider;
  setProvider: (provider: AIProvider) => void;
}

const GeminiContext = createContext<GeminiContextType | undefined>(undefined);

export const GeminiProvider = ({ children }: { children: ReactNode }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isCoAuthorEnabled, setIsCoAuthorEnabled] = useState(false);
  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [sessionUsage, setSessionUsage] = useState<UsageMetadata>({
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0
  });

  return (
    <GeminiContext.Provider value={{ 
      messages, 
      setMessages, 
      isChatOpen, 
      setIsChatOpen,
      isCoAuthorEnabled,
      setIsCoAuthorEnabled,
      sessionUsage,
      setSessionUsage,
      provider,
      setProvider
    }}>
      {children}
    </GeminiContext.Provider>
  );
};

export const useGeminiContext = () => {
  const context = useContext(GeminiContext);
  if (!context) throw new Error('useGeminiContext must be used within GeminiProvider');
  return context;
};
