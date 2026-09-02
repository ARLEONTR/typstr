import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiClient, buildGoogleAuthStartUrl, fetchAuthProviders, type AuthProvidersInfo } from '../api/client'
import type { AuthenticatedUser } from '../types'

interface AuthContextValue {
  user: AuthenticatedUser | null
  loading: boolean
  providers: AuthProvidersInfo
  refresh: () => Promise<void>
  login: () => void
  ldapLogin: (username: string, password: string) => Promise<void>
  devLogin: () => Promise<void>
  logout: () => Promise<void>
}

const defaultProviders: AuthProvidersInfo = {
  google: true,
  orcid: false,
  ldap: false,
  localDev: false,
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [providers, setProviders] = useState<AuthProvidersInfo>(defaultProviders)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [userRes, provRes] = await Promise.all([
        apiClient.get<AuthenticatedUser | null>('/api/auth/me').catch(() => ({ data: null })),
        fetchAuthProviders().catch(() => defaultProviders),
      ])
      setUser(userRes.data ?? null)
      setProviders(provRes ?? defaultProviders)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(() => {
    const nextPath = window.location.pathname + window.location.search + window.location.hash
    window.location.href = buildGoogleAuthStartUrl(nextPath)
  }, [])

  const ldapLogin = useCallback(async (username: string, password: string) => {
    const response = await apiClient.post<AuthenticatedUser>('/api/auth/ldap/login', { username, password })
    setUser(response.data)
    window.location.href = window.location.pathname + window.location.search + window.location.hash || '/'
  }, [])

  const devLogin = useCallback(async () => {
    const response = await apiClient.post<AuthenticatedUser>('/api/auth/local-dev-login')
    setUser(response.data)
    window.location.href = window.location.pathname + window.location.search + window.location.hash || '/'
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/api/auth/logout')
    } finally {
      setUser(null)
      window.location.href = '/'
    }
  }, [])

  const value = useMemo(
    () => ({ user, loading, providers, refresh, login, ldapLogin, devLogin, logout }),
    [user, loading, providers, refresh, login, ldapLogin, devLogin, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return context
}
