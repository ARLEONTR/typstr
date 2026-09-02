import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Awareness } from 'y-protocols/awareness'
import { apiBaseUrl, apiClient } from '../api/client'
import { logger } from '../logger'
import type { AuthenticatedUser } from '../types'

function getDefaultWsBaseUrl(): string {
  if (typeof window === 'undefined') {
    return 'ws://localhost:3000'
  }

  if (apiBaseUrl) {
    try {
      const apiUrl = new URL(apiBaseUrl, window.location.origin)
      apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      apiUrl.pathname = ''
      apiUrl.search = ''
      apiUrl.hash = ''
      return apiUrl.toString().replace(/\/+$/, '')
    } catch {
      // Fall through to host-based defaults below.
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || getDefaultWsBaseUrl()

function colorFromUserId(userId: string): string {
  let hash = 0
  for (const char of userId) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash |= 0
  }

  const palette = ['var(--accent)', 'var(--accent-soft)', 'var(--accent-strong)', 'var(--success)', 'var(--warning)', 'var(--danger)']
  return palette[Math.abs(hash) % palette.length]
}

export function useCollaboration(projectId: string, fileId: string, user: AuthenticatedUser, enabled = true, _prefetchedToken?: string) {
  const [authenticationError, setAuthenticationError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [synced, setSynced] = useState(false)
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null)
  const providerRef = useRef<HocuspocusProvider | null>(null)
  const ydoc = useMemo(() => new Y.Doc(), [fileId])
  const ytext = useMemo(() => ydoc.getText('content'), [ydoc])
  const fallbackAwareness = useMemo(() => new Awareness(ydoc), [ydoc])

  useEffect(() => {
    return () => {
      fallbackAwareness.destroy()
    }
  }, [fallbackAwareness])

  useEffect(() => {
    let cancelled = false
    let nextProvider: HocuspocusProvider | null = null
    const abortController = new AbortController()
    let startupTimer: ReturnType<typeof setTimeout> | null = null

    setAuthenticationError(null)
    setConnectionStatus(enabled ? 'connecting' : 'disconnected')
    setSynced(false)

    if (!enabled) {
      if (providerRef.current) {
        providerRef.current.destroy()
        providerRef.current = null
      }
      setProvider(null)

      return
    }

    startupTimer = setTimeout(() => {
      void (async () => {
      try {
        logger.debug('[collab] timer fired, enabled:', enabled, 'fileId:', fileId)
        if (cancelled) {
          return
        }

        logger.debug('[collab] creating provider, url:', `${WS_BASE_URL}/ws`, 'fileId:', fileId)
        nextProvider = new HocuspocusProvider({
          url: `${WS_BASE_URL}/ws`,
          name: fileId,
          document: ydoc,
          token: async () => {
            const response = await apiClient.get<{ token: string }>(`/api/projects/${projectId}/collaboration-token`, {
              params: { fileId },
              signal: abortController.signal,
            })
            logger.debug('[collab] fetched auth token for', fileId)
            return response.data.token
          },
          sessionAwareness: true,
          onAuthenticated: ({ scope }) => {
            logger.info('[collab] onAuthenticated', fileId, 'scope:', scope)
          },
          onConnect: () => {
            logger.debug('[collab] onConnect', fileId)
            if (!cancelled) {
              setConnectionStatus('connected')
            }
          },
          onSynced: () => {
            logger.debug('[collab] onSynced', fileId, 'content length:', ydoc.getText('content').length)
            if (!cancelled) {
              setSynced(true)
            }
          },
          onStatus: ({ status }) => {
            logger.debug('[collab] onStatus', fileId, status, 'cancelled:', cancelled)
            if (!cancelled) {
              setConnectionStatus(status === 'connected' ? 'connected' : 'connecting')
            }
          },
          onDisconnect: () => {
            logger.debug('[collab] onDisconnect', fileId, 'cancelled:', cancelled)
            if (!cancelled) {
              setConnectionStatus('disconnected')
            }
          },
          onAuthenticationFailed: ({ reason }) => {
            logger.error('[collab] onAuthenticationFailed', fileId, reason)
            if (!cancelled) {
              setAuthenticationError('Collaboration authentication failed. Refresh the page and sign in again.')
              setConnectionStatus('disconnected')
            }
          },
        })

        if (cancelled) {
          logger.debug('[collab] cancelled after provider creation, destroying')
          nextProvider.destroy()
          return
        }

        if (providerRef.current) {
          providerRef.current.destroy()
        }
        providerRef.current = nextProvider
        setProvider(nextProvider)
      } catch (error: any) {
        logger.error('[collab] error', fileId, error)
        if (abortController.signal.aborted || cancelled) {
          return
        }
        if (!cancelled) {
          setAuthenticationError('Collaboration authentication failed. Refresh the page and sign in again.')
          setConnectionStatus('disconnected')
        }
      }
      })()
    }, 220)

    return () => {
      logger.debug('[collab] cleanup, fileId:', fileId, 'nextProvider exists:', !!nextProvider)
      cancelled = true
      abortController.abort()
      if (startupTimer) {
        clearTimeout(startupTimer)
      }
      if (nextProvider) {
        nextProvider.destroy()
        if (providerRef.current === nextProvider) {
          providerRef.current = null
        }
      }
      setProvider((current) => current === nextProvider ? null : current)
    }
  }, [enabled, fileId, projectId, ydoc])

  useEffect(() => {
    const activeAwareness = provider?.awareness ?? fallbackAwareness

    activeAwareness.setLocalStateField('user', {
      id: user.id,
      name: user.name,
      color: colorFromUserId(user.id),
      avatarUrl: user.avatarUrl ?? null,
    })

    return () => {
      provider?.awareness?.setLocalState(null)
      if (!provider) {
        fallbackAwareness.setLocalState(null)
      }
    }
  }, [fallbackAwareness, provider, user.avatarUrl, user.id, user.name])

  return {
    ydoc,
    ytext,
    provider,
    awareness: provider?.awareness ?? fallbackAwareness,
    authenticationError,
    connectionStatus,
    synced,
  }
}
