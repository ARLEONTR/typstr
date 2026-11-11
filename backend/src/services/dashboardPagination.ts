// Order and paging of the dashboard's project lists. Kept free of database and
// Redis imports so it can be tested on its own.

import type { ProjectState } from '../types.js'

type DashboardSortKey = { pinned: boolean; starred: boolean; recent: number; id: string }
type DashboardProject = { id: string; updatedAt: number; state: Pick<ProjectState, 'isPinned' | 'isStarred' | 'lastOpenedAt'> }

function dashboardSortKey(project: DashboardProject): DashboardSortKey {
  return {
    pinned: project.state.isPinned,
    starred: project.state.isStarred,
    recent: project.state.lastOpenedAt ?? project.updatedAt,
    id: project.id,
  }
}

/** Pinned first, then starred, then most recently opened or changed; the id breaks ties, so the order is total. */
function compareDashboardSortKeys(left: DashboardSortKey, right: DashboardSortKey): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  if (left.starred !== right.starred) return left.starred ? -1 : 1
  if (left.recent !== right.recent) return right.recent - left.recent
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

export function compareDashboardProjects(left: DashboardProject, right: DashboardProject): number {
  return compareDashboardSortKeys(dashboardSortKey(left), dashboardSortKey(right))
}

function encodeDashboardCursor(key: DashboardSortKey): string {
  return Buffer.from(JSON.stringify([key.pinned ? 1 : 0, key.starred ? 1 : 0, key.recent, key.id]), 'utf8').toString('base64url')
}

function decodeDashboardCursor(cursor: string): DashboardSortKey | null {
  try {
    const [pinned, starred, recent, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[]
    if (typeof recent !== 'number' || typeof id !== 'string') return null
    return { pinned: pinned === 1, starred: starred === 1, recent, id }
  } catch {
    return null
  }
}

/**
 * One page of the dashboard's active projects, sorted with compareDashboardProjects. The cursor
 * is the full sort key of the previous page's last project, so the next page starts right after
 * it. (A cursor holding only the time restarted the list at the first pinned or starred project
 * older than that time, so "Load more" repeated most of the first page and skipped others.)
 */
export function paginateDashboardProjects<T extends DashboardProject>(
  sortedProjects: T[],
  cursor: string | undefined,
  limit: number,
): { page: T[]; nextCursor: string | null } {
  let start = 0
  if (cursor) {
    const after = decodeDashboardCursor(cursor)
    // An unreadable cursor (e.g. one from an older version) ends the list instead of repeating it.
    if (!after) return { page: [], nextCursor: null }
    start = sortedProjects.findIndex((project) => compareDashboardSortKeys(dashboardSortKey(project), after) > 0)
    if (start < 0) return { page: [], nextCursor: null }
  }

  const page = sortedProjects.slice(start, start + limit)
  const hasMore = start + limit < sortedProjects.length
  const lastItem = page[page.length - 1]
  return { page, nextCursor: hasMore && lastItem ? encodeDashboardCursor(dashboardSortKey(lastItem)) : null }
}
