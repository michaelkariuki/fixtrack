import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { inviteCreatedResponse, invitesResponse, membersResponse, successResponse, type Invite, type Member } from '../../../shared/contracts'
import { apiRequest, dateLabel, errorMessage } from '../api/client'
import { ErrorNotice, Field } from './ui'

export function TeamPanel({ workspaceId, currentUserId }: { workspaceId?: string; currentUserId: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [devLink, setDevLink] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const memberData = await apiRequest(`/workspaces/${encodeURIComponent(workspaceId)}/members`, membersResponse)
      setMembers(memberData.members)
      const own = memberData.members.find(member => member.user_id === currentUserId)
      if (own?.role === 'owner') {
        const inviteData = await apiRequest(`/workspaces/${encodeURIComponent(workspaceId)}/invites`, invitesResponse)
        setInvites(inviteData.invites)
      } else {
        setInvites([])
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, currentUserId])

  useEffect(() => { void load() }, [load])

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspaceId || busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true); setError(null); setNotice(null); setDevLink(null)
    try {
      const result = await apiRequest(`/workspaces/${encodeURIComponent(workspaceId)}/invites`, inviteCreatedResponse, {
        method: 'POST', body: JSON.stringify({ email: String(data.get('email') || ''), role: String(data.get('role') || 'member') }),
      })
      form.reset()
      setNotice(`Invitation created for ${result.invite.email}.`)
      setDevLink(result.dev_link ?? null)
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    if (!workspaceId || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await apiRequest(`/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(id)}`, successResponse, { method: 'DELETE' })
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function remove(member: Member) {
    if (!workspaceId || busy) return
    if (!window.confirm(`Remove ${member.email} from this workspace?`)) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await apiRequest(`/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.user_id)}`, successResponse, { method: 'DELETE' })
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!workspaceId) return <section className="panel"><div className="panel-body"><p className="text-muted">Create a workspace before inviting team members.</p></div></section>
  const isOwner = members.find(member => member.user_id === currentUserId)?.role === 'owner'

  return <section className="panel">
    <div className="panel-header"><h2>Team & invitations</h2><Users size={18} aria-hidden="true" /></div>
    <div className="panel-body stack">
      <p className="text-muted">Owners can invite people by email. The invited address must create an account with that email before accepting.</p>
      <ErrorNotice message={error} />
      {notice && <div className="notice notice-success" role="status">{notice}</div>}
      {devLink && <div className="notice"><div><strong>Email delivery is not configured here.</strong><p>Share this invitation link:</p><a href={devLink}>{devLink}</a></div></div>}
      {isOwner && <form className="stack" onSubmit={invite}>
        <div className="form-grid">
          <Field label="Email address"><input name="email" type="email" autoComplete="email" required placeholder="colleague@example.com" /></Field>
          <Field label="Role"><select name="role" defaultValue="member"><option value="member">Member</option><option value="owner">Owner</option></select></Field>
        </div>
        <div className="form-actions"><button className="btn btn-primary" disabled={busy}><UserPlus size={15} aria-hidden="true" />{busy ? 'Sending…' : 'Send invitation'}</button></div>
      </form>}
      <section>
        <h3>Members</h3>
        {loading ? <p className="text-muted">Loading team…</p> : <div className="stack">{members.map(member => <div key={member.user_id} className="queue-item"><div><strong>{member.name}</strong>{member.user_id === currentUserId ? ' (you)' : ''}<small>{member.email} · {member.role}</small></div>{isOwner && member.user_id !== currentUserId && <button className="btn btn-icon btn-secondary" title="Remove member" disabled={busy} onClick={() => void remove(member)}><Trash2 size={14} /></button>}</div>)}</div>}
      </section>
      <section>
        <h3>Pending invitations</h3>
        {invites.length === 0 ? <p className="text-muted">No pending invitations.</p> : <div className="stack">{invites.map(item => <div key={item.id} className="queue-item"><div><strong>{item.email}</strong><small>{item.role} · expires {dateLabel(item.expires_at)}</small></div>{isOwner && <button className="btn btn-icon btn-secondary" title="Revoke invitation" disabled={busy} onClick={() => void revoke(item.id)}><Trash2 size={14} /></button>}</div>)}</div>}
      </section>
    </div>
  </section>
}
