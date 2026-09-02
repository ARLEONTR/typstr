import { useMemo, useState } from 'react'
import { apiClient } from '../../api/client'
import { Check, MessageSquare, RefreshCw } from '../../icons'
import type { ProjectComment } from '../../types'
import styles from './TasksPanel.module.css'

type Tab = 'all' | 'mine' | 'assigned'

export interface TasksPanelProps {
  comments: ProjectComment[]
  isLoading: boolean
  currentUserId: string
  /** Show project name in each card (false in editor sidebar where project is fixed) */
  showProjectName?: boolean
  onNavigate: (projectId: string, commentId: string) => void
  onCommentsChange: (updater: (prev: ProjectComment[]) => ProjectComment[]) => void
}

export function TasksPanel({
  comments,
  isLoading,
  currentUserId,
  showProjectName = true,
  onNavigate,
  onCommentsChange,
}: TasksPanelProps) {
  const [tab, setTab] = useState<Tab>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Build unique project list for the filter dropdown
  const projects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of comments) {
      if (!seen.has(c.projectId)) seen.set(c.projectId, c.projectTitle ?? c.projectId)
    }
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }))
  }, [comments])

  const filtered = useMemo(() => {
    let list = comments
    if (projectFilter !== 'all') list = list.filter((c) => c.projectId === projectFilter)
    if (tab === 'mine') list = list.filter((c) => c.authorUserId === currentUserId)
    if (tab === 'assigned') list = list.filter((c) => c.assigneeUserId === currentUserId)
    return list
  }, [comments, tab, projectFilter, currentUserId])

  const handleResolve = async (comment: ProjectComment) => {
    const newStatus = comment.status === 'resolved' ? 'open' : 'resolved'
    try {
      const { data } = await apiClient.patch<ProjectComment>(
        `/api/projects/${comment.projectId}/files/${comment.fileId}/comments/${comment.id}`,
        { status: newStatus }
      )
      onCommentsChange((prev) =>
        prev.map((c) => c.id === data.id ? { ...data, projectTitle: c.projectTitle, filePath: c.filePath } : c)
      )
    } catch {
      alert('Failed to update comment status.')
    }
  }

  const handleReply = async (comment: ProjectComment) => {
    const content = replyDrafts[comment.id]?.trim()
    if (!content) return
    try {
      const { data } = await apiClient.post<ProjectComment>(
        `/api/projects/${comment.projectId}/files/${comment.fileId}/comments/${comment.id}/replies`,
        { content }
      )
      setReplyDrafts((prev) => { const next = { ...prev }; delete next[comment.id]; return next })
      onCommentsChange((prev) =>
        prev.map((c) => c.id === comment.id ? { ...data, projectTitle: c.projectTitle, filePath: c.filePath } : c)
      )
    } catch {
      alert('Failed to post reply.')
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.sidebarHeaderRow}>
        <div>
          <p className={styles.sidebarLabel}>Tasks</p>
          <p className={styles.sidebarHint}></p>
        </div>
      </div>
      <div className={styles.filterBar}>
        {(['all', 'mine', 'assigned'] as const).map((id) => (
          <button
            key={id}
            className={[styles.tabBtn, tab === id ? styles.tabBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setTab(id)}
            type="button"
          >
            {id === 'all' ? 'All' : id === 'mine' ? 'By Me' : 'Assigned'}
          </button>
        ))}

        {showProjectName && projects.length > 1 && (
          <select
            className={styles.projectFilter}
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className={styles.empty}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>No comments here.</div>
      ) : (
        <div className={styles.list}>
          {filtered.map((comment) => {
            const isExpanded = expandedId === comment.id
            return (
              <div
                key={comment.id}
                className={[styles.card, comment.status === 'resolved' ? styles.cardResolved : ''].filter(Boolean).join(' ')}
              >
                <div className={styles.cardMeta}>
                  {showProjectName && comment.projectTitle && (
                    <span className={styles.cardProject}>{comment.projectTitle}</span>
                  )}
                  {comment.filePath && (
                    <span className={styles.cardFile}>{comment.filePath.split('/').pop()}</span>
                  )}
                  <span className={styles.cardDate}>{new Date(comment.createdAt).toLocaleDateString()}</span>
                  {comment.status === 'resolved'
                    ? <span className={styles.badgeResolved}>Resolved</span>
                    : <span className={styles.badgeOpen}>Open</span>}
                </div>

                <button
                  className={styles.cardBody}
                  onClick={() => onNavigate(comment.projectId, comment.id)}
                  title="Open in project"
                >
                  <span className={styles.cardAuthor}>{comment.authorName}</span>
                  {comment.excerpt ? <span className={styles.cardExcerpt}> on "{comment.excerpt}"</span> : null}
                  <p className={styles.cardContent}>{comment.content}</p>
                </button>

                {comment.replies.length > 0 && (
                  <button
                    className={styles.repliesToggle}
                    onClick={() => setExpandedId(isExpanded ? null : comment.id)}
                  >
                    {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'} {isExpanded ? '▲' : '▼'}
                  </button>
                )}

                {isExpanded && (
                  <div className={styles.replies}>
                    {comment.replies.map((reply) => (
                      <div key={reply.id} className={styles.reply}>
                        <div className={styles.replyHeader}>
                          <span className={styles.replyAuthor}>{reply.authorName}</span>
                          <span className={styles.replyDate}>{new Date(reply.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className={styles.replyBody}>{reply.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles.actions}>
                  <textarea
                    className={styles.replyInput}
                    rows={1}
                    placeholder="Reply…"
                    value={replyDrafts[comment.id] ?? ''}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleReply(comment) } }}
                  />
                  <button
                    className={styles.actionBtn}
                    disabled={!replyDrafts[comment.id]?.trim()}
                    onClick={() => void handleReply(comment)}
                    title="Reply"
                    aria-label="Reply"
                  >
                    <MessageSquare size={15} aria-hidden />
                  </button>
                  <button
                    className={[styles.actionBtn, comment.status === 'resolved' ? styles.actionBtnSecondary : styles.actionBtnPrimary].join(' ')}
                    onClick={() => void handleResolve(comment)}
                    title={comment.status === 'resolved' ? 'Reopen task' : 'Resolve task'}
                    aria-label={comment.status === 'resolved' ? 'Reopen task' : 'Resolve task'}
                  >
                    {comment.status === 'resolved' ? <RefreshCw size={15} aria-hidden /> : <Check size={15} aria-hidden />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
