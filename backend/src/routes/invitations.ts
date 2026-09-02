import { Router } from 'express'
import { getAuthenticatedUser } from '../auth.js'
import { getProjectById, getPendingProjectInvitationById, getProjectInvitationById, listPendingInvitationsForUser, respondToProjectInvitation } from '../db.js'
import { verifyInvitationProofToken } from '../services/invitationProof.js'
import { logProjectActivity, runBackgroundJobAndWait } from '../services/reliability.js'
import { emitSharingUpdate } from '../services/sharingEvents.js'

export const invitationsRouter = Router()

invitationsRouter.get('/', async (req, res) => {
  const user = getAuthenticatedUser(req)
  res.json(await listPendingInvitationsForUser(user.email))
})

invitationsRouter.get('/:invitationId', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const invitation = await getPendingProjectInvitationById(req.params.invitationId)
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    const emailMatches = invitation.email.toLowerCase() === user.email.toLowerCase()
    if (!emailMatches) {
      const invitationProof = typeof req.query.proof === 'string' ? req.query.proof : ''
      if (!hasValidInvitationProof(invitation.id, invitation.email, invitationProof)) {
        return res.status(404).json({ error: 'Invitation not found' })
      }
    }

    res.json(invitation)
  } catch (error) {
    next(error)
  }
})

invitationsRouter.post('/:invitationId/respond', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const action = req.body.action === 'accept' || req.body.action === 'reject' ? req.body.action : null
    const invitationProof = typeof req.body.proof === 'string' ? req.body.proof : ''
    if (!action) {
      return res.status(400).json({ error: 'action must be accept or reject' })
    }

    const existingInvitation = await getProjectInvitationById(req.params.invitationId)
    if (!existingInvitation || existingInvitation.status !== 'pending') {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    const emailMatches = existingInvitation.email.toLowerCase() === user.email.toLowerCase()
    const allowEmailMismatch = !emailMatches && hasValidInvitationProof(existingInvitation.id, existingInvitation.email, invitationProof)
    if (!emailMatches && !allowEmailMismatch) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    const invitation = await respondToProjectInvitation({
      invitationId: req.params.invitationId,
      email: user.email,
      userId: user.id,
      action,
      allowEmailMismatch,
    })

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    if (action === 'accept') {
      const project = await getProjectById(existingInvitation.projectId)
      if (!project) {
        return res.status(404).json({ error: 'Project not found' })
      }

      await runBackgroundJobAndWait('drive-permission-sync', {
        projectId: existingInvitation.projectId,
        ownerUserId: project.ownerUserId,
        fileId: project.driveFolderId,
        email: user.email,
        role: existingInvitation.role,
        action: 'grant',
        actorUserId: user.id,
      })
    }

    await logProjectActivity({
      projectId: existingInvitation.projectId,
      actorUserId: user.id,
      type: `share.invitation-${action}`,
      summary: `${action === 'accept' ? 'Accepted' : 'Rejected'} invitation for ${existingInvitation.projectTitle}.`,
      metadata: {
        invitationId: existingInvitation.id,
        email: user.email,
        invitedEmail: existingInvitation.email,
        role: existingInvitation.role,
        usedInvitationProof: allowEmailMismatch,
      },
    })

    emitSharingUpdate(existingInvitation.projectId)

    res.json(invitation)
  } catch (error) {
    next(error)
  }
})

function hasValidInvitationProof(invitationId: string, invitedEmail: string, proof: string): boolean {
  if (!proof) {
    return false
  }

  try {
    const payload = verifyInvitationProofToken(proof)
    return payload.invitationId === invitationId && payload.invitedEmail.toLowerCase() === invitedEmail.toLowerCase()
  } catch {
    return false
  }
}