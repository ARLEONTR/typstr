import React, { useState, useEffect, useRef } from 'react';

interface Props {
  onConfirm: (prompt: string) => void;
  onClose: () => void;
  loading: boolean;
}

export function GeminiPromptDialog({ onConfirm, onClose, loading }: Props) {
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onConfirm(prompt);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div style={{
      position: 'absolute',
      top: '50px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 100,
      background: 'var(--card-bg)',
      padding: '16px',
      borderRadius: '8px',
      boxShadow: 'var(--surface-shadow-soft)',
      width: '400px',
      color: 'var(--text-bright)',
    }}>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>Ask Gemini</div>
      <input
        ref={inputRef}
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter your request..."
        style={{
          width: '100%',
          padding: '8px',
          background: 'var(--editor-bg)',
          border: '1px solid var(--panel-border)',
          borderRadius: '4px',
          color: 'var(--text-bright)',
        }}
        disabled={loading}
      />
      <div style={{ marginTop: '12px', textAlign: 'right' }}>
        <button onClick={onClose} style={{ marginRight: '8px', cursor: 'pointer' }}>Cancel</button>
        <button 
          onClick={() => onConfirm(prompt)} 
          disabled={loading}
          style={{ cursor: 'pointer', background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', padding: '4px 12px', borderRadius: '4px' }}
        >
          {loading ? 'Generating...' : 'Insert'}
        </button>
      </div>
    </div>
  );
}
