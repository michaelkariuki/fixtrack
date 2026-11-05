import { Hono } from 'hono'
import { hashToken, requireVerified, type AuthContext, type AuthEnv } from '../auth'

const invites = new Hono<AuthEnv>()
type InviteRow = { id: string; workspace_id: string; email: string; role: string; workspace_name: string; inviter_name: string; expires_at: number }

async function pendingInvite(c: AuthContext, token: string): Promise<InviteRow | null> {
  return c.env.DB.prepare(`SELECT i.id,i.workspace_id,i.email,i.role,w.name AS workspace_name,u.name AS inviter_name,i.expires_at
    FROM workspace_invites i JOIN workspaces w ON w.id=i.workspace_id JOIN owner_users u ON u.id=i.invited_by
    WHERE i.token_hash=? AND i.accepted_at IS NULL AND i.expires_at>unixepoch()`)
    .bind(await hashToken(token)).first<InviteRow>()
}

invites.get('/:token', async c => {
  const invite = await pendingInvite(c, c.req.param('token'))
  if (!invite) return c.json({ error: 'This invitation is invalid or has expired.' }, 404)
  return c.json({ invite: { workspace_name: invite.workspace_name, email: invite.email, role: invite.role, inviter_name: invite.inviter_name, expires_at: invite.expires_at } })
})

invites.post('/:token/accept', async c => {
  const user = c.get('user')
  const unverified = requireVerified(c)
  if (unverified) return unverified
  const invite = await pendingInvite(c, c.req.param('token'))
  if (!invite) return c.json({ error: 'This invitation is invalid or has expired.' }, 404)
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) return c.json({ error: 'This invitation was sent to a different email address.' }, 403)
  const existing = await c.env.DB.prepare('SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=?').bind(invite.workspace_id, user.id).first()
  if (!existing) {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,role) VALUES (?,?,?)').bind(invite.workspace_id, user.id, invite.role),
      c.env.DB.prepare('UPDATE workspace_invites SET accepted_at=unixepoch() WHERE id=? AND accepted_at IS NULL').bind(invite.id),
    ])
  }
  return c.json({ workspace: { id: invite.workspace_id, name: invite.workspace_name } })
})

export default invites
