import { Router } from 'express'
import { getAuthenticatedUser } from '../auth.js'
import { listNotificationsForUser, markNotificationRead } from '../db.js'

export const notificationsRouter = Router()

notificationsRouter.get('/', async (req, res) => {
  const user = getAuthenticatedUser(req)
  res.json(await listNotificationsForUser(user.id))
})

notificationsRouter.patch('/:notificationId', async (req, res) => {
  const user = getAuthenticatedUser(req)
  if (typeof req.body.read !== 'boolean') {
    return res.status(400).json({ error: 'read must be a boolean' })
  }

  if (!req.body.read) {
    return res.status(400).json({ error: 'Only marking notifications as read is currently supported' })
  }

  const notification = await markNotificationRead(req.params.notificationId, user.id)
  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' })
  }

  res.json(notification)
})