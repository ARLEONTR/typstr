// The backend's environment holds secrets (database URL, session secret,
// API keys). Tools that process user documents get only what they need.
const TOOL_ENV_PASSTHROUGH = [
  'PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SOURCE_DATE_EPOCH',
  'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TYPST_FONT_PATHS', 'TYPST_PACKAGE_CACHE_PATH', 'TYPST_PACKAGE_PATH',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
]

export function toolProcessEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const toolEnv: NodeJS.ProcessEnv = {}
  for (const key of TOOL_ENV_PASSTHROUGH) {
    if (process.env[key] !== undefined) toolEnv[key] = process.env[key]
  }
  return { ...toolEnv, ...extra }
}
