import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getProjectWorkspaceRevisionId,
  invalidateProjectWorkspaceCache,
  invalidateProjectWorkspaceFile,
  invalidateProjectWorkspaceSubtree,
} from './projectWorkspace.js'

test('workspace revision bumps on full invalidation', () => {
  const projectId = 'workspace-project'
  const before = getProjectWorkspaceRevisionId(projectId)
  invalidateProjectWorkspaceCache(projectId)
  assert.equal(getProjectWorkspaceRevisionId(projectId), before + 1)
})

test('workspace revision bumps on file and subtree invalidation', () => {
  const projectId = 'workspace-project-subtree'
  const before = getProjectWorkspaceRevisionId(projectId)
  invalidateProjectWorkspaceFile(projectId, 'file-1')
  const afterFile = getProjectWorkspaceRevisionId(projectId)
  invalidateProjectWorkspaceSubtree(projectId, 'chapters')
  const afterSubtree = getProjectWorkspaceRevisionId(projectId)

  assert.equal(afterFile, before + 1)
  assert.equal(afterSubtree, afterFile + 1)
})
