import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'
import type { CollaborationTokenPayload } from '../types.js'

function encodeBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

function sign(payload: string): string {
  return createHmac('sha256', env.collaborationSecret).update(payload).digest('base64url')
}

export function createCollaborationToken(payload: Omit<CollaborationTokenPayload, 'exp'>, ttlMs = 1000 * 60 * 30): string {
  const body = JSON.stringify({ ...payload, exp: Date.now() + ttlMs })
  const encodedBody = encodeBase64Url(body)
  const signature = sign(encodedBody)
  return `${encodedBody}.${signature}`
}

export function verifyCollaborationToken(token: string): CollaborationTokenPayload {
  const [encodedBody, signature] = token.split('.')
  if (!encodedBody || !signature) {
    throw new Error('Malformed collaboration token')
  }

  const expected = Buffer.from(sign(encodedBody), 'utf8')
  const actual = Buffer.from(signature, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Invalid collaboration token signature')
  }

  const payload = JSON.parse(decodeBase64Url(encodedBody)) as CollaborationTokenPayload
  if (payload.exp <= Date.now()) {
    throw new Error('Collaboration token expired')
  }

  return payload
}