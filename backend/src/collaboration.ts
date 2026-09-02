import type http from 'node:http'
import { WebSocketServer } from 'ws'
import { Hocuspocus } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { Redis } from '@hocuspocus/extension-redis'
import * as Y from 'yjs'
import { canAccessProject, getProjectFileForUser, getProjectFileStorage, touchProjectFile, updateProjectFileCollaborationState } from './db.js'
import { logger } from './logger.js'
import { verifyCollaborationToken } from './services/collaborationToken.js'
import { readTextFileFromDrive, writeTextFileToDrive } from './services/drive.js'
import { getProjectFileWorkflow } from './services/projectFeatures.js'
import { env } from './env.js'

let collaborationReady = false
let collaborationConnectionCount = 0
let collaborationStoreCount = 0
let lastCollaborationPersistedAt: number | null = null
const MAX_DOCUMENT_TOUCHES = 1000
const collaborationDocumentTouches = new Map<string, { persistedAt: number | null; storeCount: number }>()

function recordDocumentTouch(documentName: string, persistedAt: number | null): void {
  if (collaborationDocumentTouches.size >= MAX_DOCUMENT_TOUCHES) {
    const oldestKey = collaborationDocumentTouches.keys().next().value
    if (oldestKey) {
      collaborationDocumentTouches.delete(oldestKey)
    }
  }

  collaborationDocumentTouches.set(documentName, {
    persistedAt,
    storeCount: (collaborationDocumentTouches.get(documentName)?.storeCount ?? 0) + 1,
  })
}

function encodeCollaborationStateFromSource(source: string): Uint8Array {
  const document = new Y.Doc()
  document.getText('content').insert(0, source)
  return Y.encodeStateAsUpdate(document)
}

function decodeCollaborationSource(state: Uint8Array): string {
  const document = new Y.Doc()
  Y.applyUpdate(document, state)
  return document.getText('content').toString()
}

export const hocuspocusServer = new Hocuspocus({
  // Save 500ms after the last change, force-save after 3s regardless
  debounce: 500,
  maxDebounce: 3000,
  async onAuthenticate(data) {
    const { token, documentName } = data
    logger.debug('[collab] onAuthenticate documentName:', documentName, 'token prefix:', token?.slice(0, 20))
    const payload = verifyCollaborationToken(token)
    if (payload.fileId !== documentName) {
      throw new Error('Collaboration token does not match the requested file')
    }

    const file = await getProjectFileForUser(payload.fileId, payload.userId)
    if (!file || file.projectId !== payload.projectId || !(await canAccessProject(file.projectId, payload.userId, 'viewer'))) {
      throw new Error('Project access denied')
    }

    const workflow = await getProjectFileWorkflow(file.id)
    const isReader = file.role === 'viewer' || Boolean(workflow?.lockedByUserId && workflow.lockedByUserId !== payload.userId)

    // Hocuspocus enforces read-only mode at the protocol level when this flag is set.
    data.connectionConfig.readOnly = isReader
    logger.info('[collab] auth result', {
      documentName,
      projectId: payload.projectId,
      fileId: payload.fileId,
      userId: payload.userId,
      role: file.role,
      lockedByUserId: workflow?.lockedByUserId ?? null,
      readOnly: isReader,
    })

    return {
      userId: payload.userId,
      projectId: payload.projectId,
      fileId: payload.fileId,
      role: file.role,
    }
  },
  async onLoadDocument(data) {
    logger.debug('[collab] onLoadDocument', {
      documentName: data.documentName,
      hasDocument: Boolean(data.document),
      context: data.context,
    })
  },
  async onChange(data) {
    logger.debug('[collab] onChange', {
      documentName: data.documentName,
      clientCount: data.clientsCount,
      context: data.context,
    })
  },
  extensions: [
    new Redis({
      host: new URL(env.collaborationRedisUrl).hostname,
      port: Number(new URL(env.collaborationRedisUrl).port) || 6379,
    }),
    new Database({
      fetch: async ({ documentName }) => {
        logger.debug('[collab] fetch documentName:', documentName)
        const storage = await getProjectFileStorage(documentName)
        if (!storage) {
          logger.warning('[collab] fetch missing storage for document', documentName)
          return null
        }

        const source = await readTextFileFromDrive(storage.ownerUserId, storage.file.driveFileId)

        if (storage.collaborationState) {
          const persistedSource = decodeCollaborationSource(storage.collaborationState)
          if (persistedSource !== source) {
            const refreshedState = encodeCollaborationStateFromSource(source)
            await updateProjectFileCollaborationState(storage.file.id, refreshedState)
            logger.warning('[collab] fetch refreshed stale collaboration state from file source', {
              documentName,
              fileId: storage.file.id,
              persistedLength: persistedSource.length,
              sourceLength: source.length,
              bytes: refreshedState.length,
            })
            return refreshedState
          }

          logger.debug('[collab] fetch returning persisted collaboration state', {
            documentName,
            fileId: storage.file.id,
            bytes: storage.collaborationState.length,
          })
          return storage.collaborationState
        }

        const initialState = encodeCollaborationStateFromSource(source)
        await updateProjectFileCollaborationState(storage.file.id, initialState)
        logger.info('[collab] fetch seeded initial state from drive', {
          documentName,
          fileId: storage.file.id,
          sourceLength: source.length,
          bytes: initialState.length,
        })
        return initialState
      },
      store: async ({ documentName, state }) => {
        const storage = await getProjectFileStorage(documentName)
        if (!storage) {
          logger.warning('[collab] store missing storage for document', documentName)
          return
        }

        const document = new Y.Doc()
        Y.applyUpdate(document, state)
        const source = document.getText('content').toString()

        await updateProjectFileCollaborationState(storage.file.id, state)
        await writeTextFileToDrive(storage.ownerUserId, storage.file.driveFileId, source)
        await touchProjectFile(storage.file.id)
        collaborationStoreCount += 1
        lastCollaborationPersistedAt = Date.now()
        recordDocumentTouch(documentName, lastCollaborationPersistedAt)
        logger.debug('[collab] store persisted update', {
          documentName,
          fileId: storage.file.id,
          bytes: state.length,
          sourceLength: source.length,
          storeCount: collaborationDocumentTouches.get(documentName)?.storeCount ?? 0,
        })

      },
    }),
  ],
})

export function setupCollaboration(httpServer: http.Server): void {
  const wss = new WebSocketServer({ noServer: true })
  collaborationReady = true

  wss.on('connection', (ws, req) => {
    collaborationConnectionCount += 1
    logger.debug('[collab] ws connection opened', {
      url: req.url,
      connectionCount: collaborationConnectionCount,
    })
    const clientConnection = hocuspocusServer.handleConnection(ws, createWebSocketRequest(req))

    ws.on('message', (message) => {
      try {
        const payload = Array.isArray(message)
          ? new Uint8Array(Buffer.concat(message))
          : message instanceof Uint8Array
            ? message
            : new Uint8Array(message)
        clientConnection.handleMessage(payload)
      } catch (error) {
        logger.error('[collab] ws message handling failed', error)
      }
    })

    ws.on('close', () => {
      collaborationConnectionCount = Math.max(0, collaborationConnectionCount - 1)
      logger.debug('[collab] ws connection closed', {
        url: req.url,
        connectionCount: collaborationConnectionCount,
      })
      clientConnection.handleClose()
    })
  })

  httpServer.on('upgrade', (req, socket, head) => {
    logger.debug('[collab] upgrade request url:', req.url)
    if (req.url?.startsWith('/ws')) {
      wss.handleUpgrade(req, socket as any, head, (ws) => {
        logger.debug('[collab] ws connection established')
        wss.emit('connection', ws, req)
      })
    }
    // Non-/ws paths are left for other upgrade handlers (e.g. tinymist preview)
  })
}

function createWebSocketRequest(req: http.IncomingMessage): Request {
  const protocol = req.headers['x-forwarded-proto'] ?? 'http'
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `${protocol}://${host}`)
  const headers = new Headers()

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item)
      }
      continue
    }

    if (typeof value === 'string') {
      headers.set(key, value)
    }
  }

  return new Request(url, {
    method: req.method ?? 'GET',
    headers,
  })
}

export function getCollaborationMetrics() {
  return {
    isReady: collaborationReady,
    connectionCount: collaborationConnectionCount,
    documentCount: collaborationDocumentTouches.size,
    storeCount: collaborationStoreCount,
    lastPersistedAt: lastCollaborationPersistedAt,
    persistenceStrategy: 'Redis-backed Hocuspocus with persisted Yjs document snapshots in Postgres/Drive-backed file storage',
    scalingStrategy: 'Stateless websocket nodes coordinated through Redis pubsub; any node can serve a room once it shares the same Redis and database backends.',
  }
}
