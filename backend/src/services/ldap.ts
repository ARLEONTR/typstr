import { Client, escapeFilter } from 'ldapts'
import { env, isLdapConfigured } from '../env.js'
import { logger } from '../logger.js'

export interface LdapUserResult {
  ldapId: string
  email: string
  name: string
  avatarUrl?: string | null
}

function escapeLdapValue(input: string): string {
  return input.replace(/[\\*()\0/]/g, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

/**
 * Authenticates a user against the configured LDAP/Active Directory directory.
 * Returns normalized user information upon successful bind, or null on failure.
 */
export async function authenticateLdap(username: string, password: string): Promise<LdapUserResult | null> {
  if (!isLdapConfigured() || !username?.trim() || !password) {
    return null
  }

  const rawUsername = username.trim()
  const escapedUsername = escapeLdapValue(rawUsername)
  const isLdaps = env.ldapUrl.startsWith('ldaps://')
  const tlsOptions = isLdaps ? { rejectUnauthorized: env.ldapTlsRejectUnauthorized } : undefined
  let userDn: string | null = null
  let userEntry: any = null

  // 1. If admin bind credentials are provided, bind as admin to search for the user DN
  if (env.ldapBindDn && env.ldapBindPassword) {
    const adminClient = new Client({
      url: env.ldapUrl,
      timeout: 8000,
      connectTimeout: 8000,
      ...(tlsOptions ? { tlsOptions } : {}),
    })

    try {
      await adminClient.bind(env.ldapBindDn, env.ldapBindPassword)
      const searchFilter = env.ldapSearchFilter.replace(/\{\{username\}\}/g, escapedUsername)

      const { searchEntries } = await adminClient.search(env.ldapSearchBase, {
        filter: searchFilter,
        scope: 'sub',
        attributes: [
          'dn',
          env.ldapEmailAttribute,
          env.ldapNameAttribute,
          'displayName',
          'cn',
          'mail',
          'userPrincipalName',
          'uid',
          'sAMAccountName',
        ],
      })

      if (searchEntries.length === 0) {
        logger.warning(`[LDAP] User not found for filter: ${searchFilter}`)
        await adminClient.unbind().catch(() => {})
        return null
      }

      userEntry = searchEntries[0]
      userDn = userEntry.dn
      await adminClient.unbind().catch(() => {})
    } catch (adminError) {
      logger.error('[LDAP] Admin search bind error:', adminError)
      await adminClient.unbind().catch(() => {})
      return null
    }
  } else {
    // Direct bind pattern if no admin credentials are provided
    if (rawUsername.includes('=')) {
      userDn = rawUsername
    } else if (env.ldapSearchBase) {
      userDn = `uid=${escapedUsername},${env.ldapSearchBase}`
    } else {
      userDn = rawUsername
    }
  }

  if (!userDn) {
    return null
  }

  // 2. Bind as the target user to verify password
  const userClient = new Client({
    url: env.ldapUrl,
    timeout: 8000,
    connectTimeout: 8000,
    ...(tlsOptions ? { tlsOptions } : {}),
  })

  try {
    await userClient.bind(userDn, password)

    // If we didn't search beforehand, fetch user attributes now
    if (!userEntry && env.ldapSearchBase) {
      try {
        const { searchEntries } = await userClient.search(userDn, {
          scope: 'base',
          attributes: [
            env.ldapEmailAttribute,
            env.ldapNameAttribute,
            'displayName',
            'cn',
            'mail',
            'userPrincipalName',
            'uid',
            'sAMAccountName',
          ],
        })
        if (searchEntries.length > 0) {
          userEntry = searchEntries[0]
        }
      } catch (err) {
        logger.debug('[LDAP] Base search after user bind failed:', err)
      }
    }

    await userClient.unbind().catch(() => {})

    // Extract attributes
    const rawEmail = userEntry?.[env.ldapEmailAttribute] || userEntry?.mail || userEntry?.userPrincipalName
    const rawName = userEntry?.[env.ldapNameAttribute] || userEntry?.displayName || userEntry?.cn
    const rawUid = userEntry?.uid || userEntry?.sAMAccountName

    const email = Array.isArray(rawEmail) ? rawEmail[0] : (rawEmail || (rawUsername.includes('@') ? rawUsername : `${rawUsername}@typstr.local`))
    const name = Array.isArray(rawName) ? rawName[0] : (rawName || rawUsername)
    const ldapId = Array.isArray(rawUid) ? rawUid[0] : (rawUid || userDn || rawUsername)

    return {
      ldapId: String(ldapId).trim(),
      email: String(email).trim().toLowerCase(),
      name: String(name).trim(),
      avatarUrl: null,
    }
  } catch (userBindError) {
    logger.warning(`[LDAP] User bind failed for ${userDn}:`, (userBindError as Error)?.message || userBindError)
    await userClient.unbind().catch(() => {})
    return null
  }
}
