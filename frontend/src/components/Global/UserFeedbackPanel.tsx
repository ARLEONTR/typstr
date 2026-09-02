import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../../api/client'

type UserFeedbackRow = {
  id: string
  message: string
  created_at: number
  status: string
  admin_response: string | null
  parent_feedback_id: string | null
  is_admin_reply?: boolean
}

export function UserFeedbackPanel({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const [feedback, setFeedback] = useState<UserFeedbackRow[]>([])
  const [loading, setLoading] = useState(true)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [replyingId, setReplyingId] = useState<string | null>(null)

  const loadFeedback = async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<UserFeedbackRow[]>('/api/user/feedback')
      setFeedback(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadFeedback()
  }, [])

  const threadRows = useMemo(() => {
    const roots = feedback.filter((row) => !row.parent_feedback_id)
    const repliesByRootId = new Map<string, UserFeedbackRow[]>()
    for (const row of feedback) {
      if (!row.parent_feedback_id) continue
      const bucket = repliesByRootId.get(row.parent_feedback_id) ?? []
      bucket.push(row)
      repliesByRootId.set(row.parent_feedback_id, bucket)
    }
    return roots.map((root) => ({
      root,
      replies: (repliesByRootId.get(root.id) ?? []).sort((a, b) => a.created_at - b.created_at),
    }))
  }, [feedback])

  const handleReply = async (feedbackId: string) => {
    const draft = (replyDrafts[feedbackId] ?? '').trim()
    if (!draft) return
    setReplyingId(feedbackId)
    try {
      await apiClient.post(`/api/feedback/${feedbackId}/replies`, { message: draft })
      setReplyDrafts((current) => ({ ...current, [feedbackId]: '' }))
      await loadFeedback()
    } finally {
      setReplyingId(null)
    }
  }

  const containerStyle: React.CSSProperties = embedded
    ? { display: 'flex', flexDirection: 'column', height: '100%' }
    : {
      position: 'fixed',
      bottom: '80px',
      left: '24px',
      width: '460px',
      background: 'var(--card-bg)',
      padding: '20px',
      borderRadius: '8px',
      zIndex: 1000,
      color: 'var(--on-accent)',
      border: '1px solid var(--panel-border)',
    }

  return (
    <div style={containerStyle}>
      <h3 style={{ marginTop: 0 }}>My Feedbacks</h3>
      {loading ? <p style={{ color: 'var(--text-soft)' }}>Loading submissions...</p> : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: '100px' }}>
          {threadRows.length === 0 ? (
            <p style={{ color: 'var(--text-soft)' }}>No feedback submitted yet.</p>
          ) : threadRows.map(({ root, replies }) => (
            <div key={root.id} style={{ marginBottom: '18px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '14px' }}>
              <p style={{ fontSize: '14px', marginBottom: '8px', lineHeight: '1.5' }}>{root.message}</p>
              <div style={{ fontSize: '12px', color: 'var(--text-soft)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: root.status === 'addressed' ? 'var(--success)' : root.status === 'in-progress' ? 'var(--warning)' : 'var(--panel-border)',
                  color: 'var(--on-accent)',
                }}
                >
                  {root.status}
                </span>
                <span>{new Date(Number(root.created_at)).toLocaleDateString()}</span>
              </div>
              {root.admin_response ? (
                <div style={{ marginTop: '10px', padding: '10px', background: 'var(--editor-bg)', borderRadius: '6px', fontSize: '13px', borderLeft: '3px solid var(--accent)' }}>
                  <strong>Admin Response:</strong> {root.admin_response}
                </div>
              ) : null}

              {replies.length > 0 ? (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {replies.map((reply) => (
                    <div
                      key={reply.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: reply.is_admin_reply ? 'var(--action-bg)' : 'var(--editor-bg)',
                        border: reply.is_admin_reply ? '1px solid var(--accent)' : '1px solid var(--panel-border)',
                        borderLeft: reply.is_admin_reply ? '3px solid var(--accent)' : '1px solid var(--panel-border)',
                      }}
                    >
                      <div style={{ fontSize: '11px', color: 'var(--muted-text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {reply.is_admin_reply ? (
                          <span
                            style={{ padding: '1px 6px', borderRadius: 3, background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}
                            title="Reply from the Typstr team"
                          >
                            TEAM
                          </span>
                        ) : (
                          <span>Follow-up</span>
                        )}
                        <span>· {new Date(Number(reply.created_at)).toLocaleDateString()}</span>
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-bright)' }}>{reply.message}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div style={{ marginTop: 10 }}>
                <textarea
                  value={replyDrafts[root.id] ?? ''}
                  onChange={(event) => setReplyDrafts((current) => ({ ...current, [root.id]: event.target.value }))}
                  placeholder="Add follow-up to this feedback..."
                  rows={2}
                  style={{ width: '100%', background: 'var(--editor-bg)', border: '1px solid var(--panel-border)', borderRadius: '6px', color: 'var(--on-accent)', padding: '8px' }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button
                    onClick={() => void handleReply(root.id)}
                    disabled={replyingId === root.id || !(replyDrafts[root.id] ?? '').trim()}
                    style={{ cursor: 'pointer', background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', padding: '7px 12px', borderRadius: '4px', fontWeight: 600 }}
                  >
                    {replyingId === root.id ? 'Sending...' : 'Reply'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {!embedded && onClose ? (
        <button onClick={onClose} style={{ marginTop: '16px', cursor: 'pointer', padding: '8px 16px' }}>
          Close
        </button>
      ) : null}
    </div>
  )
}
