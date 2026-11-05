import { Hono } from 'hono'
import { requireMembership, type AuthEnv } from '../auth'
import { quoteInputSchema,decisionInputSchema,type Quote,type QuoteItem } from '../../shared/contracts'
import { mpesaConfigured } from './mpesa'
const quotes = new Hono<AuthEnv>()
const quoteSelect=`SELECT q.id,q.job_id,q.version,q.total_amount,q.required_deposit,q.status,q.approved_at,q.customer_notes,q.terms,q.created_at,r.device_category,r.device_model,r.fault_description,r.status AS job_status,w.name AS workspace_name,w.phone AS workspace_phone,w.tax_id AS workspace_tax_id,w.address AS workspace_address,w.payment_instructions AS workspace_payment_instructions,w.quote_header AS workspace_quote_header,w.quote_footer AS workspace_quote_footer FROM quotes q JOIN repair_jobs r ON r.id=q.job_id AND r.workspace_id=q.workspace_id JOIN workspaces w ON w.id=q.workspace_id`
quotes.post('/',async c=>{
  const input=quoteInputSchema.safeParse(await c.req.json<unknown>().catch(()=>null)); if(!input.success) return c.json({error:input.error.issues[0]?.message || 'Check quotation amounts and terms.'},400)
  const body=input.data, db=c.env.DB
  const denied=await requireMembership(c,body.workspace_id); if(denied) return denied
  const job=await db.prepare('SELECT id FROM repair_jobs WHERE id=? AND workspace_id=?').bind(body.job_id,body.workspace_id).first(); if(!job) return c.json({error:'Job not found in this workspace.'},404)
  const id=crypto.randomUUID(), token=crypto.randomUUID().replace(/-/g,''); const total=body.items.reduce((sum,item)=>sum+item.quantity*item.unit_price,0)
  const result=await db.batch([
    db.prepare(`INSERT INTO quotes (id,job_id,workspace_id,version,total_amount,required_deposit,approval_token,status,terms) SELECT ?,?,?,COALESCE((SELECT MAX(version) FROM quotes WHERE job_id=? AND workspace_id=?),0)+1,?,?,?,'sent',? WHERE NOT EXISTS(SELECT 1 FROM quotes WHERE job_id=? AND workspace_id=? AND status='approved')`).bind(id,body.job_id,body.workspace_id,body.job_id,body.workspace_id,total,body.required_deposit,token,body.terms,body.job_id,body.workspace_id),
    ...body.items.map(item=>db.prepare(`INSERT INTO quote_items (id,quote_id,description,quantity,unit_price) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quotes WHERE id=?)`).bind(crypto.randomUUID(),id,item.description,item.quantity,item.unit_price,id)),
    db.prepare(`UPDATE quotes SET status='superseded' WHERE job_id=? AND workspace_id=? AND id<>? AND status IN ('sent','changes_requested','draft') AND EXISTS(SELECT 1 FROM quotes WHERE id=?)`).bind(body.job_id,body.workspace_id,id,id),
    db.prepare(`UPDATE repair_jobs SET status='diagnosed',updated_at=unixepoch() WHERE id=? AND workspace_id=? AND EXISTS(SELECT 1 FROM quotes WHERE id=?)`).bind(body.job_id,body.workspace_id,id)
  ])
  if(!result[0].meta.changes) return c.json({error:'The accepted quotation is frozen. Its scope and prices cannot be replaced.'},409)
  return c.json({quote:{id,total_amount:total,required_deposit:body.required_deposit,approval_token:token,approval_url:`/quote/${token}`}},201)
})
quotes.get('/job/:id',async c=>{
  const workspace=c.req.query('workspace_id'); if(!workspace) return c.json({error:'Choose a workspace.'},400)
  const denied=await requireMembership(c,workspace); if(denied) return denied
  const {results}=await c.env.DB.prepare(quoteSelect.replace('FROM quotes q',' ,q.approval_token FROM quotes q')+' WHERE q.job_id=? AND q.workspace_id=? ORDER BY q.version DESC,q.created_at DESC').bind(c.req.param('id'),workspace).all<Quote & {approval_token:string}>()
  const {results:items}=await c.env.DB.prepare('SELECT i.* FROM quote_items i JOIN quotes q ON q.id=i.quote_id WHERE q.job_id=? AND q.workspace_id=? ORDER BY i.rowid').bind(c.req.param('id'),workspace).all<QuoteItem & {quote_id:string}>()
  return c.json({quotes:results,items})
})
quotes.get('/public/:token',async c=>{
  const quote=await c.env.DB.prepare(quoteSelect+' WHERE q.approval_token=?').bind(c.req.param('token')).first<Quote>(); if(!quote) return c.json({error:'This quotation link was not found. Contact the repair shop.'},404)
  const {results:items}=await c.env.DB.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY rowid').bind(quote.id).all<QuoteItem>()
  if(quote.status!=='approved') return c.json({quote,items})
  const settled=await c.env.DB.prepare('SELECT COALESCE(SUM(p.amount),0) AS total_paid FROM payment_records p JOIN quotes q ON q.job_id=p.job_id AND q.workspace_id=p.workspace_id WHERE q.id=?').bind(quote.id).first<{total_paid:number}>()
  const total_paid=settled?.total_paid ?? 0
  return c.json({quote,items,payments:{total_paid,remaining_balance:Math.max(0,quote.total_amount-total_paid),mpesa_enabled:mpesaConfigured(c.env)}})
})
for (const action of ['approve','changes'] as const) quotes.post(`/public/:token/${action}`,async c=>{
  const input=decisionInputSchema.safeParse(await c.req.json<unknown>().catch(()=>null)); if(!input.success || (action==='changes' && !input.data.customer_notes?.trim())) return c.json({error:'Please enter the changes you want to request.'},400)
  const db=c.env.DB,token=c.req.param('token')
  const quote=await db.prepare('SELECT id,job_id,workspace_id,status FROM quotes WHERE approval_token=?').bind(token).first<{id:string;job_id:string;workspace_id:string;status:string}>(); if(!quote) return c.json({error:'Quote not found.'},404)
  if(action==='approve' && quote.status==='approved') return c.json({success:true})
  if(quote.status!=='sent') return c.json({error:'This quotation is no longer awaiting a decision. Ask the shop for its latest quotation.'},409)
  const status=action==='approve'?'approved':'changes_requested'
  const results=await db.batch([
    db.prepare(`UPDATE quotes SET status=?,approved_at=CASE WHEN ?='approved' THEN unixepoch() ELSE NULL END,customer_notes=? WHERE id=? AND status='sent' AND version=(SELECT MAX(version) FROM quotes WHERE job_id=? AND workspace_id=?)`).bind(status,status,input.data.customer_notes || null,quote.id,quote.job_id,quote.workspace_id),
    db.prepare(`UPDATE repair_jobs SET status='approved',updated_at=unixepoch() WHERE id=? AND workspace_id=? AND status='diagnosed' AND EXISTS(SELECT 1 FROM quotes WHERE id=? AND status='approved')`).bind(quote.job_id,quote.workspace_id,quote.id)
  ])
  if(!results[0].meta.changes) return c.json({error:'The quote changed while you were reviewing it. Reload before deciding.'},409)
  return c.json({success:true})
})
export default quotes
