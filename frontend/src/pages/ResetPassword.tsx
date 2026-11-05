import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { successResponse } from '../../../shared/contracts'
import { apiRequest, errorMessage } from '../api/client'
import { ErrorNotice, Field, StatePanel } from '../components/ui'

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || busy) return
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password') || '')
    const confirmation = String(data.get('confirmation') || '')
    if (password.length < 10) { setError('Use at least 10 characters for the password.'); return }
    if (password !== confirmation) { setError('The two passwords do not match.'); return }
    setBusy(true); setError(null)
    try {
      await apiRequest('/auth/reset-password', successResponse, { method: 'POST', body: JSON.stringify({ token, password }) })
      setDone(true)
      window.setTimeout(() => window.location.assign('/'), 1200)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <main className="public-quote"><section className="panel">
    <header className="panel-header"><div><p className="eyebrow">FixTrack</p><h1>Reset password</h1></div><Wrench size={25} aria-hidden="true" /></header>
    <div className="panel-body stack">
      {done ? <StatePanel title="Password updated" action={<Link className="btn btn-primary" to="/">Go to sign in</Link>}>All existing sessions were signed out. Sign in with the new password.</StatePanel>
        : <form className="stack" onSubmit={submit} aria-busy={busy}>
          <p className="text-muted">Choose a new password for your FixTrack account.</p>
          <Field label="New password" hint="At least 10 characters."><input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></Field>
          <Field label="Confirm new password"><input name="confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></Field>
          <ErrorNotice message={error} />
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </form>}
    </div>
  </section></main>
}
