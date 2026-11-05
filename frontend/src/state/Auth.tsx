import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { authResponse, devLinkResponse, meResponse, successResponse, type AuthUser } from '../../../shared/contracts'
import { apiRequest } from '../api/client'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  devLink: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resendVerification: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [devLink, setDevLink] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await apiRequest('/auth/me', meResponse)
    setUser(result.user)
  }, [])

  useEffect(() => {
    let active = true
    void apiRequest('/auth/me', meResponse)
      .then(result => { if (active) setUser(result.user) })
      .catch(() => { if (active) setUser(null) })
      .finally(() => { if (active) setLoading(false) })
    const unauthorized = () => setUser(null)
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh().catch(() => {}) }
    window.addEventListener('fixtrack:unauthorized', unauthorized)
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.removeEventListener('fixtrack:unauthorized', unauthorized)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await apiRequest('/auth/login', authResponse, { method: 'POST', body: JSON.stringify({ email, password }) })
    setUser(result.user)
    setDevLink(null)
  }, [])

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const result = await apiRequest('/auth/signup', authResponse, { method: 'POST', body: JSON.stringify({ name, email, password }) })
    setUser(result.user)
    setDevLink(result.dev_link ?? null)
  }, [])

  const signOut = useCallback(async () => {
    await apiRequest('/auth/logout', successResponse, { method: 'POST', body: '{}' })
    setUser(null)
    setDevLink(null)
  }, [])

  const resendVerification = useCallback(async () => {
    const result = await apiRequest('/auth/resend-verification', devLinkResponse, { method: 'POST', body: '{}' })
    setDevLink(result.dev_link ?? null)
  }, [])

  return <AuthContext.Provider value={{ user, loading, devLink, signIn, signUp, signOut, resendVerification, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider is required')
  return value
}
