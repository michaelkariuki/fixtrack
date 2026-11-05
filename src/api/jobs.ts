import { Hono } from 'hono'
import { requireMembership, type AuthEnv } from '../auth'
import { jobInputSchema, statusInputSchema, type Job, type JobStatus } from '../../shared/contracts'
const jobs = new Hono<AuthEnv>()
jobs.post('/', async c => {
  const input = jobInputSchema.safeParse(await c.req.json<unknown>().catch(() => null)); if (!input.success) return c.json({error:input.error.issues[0]?.message || 'Check customer and device details.'},400)
  const body = input.data; const db = c.env.DB
  const denied = await requireMembership(c, body.workspace_id); if (denied) return denied
  const customerId = crypto.randomUUID(); const jobId = crypto.randomUUID(); const jobNumber = `JOB-${jobId.slice(0,8).toUpperCase()}`
  await db.batch([
    db.prepare('INSERT INTO customers (id,workspace_id,name,phone,email) VALUES (?,?,?,?,?)').bind(customerId,body.workspace_id,body.customer_name,body.customer_phone,body.customer_email || null),
    db.prepare(`INSERT INTO repair_jobs (id,workspace_id,customer_id,job_number,device_category,device_model,serial_number,fault_description,accessories_included,status) VALUES (?,?,?,?,?,?,?,?,?,'received')`).bind(jobId,body.workspace_id,customerId,jobNumber,body.device_category,body.device_model,body.serial_number || null,body.fault_description,body.accessories_included || null)
  ])
  return c.json({job:{id:jobId,job_number:jobNumber,customer_id:customerId,status:'received'}},201)
})
jobs.get('/', async c => {
  const workspaceId = c.req.query('workspace_id'); if (!workspaceId) return c.json({error:'Choose a business workspace.'},400)
  const denied = await requireMembership(c, workspaceId); if (denied) return denied
  const {results} = await c.env.DB.prepare(`SELECT r.*, c.name AS customer_name,c.phone AS customer_phone,c.email AS customer_email,q.total_amount,q.required_deposit,q.status AS quote_status,COALESCE((SELECT SUM(p.amount) FROM payment_records p WHERE p.job_id=r.id AND p.workspace_id=r.workspace_id),0) AS total_paid FROM repair_jobs r JOIN customers c ON c.id=r.customer_id AND c.workspace_id=r.workspace_id LEFT JOIN quotes q ON q.id=(SELECT id FROM quotes WHERE job_id=r.id AND workspace_id=r.workspace_id ORDER BY version DESC,created_at DESC,id DESC LIMIT 1) WHERE r.workspace_id=? ORDER BY r.created_at DESC,r.id DESC`).bind(workspaceId).all<Job>()
  return c.json({jobs:results})
})
jobs.patch('/:id/status', async c => {
  const input = statusInputSchema.safeParse(await c.req.json<unknown>().catch(() => null)); if (!input.success) return c.json({error:'Invalid repair status.'},400)
  const db=c.env.DB; const {workspace_id,status}=input.data; const id=c.req.param('id')
  const denied = await requireMembership(c, workspace_id); if (denied) return denied
  const job=await db.prepare('SELECT status FROM repair_jobs WHERE id=? AND workspace_id=?').bind(id,workspace_id).first<{status:JobStatus}>(); if (!job) return c.json({error:'Job not found.'},404)
  const transitions: Partial<Record<JobStatus,JobStatus>>={approved:'in_repair',in_repair:'ready',ready:'delivered'}
  if (transitions[job.status]!==status) return c.json({error:'This repair transition is not available. Quotation approval is handled by the customer.'},409)
  const result=await db.prepare(`UPDATE repair_jobs SET status=?,updated_at=unixepoch() WHERE id=? AND workspace_id=? AND status=? AND (?<>'delivered' OR EXISTS(SELECT 1 FROM quotes q WHERE q.job_id=repair_jobs.id AND q.workspace_id=repair_jobs.workspace_id AND q.status='approved' AND q.total_amount=COALESCE((SELECT SUM(amount) FROM payment_records p WHERE p.job_id=repair_jobs.id AND p.workspace_id=repair_jobs.workspace_id),0)))`).bind(status,id,workspace_id,job.status,status).run()
  if (!result.meta.changes) return c.json({error:'Collection requires a settled balance and a ready device. Refresh the job and try again.'},409)
  return c.json({success:true})
})
export default jobs
