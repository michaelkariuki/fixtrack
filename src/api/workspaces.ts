import { Hono } from 'hono'
import { z } from 'zod'
import { appUrl, devLink, hashToken, requireMembership, requireOwner, requireVerified, type AuthEnv } from '../auth'
import { sendEmail } from '../email'
import { rateLimit } from '../rate-limit'
import { workspaceInputSchema, type Workspace } from '../../shared/contracts'

const workspaces = new Hono<AuthEnv>()
const inviteInput = z.object({ email: z.email('Enter a valid email address.').max(254), role: z.enum(['owner', 'member']).default('member') })

workspaces.get('/', async c => {
  const { results } = await c.env.DB.prepare('SELECT w.* FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at,w.id')
    .bind(c.get('user').id).all<Workspace>()
  return c.json({ workspaces: results })
})

workspaces.post('/', async c => {
  const unverified = requireVerified(c)
  if (unverified) return unverified
  const input = workspaceInputSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: 'Business name and contact phone are required.' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO workspaces (id,name,phone,location,tax_id,address,payment_instructions,quote_header,quote_footer) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, input.data.name, input.data.phone, input.data.location || null, input.data.tax_id || null, input.data.address || null, input.data.payment_instructions || null, input.data.quote_header || null, input.data.quote_footer || null),
    c.env.DB.prepare("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES (?,?,'owner')").bind(id, c.get('user').id),
  ])
  return c.json({ workspace: await c.env.DB.prepare('SELECT * FROM workspaces WHERE id=?').bind(id).first<Workspace>() }, 201)
})

workspaces.patch('/:id', async c => {
  const id = c.req.param('id')
  const denied = await requireMembership(c, id)
  if (denied) return denied
  const input = workspaceInputSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: 'Business name and contact phone are required.' }, 400)
  const result = await c.env.DB.prepare('UPDATE workspaces SET name=?,phone=?,location=?,tax_id=?,address=?,payment_instructions=?,quote_header=?,quote_footer=? WHERE id=?')
    .bind(input.data.name, input.data.phone, input.data.location || null, input.data.tax_id || null, input.data.address || null, input.data.payment_instructions || null, input.data.quote_header || null, input.data.quote_footer || null, id).run()
  if (!result.meta.changes) return c.json({ error: 'Workspace not found.' }, 404)
  return c.json({ workspace: await c.env.DB.prepare('SELECT * FROM workspaces WHERE id=?').bind(id).first<Workspace>() })
})

workspaces.get('/:id/members', async c => {
  const workspaceId = c.req.param('id')
  const denied = await requireMembership(c, workspaceId)
  if (denied) return denied
  const { results } = await c.env.DB.prepare(`SELECT u.id AS user_id,u.email,u.name,m.role,m.created_at FROM workspace_members m JOIN owner_users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at,u.email`)
    .bind(workspaceId).all()
  return c.json({ members: results })
})

workspaces.post('/:id/invites', async c => {
  const workspaceId = c.req.param('id')
  const owner = await requireOwner(c, workspaceId)
  if (owner) return owner
  const unverified = requireVerified(c)
  if (unverified) return unverified
  const limited = await rateLimit(c, `invite:user:${c.get('user').id}`, 20, 3600)
  if (limited) return limited
  const input = inviteInput.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? 'Enter a valid invitation.' }, 400)
  const email = input.data.email.trim().toLowerCase()
  const existing = await c.env.DB.prepare('SELECT 1 FROM workspace_members m JOIN owner_users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?')
    .bind(workspaceId, email).first()
  if (existing) return c.json({ error: 'This person is already a member of the workspace.' }, 409)
  await c.env.DB.prepare('DELETE FROM workspace_invites WHERE workspace_id=? AND email=? AND accepted_at IS NULL').bind(workspaceId, email).run()
  const id = crypto.randomUUID(), token = crypto.randomUUID().replace(/-/g, ''), expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
  const workspace = await c.env.DB.prepare('SELECT name FROM workspaces WHERE id=?').bind(workspaceId).first<{ name: string }>()
  await c.env.DB.prepare('INSERT INTO workspace_invites (id,workspace_id,email,role,token_hash,invited_by,expires_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, workspaceId, email, input.data.role, await hashToken(token), c.get('user').id, expiresAt).run()
  const path = `/invite/${token}`
  await sendEmail(c.env, {
    to: email,
    subject: `Invitation to ${workspace?.name ?? 'a FixTrack workspace'}`,
    text: `${c.get('user').name} invited you to join ${workspace?.name ?? 'a FixTrack workspace'} as ${input.data.role}.\n\nAccept the invitation:\n${appUrl(c, path)}\n\nThis link expires in 7 days.`,
  })
  return c.json({
    invite: { id, email, role: input.data.role, expires_at: expiresAt, created_at: Math.floor(Date.now() / 1000) },
    dev_link: devLink(c, path),
  }, 201)
})

workspaces.get('/:id/invites', async c => {
  const workspaceId = c.req.param('id')
  const owner = await requireOwner(c, workspaceId)
  if (owner) return owner
  const { results } = await c.env.DB.prepare('SELECT id,email,role,expires_at,created_at FROM workspace_invites WHERE workspace_id=? AND accepted_at IS NULL AND expires_at>unixepoch() ORDER BY created_at DESC')
    .bind(workspaceId).all()
  return c.json({ invites: results })
})

workspaces.delete('/:id/invites/:inviteId', async c => {
  const workspaceId = c.req.param('id')
  const owner = await requireOwner(c, workspaceId)
  if (owner) return owner
  const result = await c.env.DB.prepare('DELETE FROM workspace_invites WHERE id=? AND workspace_id=?').bind(c.req.param('inviteId'), workspaceId).run()
  if (!result.meta.changes) return c.json({ error: 'Invitation not found.' }, 404)
  return c.json({ success: true })
})

workspaces.delete('/:id/members/:userId', async c => {
  const workspaceId = c.req.param('id'), userId = c.req.param('userId')
  const owner = await requireOwner(c, workspaceId)
  if (owner) return owner
  const target = await c.env.DB.prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?').bind(workspaceId, userId).first<{ role: string }>()
  if (!target) return c.json({ error: 'Member not found.' }, 404)
  if (target.role === 'owner') {
    const owners = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id=? AND role='owner'").bind(workspaceId).first<{ count: number }>()
    if ((owners?.count ?? 0) <= 1) return c.json({ error: 'A workspace must keep at least one owner.' }, 409)
  }
  await c.env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').bind(workspaceId, userId).run()
  return c.json({ success: true })
})

export default workspaces
