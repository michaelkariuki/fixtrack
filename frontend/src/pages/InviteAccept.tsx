import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { acceptedInviteResponse, publicInviteResponse } from '../../../shared/contracts'
import type { z } from 'zod'
import { apiRequest, errorMessage } from '../api/client'
import { ErrorNotice, StatePanel } from '../components/ui'
import { useAuth } from '../state/Auth'

type Invite = z.infer<typeof publicInviteResponse>['invite']

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>()
  const { user, loading } = useAuth()
  const [invite, setInvite] = useState<Invite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) { setError('This invitation link is incomplete.'); return }
    let active = true
    void apiRequest(`/invites/${encodeURIComponent(token)}`, publicInviteResponse)
      .then(result => { if (active) setInvite(result.invite) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [token])

  async function accept() {
    if (!token || busy) return
    setBusy(true); setError(null)
    try {
      await apiRequest(`/invites/${encodeURIComponent(token)}/accept`, acceptedInviteResponse, { method: 'POST', body: '{}' })
      window.location.assign('/')
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  if (loading) return <main className="public-quote"><StatePanel title="Checking your session">One moment.</StatePanel></main>
  if (!user) return <Navigate to={`/?next=${encodeURIComponent(`/invite/${token ?? ''}`)}`} replace />

  return <main className="public-quote"><section className="panel">
    <header className="panel-header"><div><p className="eyebrow">Workspace invitation</p><h1>{invite ? `Join ${invite.workspace_name}` : 'Workspace invitation'}</h1></div><Wrench size={25} aria-hidden="true" /></header>
    <div className="panel-body stack">
      <ErrorNotice message={error} />
      {invite ? <>
        <p className="text-muted">{invite.inviter_name} invited <strong>{invite.email}</strong> to join <strong>{invite.workspace_name}</strong> as {invite.role}.</p>
        {invite.email.toLowerCase() !== user.email.toLowerCase()
          ? <StatePanel title="This invitation is for a different email">You are signed in as {user.email}. Sign in with the invited address to accept.</StatePanel>
          : <button className="btn btn-primary" disabled={busy} onClick={() => void accept()}>{busy ? 'Joining…' : 'Accept invitation'}</button>}
      </> : !error && <StatePanel title="Loading invitation">Checking the invitation link.</StatePanel>}
    </div>
  </section></main>
}
