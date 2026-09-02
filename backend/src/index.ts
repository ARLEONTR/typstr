import http from 'node:http'
import type { Socket } from 'node:net'
import express from 'express'
import { createApp } from './app.js'
import { setupCollaboration } from './collaboration.js'
import { initializeDatabase } from './db.js'
import { env } from './env.js'
import { logger } from './logger.js'
import { initializeReliabilityTables, scheduleDatabaseBackup, scheduleRetentionJob, startBackgroundJobWorker } from './services/reliability.js'
import { opsRouter } from './routes/ops.js'
import { proxyTypstPreviewWebSocket } from './services/tinymistPreview.js'

const PORT = parseInt(process.env.PORT ?? '3000', 10)

await initializeDatabase()
await initializeReliabilityTables()
startBackgroundJobWorker()
if (env.serverRole !== 'collaboration') {
  scheduleRetentionJob()
  scheduleDatabaseBackup()
}

const app = env.serverRole === 'collaboration'
  ? createCollaborationApp()
  : await createApp()
const server = http.createServer(app)

if (env.serverRole !== 'backend') {
  setupCollaboration(server)
}

server.on('upgrade', (req, socket, head) => {
  if (req.url?.includes('/tinymist-preview/')) {
    void proxyTypstPreviewWebSocket(req, socket as Socket, head).catch((err) => {
      console.error('[Tinymist Preview] Upgrade handler failed:', err)
    })
  }
})

server.listen(PORT, () => {
  logger.info(`typstr ${env.serverRole} server listening on port ${PORT}`)
})

function createCollaborationApp() {
  const app = express()
  app.use('/api', opsRouter)
  app.get('/', (_req, res) => {
    res.json({ status: 'ok', role: 'collaboration', timestamp: Date.now() })
  })
  return app
}
