import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ProjectComment, ProjectMember } from '../../types'
import { Check as CheckIcon, MessageSquare as CommentsIcon, RefreshCw, Trash2 as TrashIcon } from '../../icons'
import styles from './CommentThreads.module.css'

export interface AssigneeSelection {
  userIds: string[]
  primaryUserId: string | null
}

type StatusFilter = 'open' | 'resolved' | 'detached' | 'all'
type AssigneeFilter = 'anyone' | 'me' | 'responsible' | 'unassigned' | `user:${string}`
type SortOrder = 'position' | 'newest' | 'oldest'

const FILTER_STORAGE_KEY = 'typstr.commentFilters'

// ── Small pieces ──────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#eab308', '#ef4444']

function initials(name: string | null | undefined, email?: string): string {
  const source = (name || email || '?').trim()
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toLocaleUpperCase('tr')
}

function avatarColor(key: string): string {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function Avatar({ name, email, id, size = 26 }: { name: string | null; email?: string; id: string; size?: number }) {
  return (
    <span className={styles.avatar} style={{ width: size, height: size, fontSize: size * 0.4, background: avatarColor(id) }} title={name || email}>
      {initials(name, email)}
    </span>
  )
}

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(timestamp).toLocaleDateString()
}

function statusOf(comment: ProjectComment): Exclude<StatusFilter, 'all'> {
  return comment.status === 'deleted' ? 'detached' : comment.status
}

const STATUS_LABEL: Record<Exclude<StatusFilter, 'all'>, string> = {
  open: 'Open',
  resolved: 'Resolved',
  detached: 'Detached',
}

// ── Assignee picker ───────────────────────────────────────────────────────

/**
 * Choose several assignees and, among them, the main responsible (★).
 * Changes are applied with "Apply" so a multi-step edit is a single update.
 */
export function AssigneePicker({
  members,
  value,
  onApply,
  onCancel,
  applyLabel = 'Apply',
}: {
  members: ProjectMember[]
  value: AssigneeSelection
  onApply: (value: AssigneeSelection) => void
  onCancel?: () => void
  applyLabel?: string
}) {
  const [draft, setDraft] = useState<AssigneeSelection>(value)
  const [query, setQuery] = useState('')
  const visible = members.filter((member) => `${member.name} ${member.email}`.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')))

  const toggle = (userId: string) => setDraft((current) => {
    if (current.userIds.includes(userId)) {
      const userIds = current.userIds.filter((id) => id !== userId)
      return { userIds, primaryUserId: current.primaryUserId === userId ? null : current.primaryUserId }
    }
    const userIds = [...current.userIds, userId]
    // The first person chosen becomes the main responsible by default.
    return { userIds, primaryUserId: current.primaryUserId ?? userId }
  })

  const makePrimary = (userId: string) => setDraft((current) => ({
    userIds: current.userIds.includes(userId) ? current.userIds : [...current.userIds, userId],
    primaryUserId: current.primaryUserId === userId ? null : userId,
  }))

  return (
    <div className={styles.picker} onClick={(event) => event.stopPropagation()}>
      {members.length > 6 ? (
        <input className={styles.pickerSearch} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a member…" autoFocus />
      ) : null}
      <div className={styles.pickerList} role="listbox" aria-multiselectable="true">
        {visible.map((member) => {
          const selected = draft.userIds.includes(member.userId)
          const primary = draft.primaryUserId === member.userId
          return (
            <div key={member.userId} className={[styles.pickerRow, selected ? styles.pickerRowSelected : ''].filter(Boolean).join(' ')}>
              <label className={styles.pickerLabel}>
                <input type="checkbox" checked={selected} onChange={() => toggle(member.userId)} />
                <Avatar name={member.name} email={member.email} id={member.userId} size={22} />
                <span className={styles.pickerName}>{member.name || member.email}</span>
              </label>
              <button
                type="button"
                className={[styles.primaryToggle, primary ? styles.primaryToggleOn : ''].filter(Boolean).join(' ')}
                onClick={() => makePrimary(member.userId)}
                title={primary ? 'Main responsible (click to clear)' : 'Make main responsible'}
                aria-pressed={primary}
              >
                ★
              </button>
            </div>
          )
        })}
      </div>
      <div className={styles.pickerFooter}>
        <span className={styles.pickerHint}>★ main responsible</span>
        {onCancel ? <button type="button" className={styles.textBtn} onClick={onCancel}>Cancel</button> : null}
        <button type="button" className={styles.applyBtn} onClick={() => onApply(draft)}>{applyLabel}</button>
      </div>
    </div>
  )
}

export function AssigneeChips({ comment, onEdit }: { comment: ProjectComment; onEdit?: () => void }) {
  if (comment.assignees.length === 0) {
    return onEdit ? <button type="button" className={styles.assignBtn} onClick={onEdit}>+ Assign</button> : null
  }
  return (
    <div className={styles.assigneeRow}>
      {comment.assignees.map((assignee) => (
        <span key={assignee.userId} className={[styles.assigneeChip, assignee.isPrimary ? styles.assigneeChipPrimary : ''].filter(Boolean).join(' ')} title={assignee.isPrimary ? 'Main responsible' : 'Assignee'}>
          <Avatar name={assignee.name} email={assignee.email} id={assignee.userId} size={18} />
          {assignee.name || assignee.email}
          {assignee.isPrimary ? <span className={styles.primaryMark}>★ Responsible</span> : null}
        </span>
      ))}
      {onEdit ? <button type="button" className={styles.assignBtn} onClick={onEdit} title="Change assignees">Edit</button> : null}
    </div>
  )
}

// ── Threads ───────────────────────────────────────────────────────────────

interface Props {
  comments: ProjectComment[]
  filePaths: Record<string, string>
  activeFileId: string
  currentUserId: string
  members: ProjectMember[]
  canManageComments: boolean
  highlightedCommentId: string | null
  replyDrafts: Record<string, string>
  isLoading: boolean
  error: string | null
  onCommentClick: (comment: ProjectComment) => void
  onReplyDraftChange: (commentId: string, value: string) => void
  onCreateReply: (comment: ProjectComment) => void
  onToggleResolved: (comment: ProjectComment, resolved: boolean) => void
  onDeleteComment: (comment: ProjectComment) => void
  onSetAssignees: (comment: ProjectComment, selection: AssigneeSelection) => void
}

interface Filters {
  scope: 'project' | 'file'
  status: StatusFilter
  assignee: AssigneeFilter
  sort: SortOrder
}

const DEFAULT_FILTERS: Filters = { scope: 'project', status: 'open', assignee: 'anyone', sort: 'position' }

function loadFilters(): Filters {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? '{}') }
  } catch {
    return DEFAULT_FILTERS
  }
}

export default function CommentThreads(props: Props) {
  const { comments, filePaths, activeFileId, currentUserId, members, highlightedCommentId } = props
  const [filters, setFilters] = useState<Filters>(loadFilters)
  const [query, setQuery] = useState('')
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters)) } catch { /* private mode */ }
  }, [filters])
  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }))

  const scoped = useMemo(
    () => (filters.scope === 'file' ? comments.filter((comment) => comment.fileId === activeFileId) : comments),
    [activeFileId, comments, filters.scope],
  )
  const statusCounts = useMemo(() => {
    const counts = { open: 0, resolved: 0, detached: 0, all: scoped.length }
    for (const comment of scoped) counts[statusOf(comment)] += 1
    return counts
  }, [scoped])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr')
    const list = scoped.filter((comment) => {
      if (filters.status !== 'all' && statusOf(comment) !== filters.status) return false
      const assignees = comment.assignees
      switch (filters.assignee) {
        case 'anyone': break
        case 'me': if (!assignees.some((a) => a.userId === currentUserId)) return false; break
        case 'responsible': if (!assignees.some((a) => a.userId === currentUserId && a.isPrimary)) return false; break
        case 'unassigned': if (assignees.length > 0) return false; break
        default: if (!assignees.some((a) => `user:${a.userId}` === filters.assignee)) return false
      }
      if (!needle) return true
      const haystack = [comment.content, comment.excerpt, comment.authorName, filePaths[comment.fileId] ?? '', ...comment.replies.map((r) => r.content)]
        .join('\n').toLocaleLowerCase('tr')
      return haystack.includes(needle)
    })
    if (filters.sort === 'newest') return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
    if (filters.sort === 'oldest') return [...list].sort((a, b) => a.createdAt - b.createdAt)
    return list
  }, [currentUserId, filePaths, filters, query, scoped])

  // Grouped by file (position order) or a flat list (time order).
  const groups = useMemo(() => {
    if (filters.sort !== 'position') return [{ fileId: '', comments: visible }]
    const byFile = new Map<string, ProjectComment[]>()
    for (const comment of visible) {
      const bucket = byFile.get(comment.fileId) ?? []
      bucket.push(comment)
      byFile.set(comment.fileId, bucket)
    }
    return [...byFile.entries()]
      .map(([fileId, list]) => ({ fileId, comments: list.sort((a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn) }))
      // The open file first, then by path.
      .sort((a, b) => (a.fileId === activeFileId ? -1 : b.fileId === activeFileId ? 1 : (filePaths[a.fileId] ?? '').localeCompare(filePaths[b.fileId] ?? '')))
  }, [activeFileId, filePaths, filters.sort, visible])

  // Bring the highlighted thread into view (e.g. after a click in the editor).
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!highlightedCommentId) return
    listRef.current?.querySelector(`[data-comment-id="${CSS.escape(highlightedCommentId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [highlightedCommentId])

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3>Threads</h3>
        <span className={styles.countBadge}>{visible.length}</span>
      </div>

      <div className={styles.filters}>
        <div className={styles.segmented} role="tablist" aria-label="Status">
          {(['open', 'resolved', 'detached', 'all'] as StatusFilter[]).map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={filters.status === status}
              className={filters.status === status ? styles.segmentActive : styles.segment}
              onClick={() => update({ status })}
              title={status === 'detached' ? 'Threads whose text is no longer in the document' : undefined}
            >
              {status === 'all' ? 'All' : STATUS_LABEL[status]} <span className={styles.segmentCount}>{statusCounts[status]}</span>
            </button>
          ))}
        </div>
        <div className={styles.filterRow}>
          <select className={styles.select} value={filters.scope} onChange={(event) => update({ scope: event.target.value as Filters['scope'] })} aria-label="Scope">
            <option value="project">All files</option>
            <option value="file">This file</option>
          </select>
          <select className={styles.select} value={filters.assignee} onChange={(event) => update({ assignee: event.target.value as AssigneeFilter })} aria-label="Assignee">
            <option value="anyone">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="responsible">I'm responsible</option>
            <option value="unassigned">Unassigned</option>
            {members.map((member) => <option key={member.userId} value={`user:${member.userId}`}>{member.name || member.email}</option>)}
          </select>
          <select className={styles.select} value={filters.sort} onChange={(event) => update({ sort: event.target.value as SortOrder })} aria-label="Sort">
            <option value="position">By file</option>
            <option value="newest">Recent activity</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        <input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search comments, replies, people…" />
      </div>

      {props.error ? <p className={styles.error}>{props.error}</p> : null}
      {props.isLoading && comments.length === 0 ? <p className={styles.empty}>Loading comments…</p> : null}
      {!props.isLoading && visible.length === 0 ? (
        <p className={styles.empty}>{comments.length === 0 ? 'No comments in this project yet. Select text in the editor to start a thread.' : 'No threads match these filters.'}</p>
      ) : null}

      <div ref={listRef} className={styles.groups}>
        {groups.map((group) => (
          <div key={group.fileId || 'all'} className={styles.group}>
            {group.fileId ? (
              <button
                type="button"
                className={[styles.groupHeader, group.fileId === activeFileId ? styles.groupHeaderActive : ''].filter(Boolean).join(' ')}
                onClick={() => setCollapsedFiles((current) => ({ ...current, [group.fileId]: !current[group.fileId] }))}
                aria-expanded={!collapsedFiles[group.fileId]}
              >
                <span className={styles.chevron}>{collapsedFiles[group.fileId] ? '▸' : '▾'}</span>
                <span className={styles.groupPath}>{filePaths[group.fileId] ?? 'Unknown file'}</span>
                {group.fileId === activeFileId ? <span className={styles.openTag}>open</span> : null}
                <span className={styles.groupCount}>{group.comments.length}</span>
              </button>
            ) : null}
            {!collapsedFiles[group.fileId] ? group.comments.map((comment) => (
              <ThreadCard key={comment.id} comment={comment} filePath={filePaths[comment.fileId]} showFile={!group.fileId} {...props} />
            )) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function ThreadCard({
  comment,
  filePath,
  showFile,
  currentUserId,
  members,
  canManageComments,
  highlightedCommentId,
  replyDrafts,
  onCommentClick,
  onReplyDraftChange,
  onCreateReply,
  onToggleResolved,
  onDeleteComment,
  onSetAssignees,
}: Props & { comment: ProjectComment; filePath: string | undefined; showFile: boolean }) {
  const [editingAssignees, setEditingAssignees] = useState(false)
  const [showAllReplies, setShowAllReplies] = useState(false)
  const status = statusOf(comment)
  const hiddenReplies = showAllReplies ? 0 : Math.max(0, comment.replies.length - 2)
  const replies = comment.replies.slice(hiddenReplies)
  const draft = replyDrafts[comment.id] ?? ''
  const canDelete = canManageComments || comment.authorUserId === currentUserId
  const location = comment.pdfAnnotation ? `PDF p. ${comment.pdfAnnotation.page}` : `line ${comment.startLine}`

  const onReplyKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && draft.trim()) {
      event.preventDefault()
      onCreateReply(comment)
    }
  }

  return (
    <article
      data-comment-id={comment.id}
      className={[styles.card, styles[`card_${status}`], highlightedCommentId === comment.id ? styles.cardActive : ''].filter(Boolean).join(' ')}
    >
      <header className={styles.cardHeader}>
        <Avatar name={comment.authorName} email={comment.authorEmail} id={comment.authorUserId ?? comment.authorEmail} />
        <div className={styles.cardAuthor}>
          <strong>{comment.authorName}</strong>
          <span className={styles.meta} title={new Date(comment.createdAt).toLocaleString()}>{relativeTime(comment.createdAt)}</span>
        </div>
        <span className={[styles.status, styles[`status_${status}`]].join(' ')}>{STATUS_LABEL[status]}</span>
      </header>

      <button type="button" className={styles.location} onClick={() => onCommentClick(comment)} title="Show in the editor">
        {showFile && filePath ? `${filePath} · ` : ''}{location}
      </button>
      <blockquote className={styles.excerpt} onClick={() => onCommentClick(comment)}>{comment.excerpt}</blockquote>
      <p className={styles.body}>{comment.content}</p>

      {editingAssignees ? (
        <AssigneePicker
          members={members}
          value={{ userIds: comment.assignees.map((a) => a.userId), primaryUserId: comment.assignees.find((a) => a.isPrimary)?.userId ?? null }}
          onCancel={() => setEditingAssignees(false)}
          onApply={(selection) => { setEditingAssignees(false); onSetAssignees(comment, selection) }}
        />
      ) : (
        <AssigneeChips comment={comment} onEdit={canManageComments && status !== 'detached' ? () => setEditingAssignees(true) : undefined} />
      )}

      {comment.replies.length > 0 ? (
        <div className={styles.replies}>
          {hiddenReplies > 0 ? (
            <button type="button" className={styles.textBtn} onClick={() => setShowAllReplies(true)}>Show {hiddenReplies} earlier {hiddenReplies === 1 ? 'reply' : 'replies'}</button>
          ) : null}
          {replies.map((reply) => (
            <div key={reply.id} className={styles.reply}>
              <Avatar name={reply.authorName} email={reply.authorEmail} id={reply.authorUserId ?? reply.authorEmail} size={20} />
              <div>
                <div className={styles.replyHeader}><strong>{reply.authorName}</strong><span className={styles.meta}>{relativeTime(reply.createdAt)}</span></div>
                <p className={styles.replyBody}>{reply.content}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {comment.status === 'resolved' && comment.resolvedAt ? (
        <p className={styles.resolvedMeta}>Resolved by {comment.resolvedByName ?? 'a collaborator'} · {relativeTime(comment.resolvedAt)}</p>
      ) : null}
      {status === 'detached' ? <p className={styles.detachedMeta}>The commented text is no longer in the document.</p> : null}

      {status !== 'detached' ? (
        <div className={styles.replyBox}>
          <textarea
            className={styles.replyInput}
            rows={draft ? 3 : 1}
            value={draft}
            onChange={(event) => onReplyDraftChange(comment.id, event.target.value)}
            onKeyDown={onReplyKeyDown}
            placeholder="Reply… (Ctrl+Enter to send)"
          />
          {draft.trim() ? (
            <button type="button" className={styles.iconBtnPrimary} onClick={() => onCreateReply(comment)} title="Send reply" aria-label="Send reply">
              <CommentsIcon size={15} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      <footer className={styles.actions}>
        {status !== 'detached' ? (
          <button
            type="button"
            className={comment.status === 'resolved' ? styles.actionBtn : styles.actionBtnPrimary}
            onClick={() => onToggleResolved(comment, comment.status !== 'resolved')}
          >
            {comment.status === 'resolved' ? <RefreshCw size={14} aria-hidden /> : <CheckIcon size={14} aria-hidden />}
            {comment.status === 'resolved' ? 'Reopen' : 'Resolve'}
          </button>
        ) : null}
        {canDelete ? (
          <button type="button" className={styles.actionBtnDanger} onClick={() => onDeleteComment(comment)} title="Delete thread" aria-label="Delete thread">
            <TrashIcon size={14} aria-hidden />
          </button>
        ) : null}
      </footer>
    </article>
  )
}

