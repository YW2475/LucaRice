/**
 * Real-UI assembly closure, invoked by the app-shell plugin once its inject
 * set is active: the whole layout tree hangs off the built-in 'root' slot
 * (ui-layout registers AppFrame there and renders the child slots
 * internally) — the shell's render is the one ctx-level renderSlot call in
 * the program.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { DocumentTitle } from './DocumentTitle.tsx'
// Type-only: pulls the runtime's SlotMap declaration merge (the 'root' key) into this program.
import type {} from '@deepseek-ai/dsh-client-runtime/client'

/** Assembly inputs: the active app-shell plugin ctx (slots/sessions/layout services provided). */
export interface AssemblyDeps {
  /** Client context with the assembly's inject set active. */
  ctx: Context
}

type AccountState = { username: string; role: 'admin' | 'user' }

const LOGIN_COPY = {
  zh: { username: '请输入用户名', password: '请输入密码', submit: '登录', unavailable: '系统尚未初始化，请联系管理员', failed: '无法登录' },
  en: { username: 'Enter your username', password: 'Enter your password', submit: 'Log in', unavailable: 'The system has not been initialized. Please contact the administrator.', failed: 'Unable to log in' },
  fr: { username: 'Saisissez votre nom d’utilisateur', password: 'Saisissez votre mot de passe', submit: 'Se connecter', unavailable: 'Le système n’est pas encore initialisé. Contactez l’administrateur.', failed: 'Connexion impossible' },
} as const

function loginLocale(): keyof typeof LOGIN_COPY {
  const stored = window.localStorage.getItem('lucarice.locale')
  if (stored === 'en' || stored === 'fr' || stored === 'zh') return stored
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : navigator.language.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

function AccountGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountState | undefined>()
  const [initialized, setInitialized] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const copy = LOGIN_COPY[loginLocale()]

  useEffect(() => {
    void fetch('/_lucarice/auth/me').then(async response => {
      const body = await response.json() as { user?: AccountState; initialized: boolean }
      setInitialized(body.initialized)
      setAccount(body.user)
    })
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!initialized) { setError(copy.unavailable); return }
    void fetch('/_lucarice/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
    }).then(async response => {
      const body = await response.json() as { user?: AccountState; error?: string }
      if (!response.ok || body.user === undefined) { setError(copy.failed); return }
      window.location.reload()
    })
  }

  if (account !== undefined) return <>{children}</>
  return (
    <main style={{ minHeight: '100%', display: 'grid', placeItems: 'center', background: '#131314', color: '#f4f4f5' }}>
      <form onSubmit={submit} style={{ width: 340, display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <img src="/lucarice-logo.png" alt="LucaRice" style={{ width: 42, height: 42, objectFit: 'contain' }} />
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 650, letterSpacing: '-0.8px' }}>LucaRice</h1>
        </div>
        <input required autoFocus placeholder={copy.username} value={username} onChange={event => { setUsername(event.currentTarget.value) }} style={{ width: '100%', height: 50, padding: '0 18px', boxSizing: 'border-box', borderRadius: 25, border: '1px solid #2a2a2d', outline: 'none', background: '#1a1a1b', color: '#f4f4f5', fontSize: 15 }} />
        <input required type="password" placeholder={copy.password} value={password} onChange={event => { setPassword(event.currentTarget.value) }} style={{ width: '100%', height: 50, padding: '0 18px', boxSizing: 'border-box', borderRadius: 25, border: '1px solid #2a2a2d', outline: 'none', background: '#1a1a1b', color: '#f4f4f5', fontSize: 15 }} />
        {error === '' ? null : <div style={{ color: '#ef8078', fontSize: 14, marginTop: -8 }}>{error}</div>}
        <button type="submit" style={{ height: 50, border: 0, borderRadius: 25, background: '#4f8b60', color: '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 600 }}>{copy.submit}</button>
      </form>
    </main>
  )
}

/**
 * Build the renderApp factory the app-shell plugin provides to AppRoot.
 * @param deps - assembly inputs.
 * @returns factory producing the real UI tree (called once per AppRoot render after settled).
 */
export function buildRenderApp(deps: AssemblyDeps): () => ReactNode {
  const { ctx } = deps
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('shell assembly: sessions service unavailable')
  const useSessions = bindSnapshotSelector(sessions.list)
  const SessionDocumentTitle = (): ReactNode => {
    const title = useSessions((state) => {
      const id = state.current
      return id === undefined ? undefined : state.byId[id]?.title
    })
    return <DocumentTitle {...title === undefined ? {} : { title }} />
  }
  return () => (
    <AccountGate>
      <SessionDocumentTitle />
      {ctx.slots.renderSlot('root', {})}
    </AccountGate>
  )
}
