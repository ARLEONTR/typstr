import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'
import type { InvitationProofTokenPayload } from '../types.js'

const INVITATION_PROOF_TTL_MS = 1000 * 60 * 60 * 24 * 7

function encodeBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

function sign(payload: string): string {
  return createHmac('sha256', env.collaborationSecret).update(payload).digest('base64url')
}

export function createInvitationProofToken(payload: Omit<InvitationProofTokenPayload, 'exp'>, ttlMs = INVITATION_PROOF_TTL_MS): string {
  const body = JSON.stringify({ ...payload, exp: Date.now() + ttlMs })
  const encodedBody = encodeBase64Url(body)
  const signature = sign(encodedBody)
  return `${encodedBody}.${signature}`
}

export function verifyInvitationProofToken(token: string): InvitationProofTokenPayload {
  const [encodedBody, signature] = token.split('.')
  if (!encodedBody || !signature) {
    throw new Error('Malformed invitation proof token')
  }

  const expected = Buffer.from(sign(encodedBody), 'utf8')
  const actual = Buffer.from(signature, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Invalid invitation proof token signature')
  }

  const payload = JSON.parse(decodeBase64Url(encodedBody)) as InvitationProofTokenPayload
  if (payload.exp <= Date.now()) {
    throw new Error('Invitation proof token expired')
  }

  return payload
}