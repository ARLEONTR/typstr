import { Router } from 'express'
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  findUserByEmail,
  getTeamById,
  listTeamMembers,
  listUserTeams,
  removeTeamMember,
} from '../db.js'
import { getAuthenticatedUser } from '../auth.js'
import { validateString, validateEmail } from '../validation.js'
import { assertCanAddTeamMember, assertCanCreateTeam, assertCanUseManagerRole } from '../services/billing.js'

export const teamsRouter = Router()

teamsRouter.get('/', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const teams = await listUserTeams(user.id)
  res.json(teams)
})

teamsRouter.post('/', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const { name } = req.body as { name?: string }
  const nameResult = validateString(name, { maxLength: 255, required: true, label: 'Team name' })
  if (!nameResult.valid) return res.status(400).json({ error: nameResult.error })

  await assertCanCreateTeam(user.id)
  const team = await createTeam({ name: nameResult.value, ownerUserId: user.id })
  res.status(201).json(team)
})

teamsRouter.get('/:teamId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const team = await getTeamById(req.params.teamId)
  if (!team) return res.status(404).json({ error: 'Team not found' })

  const members = await listTeamMembers(req.params.teamId)
  const isMember = members.some((m) => m.userId === user.id)
  if (!isMember) return res.status(403).json({ error: 'Not a member of this team' })

  res.json({ ...team, members })
})

teamsRouter.delete('/:teamId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const team = await getTeamById(req.params.teamId)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  if (team.ownerUserId !== user.id) return res.status(403).json({ error: 'Only the team owner can delete the team' })

  await deleteTeam(req.params.teamId, user.id)
  res.status(204).end()
})

teamsRouter.get('/:teamId/members', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const members = await listTeamMembers(req.params.teamId)
  const isMember = members.some((m) => m.userId === user.id)
  if (!isMember) return res.status(403).json({ error: 'Not a member of this team' })

  res.json(members)
})

teamsRouter.post('/:teamId/members', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const team = await getTeamById(req.params.teamId)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  if (team.ownerUserId !== user.id) return res.status(403).json({ error: 'Only the team owner can add members' })

  const { email } = req.body as { email?: string }
  const emailResult = validateEmail(email)
  if (!emailResult.valid) return res.status(400).json({ error: emailResult.error })

  const targetUser = await findUserByEmail(emailResult.value)
  if (!targetUser) return res.status(404).json({ error: 'User not found' })

  await assertCanAddTeamMember(user.id, req.params.teamId)
  await addTeamMember(req.params.teamId, targetUser.id, 'member')

  const members = await listTeamMembers(req.params.teamId)
  res.status(201).json(members)
})

teamsRouter.patch('/:teamId/members/:userId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const team = await getTeamById(req.params.teamId)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  if (team.ownerUserId !== user.id) return res.status(403).json({ error: 'Only the team owner can change roles' })
  if (req.params.userId === team.ownerUserId) return res.status(400).json({ error: 'Cannot change the owner role' })

  const { role } = req.body as { role?: string }
  if (role !== 'member' && role !== 'editor' && role !== 'manager') {
    return res.status(400).json({ error: 'Role must be member, editor, or manager' })
  }
  if (role === 'manager') {
    await assertCanUseManagerRole(user.id)
  }

  await addTeamMember(req.params.teamId, req.params.userId, role as 'member')
  const members = await listTeamMembers(req.params.teamId)
  res.json(members)
})

teamsRouter.delete('/:teamId/members/:userId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  const team = await getTeamById(req.params.teamId)
  if (!team) return res.status(404).json({ error: 'Team not found' })

  // Owner can remove anyone; members can remove themselves
  if (team.ownerUserId !== user.id && user.id !== req.params.userId) {
    return res.status(403).json({ error: 'Not authorized to remove this member' })
  }

  // Cannot remove the team owner
  if (req.params.userId === team.ownerUserId) {
    return res.status(400).json({ error: 'Cannot remove the team owner' })
  }

  await removeTeamMember(req.params.teamId, req.params.userId)
  res.status(204).end()
})
