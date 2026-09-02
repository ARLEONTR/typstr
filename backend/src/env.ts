function getBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function getNumberEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getStringListEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name]
  if (value === undefined) return fallback

  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
const isProduction = nodeEnv === 'production'
const serverRole = process.env.SERVER_ROLE === 'backend' || process.env.SERVER_ROLE === 'collaboration' ? process.env.SERVER_ROLE : 'all'
const defaultFrontendOrigin = isProduction ? 'https://typs.tr' : 'http://localhost:8989'
const defaultBackendOrigin = isProduction ? 'https://typs.tr' : 'http://localhost:3000'
const defaultSessionRedisUrl = isProduction ? 'redis://redis:6379/0' : 'redis://localhost:6379/0'
const localAuthBypassDefault = !isProduction
const localFileStorageDefault = !isProduction

export const env = {
  nodeEnv,
  isProduction,
  serverRole,
  logLevel: process.env.LOG_LEVEL ?? 'ERROR',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? process.env.CORS_ORIGIN ?? defaultFrontendOrigin,
  backendOrigin: process.env.BACKEND_ORIGIN ?? defaultBackendOrigin,
  sessionSecret: process.env.SESSION_SECRET ?? 'change-me-in-production',
  collaborationSecret: process.env.COLLABORATION_SECRET ?? process.env.SESSION_SECRET ?? 'change-me-in-production',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? `${defaultBackendOrigin}/api/auth/google/callback`,
  orcidClientId: process.env.ORCID_CLIENT_ID ?? '',
  orcidClientSecret: process.env.ORCID_CLIENT_SECRET ?? '',
  orcidCallbackUrl: process.env.ORCID_CALLBACK_URL ?? `${defaultBackendOrigin}/api/auth/orcid/callback`,
  orcidAuthorizeUrl: process.env.ORCID_AUTHORIZE_URL ?? 'https://orcid.org/oauth/authorize',
  orcidTokenUrl: process.env.ORCID_TOKEN_URL ?? 'https://orcid.org/oauth/token',
  cookieSecure: getBooleanEnv('COOKIE_SECURE', isProduction),
  sessionCookieDomain: process.env.SESSION_COOKIE_DOMAIN || undefined,
  sessionCookieSameSite: getBooleanEnv('COOKIE_CROSS_SITE', false) ? 'none' : 'lax',
  sessionRedisUrl: process.env.SESSION_REDIS_URL ?? process.env.REDIS_URL ?? defaultSessionRedisUrl,
  collaborationRedisUrl: process.env.COLLABORATION_REDIS_URL ?? process.env.SESSION_REDIS_URL ?? process.env.REDIS_URL ?? defaultSessionRedisUrl,
  sessionRedisPrefix: process.env.SESSION_REDIS_PREFIX ?? 'typstr:sess:',
  trustProxyHops: getNumberEnv('TRUST_PROXY_HOPS', isProduction ? 1 : 0),
  googleDriveRootName: process.env.GOOGLE_DRIVE_ROOT_NAME ?? 'typstr',
  localAuthBypassEnabled: getBooleanEnv('LOCAL_AUTH_BYPASS', localAuthBypassDefault),
  localAuthBypassEmail: process.env.LOCAL_AUTH_EMAIL ?? 'dev@typstr.local',
  localAuthBypassName: process.env.LOCAL_AUTH_NAME ?? 'Local Developer',
  localFileStorageEnabled: getBooleanEnv('LOCAL_FILE_STORAGE', localFileStorageDefault),
  localStorageRoot: process.env.LOCAL_STORAGE_ROOT ?? '/app/.local-storage',
  adminApiKey: process.env.ADMIN_API_KEY ?? '',
  adminEmails: getStringListEnv('ADMIN_EMAILS', []),
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? '',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://typstr:typstr@localhost:5432/typstr',
  backupDir: process.env.BACKUP_DIR ?? '',
  backupKeepCount: getNumberEnv('BACKUP_KEEP_COUNT', 7),
  retentionRevisionsDays: getNumberEnv('RETENTION_REVISIONS_DAYS', 90),
  retentionActivityDays: getNumberEnv('RETENTION_ACTIVITY_DAYS', 180),
  retentionJobsDays: getNumberEnv('RETENTION_JOBS_DAYS', 30),
  retentionErrorsDays: getNumberEnv('RETENTION_ERRORS_DAYS', 30),
  retentionTrashDays: getNumberEnv('RETENTION_TRASH_DAYS', 30),
  rateLimitAuthMax: getNumberEnv('RATE_LIMIT_AUTH_MAX', isProduction ? 30 : 60),
  rateLimitInviteMax: getNumberEnv('RATE_LIMIT_INVITE_MAX', isProduction ? 20 : 40),
  rateLimitCompileMax: getNumberEnv('RATE_LIMIT_COMPILE_MAX', isProduction ? 60 : 180),
  rateLimitExportMax: getNumberEnv('RATE_LIMIT_EXPORT_MAX', isProduction ? 30 : 90),
  rateLimitUploadMax: getNumberEnv('RATE_LIMIT_UPLOAD_MAX', isProduction ? 30 : 60),
  compileHttpConcurrencyMax: getNumberEnv('COMPILE_HTTP_CONCURRENCY_MAX', isProduction ? 96 : 192),
  exportHttpConcurrencyMax: getNumberEnv('EXPORT_HTTP_CONCURRENCY_MAX', isProduction ? 48 : 96),
  requestBodyLimitMb: getNumberEnv('REQUEST_BODY_LIMIT_MB', 64),

  compileTmpdir: process.env.COMPILE_TMPDIR ?? '',
  compilePdfOnSave: getBooleanEnv('COMPILE_PDF_ON_SAVE', false),
  retentionCompileJobsHours: getNumberEnv('RETENTION_COMPILE_JOBS_HOURS', 2),
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: getNumberEnv('SMTP_PORT', 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  smtpFrom: process.env.SMTP_FROM ?? 'Typstr <typstr@arleon.com.tr>',

  // LDAP authentication configuration
  ldapEnabled: getBooleanEnv('LDAP_ENABLED', false),
  ldapUrl: process.env.LDAP_URL ?? '',
  ldapBindDn: process.env.LDAP_BIND_DN ?? '',
  ldapBindPassword: process.env.LDAP_BIND_PASSWORD ?? '',
  ldapSearchBase: process.env.LDAP_SEARCH_BASE ?? '',
  ldapSearchFilter: process.env.LDAP_SEARCH_FILTER ?? '(|(mail={{username}})(uid={{username}})(sAMAccountName={{username}})(cn={{username}}))',
  ldapEmailAttribute: process.env.LDAP_EMAIL_ATTRIBUTE ?? 'mail',
  ldapNameAttribute: process.env.LDAP_NAME_ATTRIBUTE ?? 'cn',
  ldapTlsRejectUnauthorized: getBooleanEnv('LDAP_TLS_REJECT_UNAUTHORIZED', true),
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret && env.googleCallbackUrl)
}

export function isOrcidAuthConfigured(): boolean {
  return Boolean(env.orcidClientId && env.orcidClientSecret && env.orcidCallbackUrl)
}

export function isLdapConfigured(): boolean {
  return Boolean(env.ldapEnabled || (env.ldapUrl && env.ldapSearchBase))
}

export function isLocalAuthBypassEnabled(): boolean {
  return !env.isProduction && env.localAuthBypassEnabled
}

export function isLocalFileStorageEnabled(): boolean {
  return env.localFileStorageEnabled || !isGoogleAuthConfigured()
}

