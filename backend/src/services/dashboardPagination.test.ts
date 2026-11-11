import test from 'node:test'
import assert from 'node:assert/strict'
import { paginateDashboardProjects } from './dashboardPagination.js'

type Project = { id: string; updatedAt: number; state: { isPinned: boolean; isStarred: boolean; lastOpenedAt: number | null } }

function project(index: number, options: { pinned?: boolean; starred?: boolean; recent?: number } = {}): Project {
  return {
    id: `project-${String(index).padStart(3, '0')}`,
    updatedAt: options.recent ?? 1_000_000 - index * 1000,
    state: { isPinned: Boolean(options.pinned), isStarred: Boolean(options.starred), lastOpenedAt: null },
  }
}

function sortLikeDashboard(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => {
    if (left.state.isPinned !== right.state.isPinned) return left.state.isPinned ? -1 : 1
    if (left.state.isStarred !== right.state.isStarred) return left.state.isStarred ? -1 : 1
    const leftRecent = left.state.lastOpenedAt ?? left.updatedAt
    const rightRecent = right.state.lastOpenedAt ?? right.updatedAt
    if (leftRecent !== rightRecent) return rightRecent - leftRecent
    return left.id < right.id ? -1 : 1
  })
}

function allPages(projects: Project[], limit: number): Project[][] {
  const pages: Project[][] = []
  let cursor: string | undefined
  do {
    const { page, nextCursor } = paginateDashboardProjects(projects, cursor, limit)
    pages.push(page)
    cursor = nextCursor ?? undefined
  } while (cursor && pages.length < 100)
  return pages
}

test('pinned projects older than the first page do not restart the list', () => {
  // 60 projects, 6 pinned ones among the oldest: the case that repeated 46 projects on "Load more".
  const projects = sortLikeDashboard(Array.from({ length: 60 }, (_, index) => project(index, { pinned: index >= 54 })))
  const pages = allPages(projects, 50)
  const ids = pages.flat().map((entry) => entry.id)

  assert.equal(pages.length, 2)
  assert.equal(ids.length, 60, 'every project once')
  assert.equal(new Set(ids).size, 60, 'no project twice')
  assert.deepEqual(ids, projects.map((entry) => entry.id), 'in dashboard order')
})

test('projects with the same time are neither repeated nor skipped', () => {
  const projects = sortLikeDashboard(Array.from({ length: 23 }, (_, index) => project(index, { recent: 5000, starred: index % 4 === 0 })))
  const ids = allPages(projects, 5).flat().map((entry) => entry.id)
  assert.deepEqual(ids, projects.map((entry) => entry.id))
})

test('the last page has no cursor, and an unreadable cursor ends the list', () => {
  const projects = sortLikeDashboard(Array.from({ length: 3 }, (_, index) => project(index)))
  assert.equal(paginateDashboardProjects(projects, undefined, 50).nextCursor, null)
  assert.deepEqual(paginateDashboardProjects(projects, '1794500000000', 50), { page: [], nextCursor: null })
})
