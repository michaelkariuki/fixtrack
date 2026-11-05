import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { successResponse } from '../../../shared/contracts'
import { apiRequest, errorMessage } from '../api/client'
import { ErrorNotice, StatePanel } from '../components/ui'

export default function VerifyEmail() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setState('failed'); setError('This verification link is incomplete.'); return }
    let active = true
    void apiRequest('/auth/verify-email', successResponse, { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => { if (active) setState('done') })
      .catch(cause => { if (active) { setError(errorMessage(cause)); setState('failed') } })
    return () => { active = false }
  }, [token])

  return <main className="public-quote"><section className="panel">
    <header className="panel-header"><div><p className="eyebrow">FixTrack</p><h1>Email verification</h1></div><Wrench size={25} aria-hidden="true" /></header>
    <div className="panel-body stack">
      {state === 'working' && <StatePanel title="Verifying your email">One moment while the link is checked.</StatePanel>}
      {state === 'done' && <StatePanel title="Email verified" action={<Link className="btn btn-primary" to="/">Continue to FixTrack</Link>}>Your account can now create workspaces and accept invitations.</StatePanel>}
      {state === 'failed' && <><ErrorNotice message={error} /><StatePanel title="This link did not work" action={<Link className="btn btn-secondary" to="/">Go to sign in</Link>}>Sign in and request a new verification link.</StatePanel></>}
    </div>
  </section></main>
}
