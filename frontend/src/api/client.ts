import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'
const hasExplicitWsBaseUrl = Object.prototype.hasOwnProperty.call(import.meta.env, 'VITE_WS_BASE_URL')
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? ''
export const apiBaseUrl = API_BASE_URL

export const apiClient = axios.create({
  baseURL: '',
  timeout: 60000,
  withCredentials: true,
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const code = error?.response?.data?.code
    if (typeof window !== 'undefined') {
      const next = window.location.pathname + window.location.search + window.location.hash
      if (code === 'google_reauth_required') {
        window.location.href = buildGoogleUpgradeUrl('gemini', next)
      } else if (code === 'drive_scope_required') {
        window.location.href = buildGoogleUpgradeUrl('drive', next)
      } else if (code === 'drive_workspace_required') {
        window.location.href = '/'
      } else if (code === 'plan_limit_exceeded') {
        window.dispatchEvent(new CustomEvent('typstr:plan-limit', { detail: error.response.data }))
      }
    }

    return Promise.reject(error)
  },
)

export interface AuthProvidersInfo {
  google: boolean
  orcid: boolean
  ldap: boolean
  localDev: boolean
}

export async function fetchAuthProviders(): Promise<AuthProvidersInfo> {
  const response = await apiClient.get<AuthProvidersInfo>('/api/auth/providers')
  return response.data
}

export function buildGoogleAuthStartUrl(nextPath = '/'): string {
  const safeNextPath = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/'
  const params = new URLSearchParams({ next: safeNextPath })
  return `/api/auth/google/start?${params.toString()}`
}

export function buildGoogleUpgradeUrl(scope: 'drive' | 'gemini', nextPath = '/'): string {
  const safeNextPath = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/'
  const params = new URLSearchParams({ scope, next: safeNextPath })
  return `/api/auth/google/upgrade?${params.toString()}`
}

export function buildOrcidConnectUrl(nextPath = '/'): string {
  const safeNextPath = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/'
  const params = new URLSearchParams({ next: safeNextPath })
  return `/api/auth/orcid/start?${params.toString()}`
}

export function buildApiUrl(path: string): string {
  if (path.startsWith(API_BASE_URL)) return path
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export function buildWsUrl(path: string): string {
  if (path.startsWith('ws://') || path.startsWith('wss://')) return path

  if (WS_BASE_URL) {
    return `${WS_BASE_URL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = import.meta.env.DEV && !hasExplicitWsBaseUrl && (window.location.port === '8989' || window.location.port === '5173')
    ? `${window.location.hostname}:3000`
    : window.location.host
  return `${protocol}//${host}${path.startsWith('/') ? path : `/${path}`}`
}
