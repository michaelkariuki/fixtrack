import { Hono } from 'hono'
import { appUrl, requireMembership, type AuthEnv } from '../auth'
import { rateLimit } from '../rate-limit'
import { normalizePhone, sendNotificationEmail, sendSms } from '../notifications'
import { notificationInputSchema } from '../../shared/contracts'

const notifications = new Hono<AuthEnv>()
type JobRow = {
  job_id: string; device_model: string; customer_name: string; customer_phone: string; customer_email: string | null
  workspace_name: string; approval_token: string | null; total_amount: number | null; quote_status: string | null
}

async function jobContext(c: { env: { DB: D1Database } }, workspaceId: string, jobId: string): Promise<JobRow | null> {
  return c.env.DB.prepare(`SELECT r.id AS job_id,r.device_model,c.name AS customer_name,c.phone AS customer_phone,c.email AS customer_email,w.name AS workspace_name,q.approval_token,q.total_amount,q.status AS quote_status
    FROM repair_jobs r JOIN customers c ON c.id=r.customer_id AND c.workspace_id=r.workspace_id JOIN workspaces w ON w.id=r.workspace_id
    LEFT JOIN quotes q ON q.id=(SELECT id FROM quotes WHERE job_id=r.id AND workspace_id=r.workspace_id ORDER BY version DESC,created_at DESC LIMIT 1)
    WHERE r.id=? AND r.workspace_id=?`).bind(jobId, workspaceId).first<JobRow>()
}

notifications.post('/', async c => {
  const input = notificationInputSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? 'Check the notification details.' }, 400)
  const denied = await requireMembership(c, input.data.workspace_id)
  if (denied) return denied
  const limited = await rateLimit(c, `notify:user:${c.get('user').id}`, 30, 3600)
  if (limited) return limited
  const job = await jobContext(c, input.data.workspace_id, input.data.job_id)
  if (!job) return c.json({ error: 'Job not found in this workspace.' }, 404)
  if (!job.approval_token || !job.total_amount || !['sent', 'approved'].includes(job.quote_status ?? '')) {
    return c.json({ error: 'Create a current quotation before notifying the customer.' }, 409)
  }

  const link = appUrl(c, `/quote/${job.approval_token}`)
  const message = job.quote_status === 'approved'
    ? `Hello ${job.customer_name}, your ${job.device_model} repair quote from ${job.workspace_name} is approved. View it and payment options here: ${link}`
    : `Hello ${job.customer_name}, ${job.workspace_name} prepared a ${job.device_model} repair quote of KES ${job.total_amount.toLocaleString('en-KE')}. Review and approve it here: ${link}`
  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  let recipient: string, provider: string, status: string, shareUrl: string | null = null
  let failure: string | null = null

  if (input.data.channel === 'whatsapp') {
    const phone = normalizePhone(job.customer_phone)
    if (!phone) return c.json({ error: 'This customer does not have a valid Kenyan mobile number.' }, 409)
    recipient = phone
    provider = 'wa.me'
    status = 'link_generated'
    shareUrl = `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`
  } else if (input.data.channel === 'email') {
    if (!job.customer_email) return c.json({ error: 'This customer has no email address on file.' }, 409)
    if (!c.env.RESEND_API_KEY) return c.json({ error: 'Email is not configured for this deployment.' }, 503)
    recipient = job.customer_email
    provider = 'resend'
    const result = await sendNotificationEmail(c.env, recipient, `Repair quote from ${job.workspace_name}`, message)
    status = result.ok ? 'sent' : 'failed'
    failure = result.error ?? null
  } else {
    const phone = normalizePhone(job.customer_phone)
    if (!phone) return c.json({ error: 'This customer does not have a valid Kenyan mobile number.' }, 409)
    if (!c.env.AT_API_KEY || !c.env.AT_USERNAME) return c.json({ error: 'SMS is not configured for this deployment.' }, 503)
    recipient = phone
    provider = 'africastalking'
    const result = await sendSms(c.env, recipient, message)
    status = result.ok ? 'sent' : 'failed'
    failure = result.error ?? null
  }

  await c.env.DB.prepare('INSERT INTO notifications (id,workspace_id,job_id,channel,recipient,status,provider,error,sent_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, input.data.workspace_id, input.data.job_id, input.data.channel, recipient, status, provider, failure, c.get('user').id, now).run()
  if (failure) return c.json({ error: failure }, 502)
  return c.json({ notification: { id, channel: input.data.channel, recipient, status, provider, error: null, created_at: now }, share_url: shareUrl }, 201)
})

notifications.get('/', async c => {
  const workspace = c.req.query('workspace_id'), job = c.req.query('job_id')
  if (!workspace || !job) return c.json({ error: 'Workspace and job are required.' }, 400)
  const denied = await requireMembership(c, workspace)
  if (denied) return denied
  const { results } = await c.env.DB.prepare('SELECT id,channel,recipient,status,provider,error,created_at FROM notifications WHERE workspace_id=? AND job_id=? ORDER BY created_at DESC LIMIT 20')
    .bind(workspace, job).all()
  return c.json({ notifications: results })
})

export default notifications
