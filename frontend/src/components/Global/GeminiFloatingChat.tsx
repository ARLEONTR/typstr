import { useState } from 'react';
import { useGemini } from '../../hooks/useGemini';
import { useGeminiContext } from '../../context/GeminiContext';

export function GeminiFloatingChat() {
  const { messages, isChatOpen, setIsChatOpen } = useGeminiContext();
  const { generate, loading, error } = useGemini();
  const [input, setInput] = useState('');

  if (!isChatOpen) {
    return (
      <button
        onClick={() => setIsChatOpen(true)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          padding: '16px',
          borderRadius: '50%',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          border: 'none',
          boxShadow: 'var(--surface-shadow-soft)',
          cursor: 'pointer',
          zIndex: 1000,
        }}
      >
        AI
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '80px',
      right: '24px',
      width: '350px',
      height: '500px',
      background: 'var(--card-bg)',
      borderRadius: '8px',
      boxShadow: 'var(--surface-shadow)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
      color: 'var(--on-accent)',
      border: '1px solid var(--panel-border)',
    }}>
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--panel-border)' }}>
        <strong>Gemini Chat</strong>
        <button onClick={() => setIsChatOpen(false)} style={{ cursor: 'pointer', border: 'none', background: 'none', color: 'var(--on-accent)' }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', fontSize: '13px' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: '12px', color: m.role === 'user' ? 'var(--accent)' : 'var(--text-bright)' }}>
            <strong>{m.role === 'user' ? 'You' : 'Gemini'}:</strong> {m.text}
          </div>
        ))}
        {loading && <div style={{ color: 'var(--muted-text)' }}>Gemini is thinking...</div>}
        {!loading && error && (
          <div style={{
            marginTop: '8px',
            padding: '8px 10px',
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            borderRadius: '6px',
            color: 'var(--danger)',
            fontSize: '12px',
          }}>
            {error}
          </div>
        )}
      </div>
      <div style={{ padding: '16px', borderTop: '1px solid var(--panel-border)' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) {
              generate(input);
              setInput('');
            }
          }}
          placeholder="Ask Gemini anything..."
          style={{ width: '100%', padding: '8px', background: 'var(--editor-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: 'var(--on-accent)' }}
        />
      </div>
    </div>
  );
}
