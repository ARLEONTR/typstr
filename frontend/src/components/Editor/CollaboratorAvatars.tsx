import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import styles from './CollaboratorAvatars.module.css'

type CollaboratorAvatar = {
  clientId: number
  userName: string
  color: string
  avatarUrl?: string | null
}

interface AwarenessState {
  user?: {
    name?: string
    color?: string
    avatarUrl?: string | null
  }
}

interface Props {
  awareness: Awareness
  isGeminiEnabled?: boolean
  collaborators?: CollaboratorAvatar[]
}

const COLORS = ['var(--accent)', 'var(--accent-soft)', 'var(--accent-strong)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--text-soft)']

function colorFromId(id: number): string {
  return COLORS[id % COLORS.length]
}

function initialsFrom(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export default function CollaboratorAvatars({ awareness, isGeminiEnabled = false, collaborators }: Props) {
  const [states, setStates] = useState<Map<number, AwarenessState>>(new Map())

  useEffect(() => {
    const update = () => {
      setStates(new Map(awareness.getStates() as Map<number, AwarenessState>))
    }
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [awareness])

  const awarenessPeers = Array.from(states.entries()).filter(([id]) => id !== awareness.clientID)
  const peers = collaborators && collaborators.length > 0
    ? collaborators.map((collaborator) => [collaborator.clientId, {
        user: {
          name: collaborator.userName,
          color: collaborator.color,
          avatarUrl: collaborator.avatarUrl ?? null,
        },
      }] as const)
    : awarenessPeers

  return (
    <div className={styles.container}>
      {isGeminiEnabled && (
        <div
          className={styles.avatar}
          style={{ background: 'var(--accent)', border: '2px solid var(--accent-soft)' }}
          title="Gemini Co-author"
        >
          <img src="/logo.svg" alt="Gemini" className={styles.avatarImg} />
        </div>
      )}
      {peers.slice(0, 5).map(([id, state]) => {
        const name = state?.user?.name ?? `User ${id}`
        const color = state?.user?.color ?? colorFromId(id)
        const avatarUrl = state?.user?.avatarUrl
        return (
          <div
            key={id}
            className={styles.avatar}
            style={avatarUrl ? undefined : { background: color }}
            title={name}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={name} className={styles.avatarImg} referrerPolicy="no-referrer" />
            ) : (
              initialsFrom(name)
            )}
          </div>
        )
      })}
      {peers.length > 5 && (
        <div className={styles.avatar} style={{ background: 'var(--muted-text)' }}>
          +{peers.length - 5}
        </div>
      )}
    </div>
  )
}
