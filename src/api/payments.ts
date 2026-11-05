import { Hono } from 'hono'
import { requireMembership, type AuthEnv } from '../auth'
import { paymentInputSchema,type paymentSchema } from '../../shared/contracts'
import type { z } from 'zod'
const payments=new Hono<AuthEnv>()
const totalQuery=`SELECT q.total_amount,COALESCE((SELECT SUM(amount) FROM payment_records p WHERE p.job_id=q.job_id AND p.workspace_id=q.workspace_id),0) AS total_paid FROM quotes q JOIN repair_jobs r ON r.id=q.job_id AND r.workspace_id=q.workspace_id WHERE q.job_id=? AND q.workspace_id=? AND q.status='approved' ORDER BY q.version DESC LIMIT 1`
payments.post('/',async c=>{
  const input=paymentInputSchema.safeParse(await c.req.json<unknown>().catch(()=>null)); if(!input.success) return c.json({error:input.error.issues[0]?.message || 'Check the payment details.'},400)
  const body=input.data,db=c.env.DB
  const denied=await requireMembership(c,body.workspace_id); if(denied) return denied
  const previous=await db.prepare('SELECT * FROM payment_records WHERE id=?').bind(body.request_id).first<z.infer<typeof paymentSchema> & {job_id:string;workspace_id:string}>()
  if(previous && (previous.workspace_id!==body.workspace_id || previous.job_id!==body.job_id || previous.amount!==body.amount || previous.payment_method!==body.payment_method || previous.reference_code!==(body.reference_code || null))) return c.json({error:'This payment request was already used for different details.'},409)
  if(!previous) {
    const result=await db.prepare(`INSERT OR IGNORE INTO payment_records (id,job_id,workspace_id,amount,payment_method,reference_code,notes) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quotes q JOIN repair_jobs r ON r.id=q.job_id AND r.workspace_id=q.workspace_id WHERE q.job_id=? AND q.workspace_id=? AND q.status='approved' AND q.total_amount-COALESCE((SELECT SUM(amount) FROM payment_records p WHERE p.job_id=q.job_id AND p.workspace_id=q.workspace_id),0)>=?)`).bind(body.request_id,body.job_id,body.workspace_id,body.amount,body.payment_method,body.reference_code || null,body.notes || null,body.job_id,body.workspace_id,body.amount).run()
    if(!result.meta.changes) {
      const duplicate=await db.prepare('SELECT id FROM payment_records WHERE id=? AND workspace_id=? AND job_id=? AND amount=? AND payment_method=? AND COALESCE(reference_code,\'\')=?').bind(body.request_id,body.workspace_id,body.job_id,body.amount,body.payment_method,body.reference_code || '').first()
      if(!duplicate) return c.json({error:'Payment requires an approved quote and cannot exceed its remaining balance. Refresh before trying again.'},409)
    }
  }
  const balance=await db.prepare(totalQuery).bind(body.job_id,body.workspace_id).first<{total_amount:number;total_paid:number}>(); if(!balance) return c.json({error:'Approved quote not found.'},404)
  // Financial settlement does not imply device readiness or collection.
  return c.json({payment:{id:body.request_id,total_paid:balance.total_paid,remaining_balance:balance.total_amount-balance.total_paid}},previous?200:201)
})
payments.get('/job/:job_id',async c=>{
  const workspace=c.req.query('workspace_id'); if(!workspace) return c.json({error:'Choose a workspace.'},400)
  const denied=await requireMembership(c,workspace); if(denied) return denied
  const db=c.env.DB,id=c.req.param('job_id'); const balance=await db.prepare(totalQuery).bind(id,workspace).first<{total_amount:number;total_paid:number}>(); if(!balance) return c.json({error:'An approved quotation is required before payments can be recorded.'},404)
  const {results}=await db.prepare('SELECT id,amount,payment_method,reference_code,notes,created_at FROM payment_records WHERE job_id=? AND workspace_id=? ORDER BY created_at DESC,id DESC').bind(id,workspace).all<z.infer<typeof paymentSchema>>()
  return c.json({...balance,remaining_balance:balance.total_amount-balance.total_paid,payments:results})
})
export default payments
