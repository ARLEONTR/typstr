import { useState } from 'react';
import { apiClient } from '../../api/client';

export function FeedbackPanel({ onClose, embedded }: { onClose?: () => void, embedded?: boolean }) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setStatus('sending');
    try {
      await apiClient.post('/api/feedback', { message });
      setStatus('success');
      if (!embedded && onClose) setTimeout(onClose, 2000);
    } catch (e) {
      console.error('Failed to send feedback', e);
      setStatus('error');
    }
  };

  const containerStyle: React.CSSProperties = embedded ? {
    display: 'flex', flexDirection: 'column'
  } : {
    position: 'fixed', bottom: '80px', left: '24px', width: '320px', background: 'var(--card-bg)',
    padding: '20px', borderRadius: '8px', zIndex: 1000, color: 'var(--text-bright)', border: '1px solid var(--panel-border)'
  };

  return (
    <div style={containerStyle}>
      <h3 style={{ marginTop: 0 }}>We value your feedback</h3>
      <p style={{ fontSize: '13px', color: 'var(--text-soft)' }}>Got an enhancement idea or a problem? Let us know!</p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Your feedback..."
        style={{ width: '100%', height: '120px', margin: '12px 0', background: 'var(--editor-bg)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: 'var(--text-bright)', padding: '10px' }}
      />
      {status === 'success' && <p style={{ color: 'var(--success)', fontSize: '13px', marginBottom: '12px' }}>Feedback sent! Thank you.</p>}
      {status === 'error' && <p style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>Failed to send.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        {!embedded && onClose ? <button onClick={onClose} style={{ cursor: 'pointer' }}>Close</button> : null}
        <button 
          onClick={handleSubmit} 
          disabled={status === 'sending' || status === 'success'} 
          style={{ 
            cursor: 'pointer', background: 'var(--accent)', color: 'var(--on-accent)', border: 'none',
            padding: '8px 16px', borderRadius: '4px', fontWeight: 'bold' 
          }}
        >
          {status === 'sending' ? 'Sending...' : status === 'success' ? 'Sent' : 'Send Feedback'}
        </button>
      </div>
    </div>
  );
}
