import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../env.js'

const ALGORITHM = 'aes-256-gcm'
const VERSION_PREFIX = 'v1:'

function getEncryptionKey(): Buffer | null {
  const raw = env.tokenEncryptionKey
  if (!raw) {
    return null
  }

  // Accept 32-byte hex (64 hex chars) or base64
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex')
  }

  const decoded = Buffer.from(raw, 'base64')
  if (decoded.length === 32) {
    return decoded
  }

  throw new Error('TOKEN_ENCRYPTION_KEY must be a 32-byte hex (64 hex chars) or base64 string')
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey()
  if (!key) {
    return plaintext
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${VERSION_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decryptToken(value: string): string {
  if (!isEncryptedToken(value)) {
    return value
  }

  const key = getEncryptionKey()
  if (!key) {
    // No key configured — return the ciphertext as-is (graceful degradation)
    return value
  }

  const rest = value.slice(VERSION_PREFIX.length)
  const parts = rest.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format')
  }

  const [ivHex, tagHex, ciphertextHex] = parts as [string, string, string]
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
}

export function isEncryptedToken(value: string): boolean {
  return value.startsWith(VERSION_PREFIX)
}
