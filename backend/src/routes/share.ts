import { Router } from 'express'
import {
  addProjectMember,
  createAccessRequest,
  createShareLink,
  decideAccessRequest,
  findUserById,
  getAccessRequest,
  getProjectById,
  getProjectRole,
  getPublishedProject,
  getShareLinkByToken,
  incrementShareLinkUse,
  listAccessRequests,
  listShareLinks,
  listSharingPresets,
  createSharingPreset,
  deleteSharingPreset,
  publishProject,
  revokeShareLink,
  transferProjectOwnership,
  unpublishProject,
} from '../db.js'
import { getAuthenticatedUser } from '../auth.js'
import { validateString, validateOptionalString, validateArrayLength } from '../validation.js'
import { assertCanCreateSharingPreset, assertCanInviteCollaborator, assertCanPublishProject } from '../services/billing.js'

export const shareRouter = Router()

// ─── Public: join project via share link ─────────────────────────────────────

shareRouter.post('/join/:token', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const link = await getShareLinkByToken(req.params.token)

  if (!link || !link.isActive) {
    return res.status(404).json({ error: 'Share link not found or inactive' })
  }

  if (link.expiresAt && link.expiresAt < Date.now()) {
    return res.status(410).json({ error: 'Share link has expired' })
  }

  if (link.maxUses != null && link.useCount >= link.maxUses) {
    return res.status(410).json({ error: 'Share link has reached its usage limit' })
  }

  const project = await getProjectById(link.projectId)
  if (!project) {
    return res.status(404).json({ error: 'Project not found' })
  }

  // Check if user is already a member
  const existingRole = await getProjectRole(link.projectId, user.id)
  if (!existingRole) {
    await assertCanInviteCollaborator(project.ownerUserId, link.projectId)
    await addProjectMember(link.projectId, user.id, link.role)
    await incrementShareLinkUse(link.id)
  }

  res.json({ projectId: link.projectId, role: existingRole ?? link.role })
})

// ─── Public: view published project ──────────────────────────────────────────

shareRouter.get('/published/:projectId', async (req, res) => {
  const project = await getPublishedProject(req.params.projectId)
  if (!project) {
    return res.status(404).json({ error: 'Project not found or not published' })
  }

  res.json(project)
})

// ─── Share links (owner/manager/editor) ──────────────────────────────────────

shareRouter.get('/:projectId/links', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const role = await getProjectRole(req.params.projectId, user.id)
  if (!role) return res.status(404).json({ error: 'Project not found' })
  if (role !== 'owner' && role !== 'manager' && role !== 'editor') return res.status(403).json({ error: 'Owner, manager, or editor access required' })

  const links = await listShareLinks(req.params.projectId)
  res.json(links)
})

shareRouter.post('/:projectId/links', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const role = await getProjectRole(req.params.projectId, user.id)
  if (!role) return res.status(404).json({ error: 'Project not found' })
  if (role !== 'owner' && role !== 'manager' && role !== 'editor') return res.status(403).json({ error: 'Owner, manager, or editor access required' })

  const { role: linkRole, label, expiresAt, maxUses } = req.body as {
    role?: 'viewer' | 'editor'
    label?: string
    expiresAt?: number
    maxUses?: number
  }

  if (!linkRole || !['viewer', 'editor'].includes(linkRole)) {
    return res.status(400).json({ error: 'role must be viewer or editor' })
  }

  const labelResult = validateOptionalString(label, { maxLength: 100, label: 'Label' })
  if (!labelResult.valid) return res.status(400).json({ error: labelResult.error })

  const link = await createShareLink({
    projectId: req.params.projectId,
    role: linkRole,
    label: labelResult.value ?? undefined,
    expiresAt,
    maxUses,
    createdByUserId: user.id,
  })

  res.status(201).json(link)
})

shareRouter.delete('/:projectId/links/:linkId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const role = await getProjectRole(req.params.projectId, user.id)
  if (!role) return res.status(404).json({ error: 'Project not found' })
  if (role !== 'owner' && role !== 'manager' && role !== 'editor') return res.status(403).json({ error: 'Owner, manager, or editor access required' })

  await revokeShareLink(req.params.linkId, req.params.projectId)
  res.status(204).end()
})

// ─── Access requests ──────────────────────────────────────────────────────────

shareRouter.post('/:projectId/access-requests', async (req, res) => {
  const user = getAuthenticatedUser(req)

  const project = await getProjectById(req.params.projectId)
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const existingRole = await getProjectRole(req.params.projectId, user.id)
  if (existingRole) return res.status(409).json({ error: 'You already have access to this project' })

  const { message, requestedRole } = req.body as { message?: string; requestedRole?: 'viewer' | 'editor' }

  const messageResult = validateOptionalString(message, { maxLength: 1000, label: 'Message' })
  if (!messageResult.valid) return res.status(400).json({ error: messageResult.error })

  const request = await createAccessRequest({
    projectId: req.params.projectId,
    requesterUserId: user.id,
    requesterEmail: user.email,
    requesterName: user.name,
    message: messageResult.value ?? undefined,
    requestedRole: requestedRole ?? 'viewer',
  })

  res.status(201).json(request)
})

shareRouter.get('/:projectId/access-requests', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const role = await getProjectRole(req.params.projectId, user.id)
  if (!role) return res.status(404).json({ error: 'Project not found' })
  if (role !== 'owner' && role !== 'manager' && role !== 'editor') return res.status(403).json({ error: 'Owner, manager, or editor access required' })

  const requests = await listAccessRequests(req.params.projectId)
  res.json(requests)
})

shareRouter.post('/:projectId/access-requests/:requestId/decide', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const role = await getProjectRole(req.params.projectId, user.id)
  if (!role) return res.status(404).json({ error: 'Project not found' })
  if (role !== 'owner' && role !== 'manager' && role !== 'editor') return res.status(403).json({ error: 'Owner, manager, or editor access required' })

  const { decision } = req.body as { decision?: 'approved' | 'denied' }
  if (!decision || !['approved', 'denied'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or denied' })
  }

  const request = await getAccessRequest(req.params.requestId)
  if (!request || request.projectId !== req.params.projectId) {
    return res.status(404).json({ error: 'Access request not found' })
  }

  const updated = await decideAccessRequest(req.params.requestId, req.params.projectId, decision, user.id)

  // If approved, add the user as a member
  if (decision === 'approved') {
    const project = await getProjectById(req.params.projectId)
    if (project) {
      await assertCanInviteCollaborator(project.ownerUserId, req.params.projectId)
    }
    await addProjectMember(req.params.projectId, request.requesterUserId, request.requestedRole)
  }

  res.json(updated)
})

// ─── Publish / unpublish ──────────────────────────────────────────────────────

shareRouter.post('/:projectId/publish', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const role = await getProjectRole(req.params.projectId, user.id)
  if (!role) return res.status(404).json({ error: 'Project not found' })
  if (role !== 'owner') return res.status(403).json({ error: 'Owner access required' })

  await assertCanPublishProject(user.id)
  await publishProject(req.params.projectId)
  res.status(204).end()
})

shareRouter.delete('/:projectId/publish', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const role = await getProjectRole(req.params.projectId, user.id)
  if (!role) return res.status(404).json({ error: 'Project not found' })
  if (role !== 'owner') return res.status(403).json({ error: 'Owner access required' })

  await unpublishProject(req.params.projectId)
  res.status(204).end()
})

// ─── Ownership transfer ───────────────────────────────────────────────────────

shareRouter.post('/:projectId/transfer', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const role = await getProjectRole(req.params.projectId, user.id)
  if (!role) return res.status(404).json({ error: 'Project not found' })
  if (role !== 'owner') return res.status(403).json({ error: 'Owner access required' })

  const { toUserId } = req.body as { toUserId?: string }
  if (!toUserId) return res.status(400).json({ error: 'toUserId is required' })

  const targetUser = await findUserById(toUserId)
  if (!targetUser) return res.status(404).json({ error: 'Target user not found' })

  await transferProjectOwnership(req.params.projectId, user.id, toUserId)
  res.status(204).end()
})

// ─── Sharing presets ──────────────────────────────────────────────────────────

shareRouter.get('/presets', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const presets = await listSharingPresets(user.id)
  res.json(presets)
})

shareRouter.post('/presets', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const { name, entries } = req.body as {
    name?: string
    entries?: Array<{ email: string; role: string }>
  }

  if (!name || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'name and entries are required' })
  }

  const nameResult = validateString(name, { maxLength: 255, required: true, label: 'Preset name' })
  if (!nameResult.valid) return res.status(400).json({ error: nameResult.error })
  const entriesResult = validateArrayLength(entries, { maxItems: 100, label: 'Entries' })
  if (!entriesResult.valid) return res.status(400).json({ error: entriesResult.error })

  await assertCanCreateSharingPreset(user.id)
  const preset = await createSharingPreset({ ownerUserId: user.id, name: nameResult.value, entries })
  res.status(201).json(preset)
})

shareRouter.delete('/presets/:presetId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  await deleteSharingPreset(req.params.presetId, user.id)
  res.status(204).end()
})
