import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { devLinkResponse } from '../../../shared/contracts'
import { useAuth } from '../state/Auth'
import { apiRequest, errorMessage } from '../api/client'
import { ErrorNotice, Field } from '../components/ui'

export default function SignIn() {
  const { signIn, signUp, devLink } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLink, setForgotLink] = useState<string | null>(null)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const requestedNext = params.get('next')
  const next = requestedNext && requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') || '').trim()
    const email = String(data.get('email') || '').trim()
    const password = String(data.get('password') || '')
    if (mode === 'signup' && !name) { setError('Enter your name.'); return }
    if (!email) { setError('Enter your email address.'); return }
    if (mode !== 'forgot' && password.length < (mode === 'signup' ? 10 : 1)) { setError(mode === 'signup' ? 'Use at least 10 characters for the password.' : 'Enter your password.'); return }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'forgot') {
        const result = await apiRequest('/auth/forgot-password', devLinkResponse, { method: 'POST', body: JSON.stringify({ email }) })
        setForgotSent(true)
        setForgotLink(result.dev_link ?? null)
      } else if (mode === 'signup') {
        await signUp(name, email, password)
        if (next) navigate(next, { replace: true })
      } else {
        await signIn(email, password)
        if (next) navigate(next, { replace: true })
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function switchMode(value: 'login' | 'signup' | 'forgot') {
    setMode(value)
    setError(null)
    setForgotSent(false)
    setForgotLink(null)
  }

  return <main className="public-quote">
    <section className="panel">
      <header className="panel-header"><div><p className="eyebrow">FixTrack</p><h1>{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Reset your password'}</h1><p className="text-muted">{mode === 'forgot' ? 'We will email a reset link if the account exists.' : mode === 'login' ? 'Owner access to repair jobs, quotations and payments.' : 'Verify your email after signing up to create a workspace.'}</p></div><Wrench size={25} aria-hidden="true" /></header>
      <div className="panel-body stack">
        {forgotSent ? <div className="stack">
          <div className="notice notice-success" role="status">If an account exists for that address, a reset link has been sent. It expires in one hour.</div>
          {forgotLink && <div className="notice"><div><strong>Email delivery is not configured here.</strong><p>Use this development link to reset the password:</p><a href={forgotLink}>Open reset link</a></div></div>}
          <button type="button" className="btn btn-secondary" onClick={() => switchMode('login')}>Back to sign in</button>
        </div> : <form className="stack" onSubmit={submit} aria-busy={busy}>
          {mode === 'signup' && <Field label="Your name"><input name="name" autoComplete="name" maxLength={120} required /></Field>}
          <Field label="Email address"><input name="email" type="email" autoComplete="email" maxLength={254} required /></Field>
          {mode !== 'forgot' && <Field label="Password" hint={mode === 'signup' ? 'At least 10 characters.' : undefined}><input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 10 : 1} maxLength={200} required /></Field>}
          <ErrorNotice message={error} />
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}</button>
        </form>}
        {mode === 'signup' && devLink && <div className="notice"><div><strong>Email delivery is not configured here.</strong><p>Verify your address with this development link:</p><a href={devLink}>Open verification link</a></div></div>}
        {!forgotSent && <div className="form-actions" style={{borderTop:0,paddingTop:0}}>
          {mode === 'login' && <><button type="button" className="btn btn-link" disabled={busy} onClick={() => switchMode('signup')}>Need an account? Create one</button><button type="button" className="btn btn-link" disabled={busy} onClick={() => switchMode('forgot')}>Forgot password?</button></>}
          {mode === 'signup' && <button type="button" className="btn btn-link" disabled={busy} onClick={() => switchMode('login')}>Already have an account? Sign in</button>}
          {mode === 'forgot' && <button type="button" className="btn btn-link" disabled={busy} onClick={() => switchMode('login')}>Back to sign in</button>}
        </div>}
      </div>
    </section>
    <p className="text-muted public-quote-footer">Owner access only. Public quotation links do not require an account.</p>
  </main>
}
