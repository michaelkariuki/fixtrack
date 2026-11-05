import { Hono } from 'hono'
import { z } from 'zod'
import { requireMembership, type AuthEnv } from '../auth'
import type { Bindings } from '../db/client'
import { rateLimit } from '../rate-limit'
import { resolveIntentInputSchema } from '../../shared/contracts'

const mpesa = new Hono<AuthEnv>()
const MAX_STK_AMOUNT = 150000
const ack = { ResultCode: 0, ResultDesc: 'Accepted' }

type MpesaConfig = { baseUrl: string; consumerKey: string; consumerSecret: string; shortcode: string; passkey: string; callbackToken?: string }

class MpesaError extends Error {
  constructor(message: string) { super(message); this.name = 'MpesaError' }
}

function config(env: Bindings): MpesaConfig | null {
  const { MPESA_CONSUMER_KEY: consumerKey, MPESA_CONSUMER_SECRET: consumerSecret, MPESA_SHORTCODE: shortcode, MPESA_PASSKEY: passkey } = env
  if (!consumerKey || !consumerSecret || !shortcode || !passkey) return null
  return {
    baseUrl: env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
    consumerKey, consumerSecret, shortcode, passkey, callbackToken: env.MPESA_CALLBACK_TOKEN,
  }
}

export function mpesaConfigured(env: Bindings): boolean {
  return config(env) !== null
}

function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-()]/g, '').replace(/^\+/, '')
  const digits = compact.startsWith('00254') ? compact.slice(2) : compact
  const normalized = /^0[71]\d{8}$/.test(digits) ? `254${digits.slice(1)}` : digits
  return /^254[71]\d{8}$/.test(normalized) ? normalized : null
}

function nairobiTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}${part('month')}${part('day')}${part('hour')}${part('minute')}${part('second')}`
}

function callbackUrl(env: Bindings, requestUrl: string, token?: string): string {
  const url = new URL(env.MPESA_CALLBACK_URL || '/api/mpesa/callback', requestUrl)
  if (token) url.searchParams.set('token', token)
  return url.toString()
}

function statusMessage(status: string): string {
  if (status === 'paid') return 'Payment received.'
  if (status === 'failed') return 'M-Pesa did not complete this payment. Try again or pay at the shop.'
  if (status === 'cancelled') return 'You cancelled the M-Pesa request.'
  if (status === 'unmatched') return 'Payment received. The shop will confirm it.'
  if (status === 'dismissed') return 'This payment request was closed by the shop.'
  return 'Enter your M-Pesa PIN on your phone.'
}

async function accessToken(cfg: MpesaConfig): Promise<string> {
  const response = await fetch(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${btoa(`${cfg.consumerKey}:${cfg.consumerSecret}`)}` },
  })
  if (!response.ok) throw new MpesaError('M-Pesa authentication failed. Check the deployment credentials.')
  const data = await response.json<{ access_token?: string }>().catch(() => null)
  if (!data?.access_token) throw new MpesaError('M-Pesa did not return an access token.')
  return data.access_token
}

type StkResult = { MerchantRequestID?: string; CheckoutRequestID: string; CustomerMessage?: string }

async function requestStk(cfg: MpesaConfig, token: string, input: { amount: number; phone: string; callbackUrl: string; accountReference: string }): Promise<StkResult> {
  const timestamp = nairobiTimestamp()
  const response = await fetch(`${cfg.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: cfg.shortcode,
      Password: btoa(`${cfg.shortcode}${cfg.passkey}${timestamp}`),
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: input.amount,
      PartyA: input.phone,
      PartyB: cfg.shortcode,
      PhoneNumber: input.phone,
      CallBackURL: input.callbackUrl,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: 'Repair job',
    }),
  })
  const data = await response.json<{ ResponseCode?: string; ResponseDescription?: string; errorMessage?: string } & StkResult>().catch(() => null)
  if (!response.ok || data?.ResponseCode !== '0' || !data.CheckoutRequestID) {
    throw new MpesaError(data?.errorMessage || data?.ResponseDescription || 'M-Pesa rejected the payment request.')
  }
  return data
}

const pushSchema = z.object({ quote_token: z.string().trim().min(1).max(200), phone: z.string().trim().min(9).max(20) })

const callbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().optional(),
      CheckoutRequestID: z.string().min(1),
      ResultCode: z.number().int(),
      ResultDesc: z.string().optional(),
      CallbackMetadata: z.object({ Item: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]) })) }).optional(),
    }),
  }),
})

type PendingIntent = { id: string; workspace_id: string; job_id: string; quote_id: string; amount: number; status: string }

mpesa.post('/stkpush', async c => {
  const parsed = pushSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Check the payment details.' }, 400)
  const phone = normalizePhone(parsed.data.phone)
  if (!phone) return c.json({ error: 'Enter a valid Safaricom number, for example 0712 345 678.' }, 400)
  const cfg = config(c.env)
  if (!cfg) return c.json({ error: 'M-Pesa is not configured for this deployment.' }, 503)
  const limited = await rateLimit(c, `mpesa:quote:${parsed.data.quote_token}`, 5, 600) || await rateLimit(c, `mpesa:phone:${phone}`, 3, 600)
  if (limited) return limited

  const db = c.env.DB
  const quote = await db.prepare('SELECT q.id,q.job_id,q.workspace_id,q.total_amount,q.status,r.job_number FROM quotes q JOIN repair_jobs r ON r.id=q.job_id AND r.workspace_id=q.workspace_id WHERE q.approval_token=?')
    .bind(parsed.data.quote_token).first<{ id: string; job_id: string; workspace_id: string; total_amount: number; status: string; job_number: string }>()
  if (!quote) return c.json({ error: 'This quotation link was not found.' }, 404)
  if (quote.status !== 'approved') return c.json({ error: 'The quotation must be approved before it can be paid.' }, 409)
  const settled = await db.prepare('SELECT COALESCE(SUM(amount),0) AS total_paid FROM payment_records WHERE job_id=? AND workspace_id=?').bind(quote.job_id, quote.workspace_id).first<{ total_paid: number }>()
  const amount = quote.total_amount - (settled?.total_paid ?? 0)
  if (amount <= 0) return c.json({ error: 'This quotation is already settled.' }, 409)
  if (amount > MAX_STK_AMOUNT) return c.json({ error: `M-Pesa accepts at most KES ${MAX_STK_AMOUNT.toLocaleString('en-KE')} per request. Pay at the shop or use a bank transfer.` }, 409)

  const id = crypto.randomUUID()
  await db.prepare('INSERT INTO payment_intents (id,workspace_id,job_id,quote_id,amount,phone) VALUES (?,?,?,?,?,?)').bind(id, quote.workspace_id, quote.job_id, quote.id, amount, phone).run()
  try {
    const token = await accessToken(cfg)
    const result = await requestStk(cfg, token, { amount, phone, callbackUrl: callbackUrl(c.env, c.req.url, cfg.callbackToken), accountReference: quote.job_number })
    await db.prepare('UPDATE payment_intents SET merchant_request_id=?,checkout_request_id=?,updated_at=unixepoch() WHERE id=?').bind(result.MerchantRequestID ?? null, result.CheckoutRequestID, id).run()
    return c.json({ intent: { id, amount, status: 'pending', message: result.CustomerMessage || 'Enter your M-Pesa PIN on your phone.', provider_receipt: null, created_at: Math.floor(Date.now() / 1000) } }, 201)
  } catch (cause) {
    const message = cause instanceof MpesaError ? cause.message : 'M-Pesa could not be reached. Try again or pay at the shop.'
    await db.prepare(`UPDATE payment_intents SET status='failed',result_desc=?,updated_at=unixepoch() WHERE id=?`).bind(message.slice(0, 300), id).run()
    console.error('M-Pesa STK push failed:', message)
    return c.json({ error: message }, 502)
  }
})

mpesa.post('/callback', async c => {
  if (c.env.MPESA_CALLBACK_TOKEN && c.req.query('token') !== c.env.MPESA_CALLBACK_TOKEN) return c.json({ ResultCode: 1, ResultDesc: 'Not found' }, 404)
  const parsed = callbackSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!parsed.success) return c.json({ ResultCode: 1, ResultDesc: 'Invalid callback' }, 400)
  const callback = parsed.data.Body.stkCallback
  const db = c.env.DB
  const intent = await db.prepare('SELECT id,workspace_id,job_id,quote_id,amount,status FROM payment_intents WHERE checkout_request_id=?').bind(callback.CheckoutRequestID).first<PendingIntent>()
  if (!intent) {
    console.warn('M-Pesa callback for an unknown checkout request.')
    return c.json(ack)
  }
  if (intent.status === 'paid') return c.json(ack)

  if (callback.ResultCode !== 0) {
    const status = callback.ResultCode === 1032 ? 'cancelled' : 'failed'
    await db.prepare('UPDATE payment_intents SET status=?,result_code=?,result_desc=?,updated_at=unixepoch() WHERE id=?')
      .bind(status, callback.ResultCode, (callback.ResultDesc ?? '').slice(0, 300), intent.id).run()
    return c.json(ack)
  }

  const items = callback.CallbackMetadata?.Item ?? []
  const value = (name: string) => items.find(item => item.Name === name)?.Value
  const receiptValue = value('MpesaReceiptNumber')
  const receipt = typeof receiptValue === 'string' ? receiptValue.trim() : ''
  const amountValue = value('Amount')
  const amount = typeof amountValue === 'number' ? amountValue : Number(amountValue)
  const received = Number.isSafeInteger(amount) && amount > 0 ? amount : null
  const markUnmatched = async (description: string) => {
    await db.prepare('UPDATE payment_intents SET status=\'unmatched\',result_code=0,result_desc=?,provider_receipt=?,received_amount=?,updated_at=unixepoch() WHERE id=?')
      .bind(description.slice(0, 300), receipt || null, received, intent.id).run()
  }
  if (!receipt || !Number.isSafeInteger(amount) || amount !== intent.amount) {
    await markUnmatched('Callback amount or receipt did not match the pending request.')
    return c.json(ack)
  }

  const paymentId = `mpesa-${callback.CheckoutRequestID}`
  const inserted = await db.prepare(`INSERT OR IGNORE INTO payment_records (id,job_id,workspace_id,amount,payment_method,reference_code,notes)
    SELECT ?,?,?,?, 'mpesa', ?, ?
    WHERE EXISTS(SELECT 1 FROM quotes q WHERE q.id=? AND q.status='approved' AND q.total_amount-COALESCE((SELECT SUM(amount) FROM payment_records p WHERE p.job_id=q.job_id AND p.workspace_id=q.workspace_id),0)>=?)`)
    .bind(paymentId, intent.job_id, intent.workspace_id, amount, receipt, 'Confirmed by M-Pesa STK Push.', intent.quote_id, amount).run()
  const applied = inserted.meta.changes > 0 || Boolean(await db.prepare('SELECT id FROM payment_records WHERE id=?').bind(paymentId).first())
  if (!applied) {
    await markUnmatched('The payment could not be applied to the remaining balance.')
    return c.json(ack)
  }
  await db.prepare('UPDATE payment_intents SET status=\'paid\',result_code=0,result_desc=?,provider_receipt=?,payment_record_id=?,updated_at=unixepoch() WHERE id=?')
    .bind(callback.ResultDesc ?? 'Payment received.', receipt, paymentId, intent.id).run()
  return c.json(ack)
})

mpesa.get('/intent/:id', async c => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Choose a quotation to view this payment.' }, 400)
  const intent = await c.env.DB.prepare('SELECT i.id,i.amount,i.status,i.provider_receipt,i.created_at FROM payment_intents i JOIN quotes q ON q.id=i.quote_id WHERE i.id=? AND q.approval_token=?')
    .bind(c.req.param('id'), token).first<{ id: string; amount: number; status: string; provider_receipt: string | null; created_at: number }>()
  if (!intent) return c.json({ error: 'Payment request not found.' }, 404)
  return c.json({ intent: { ...intent, message: statusMessage(intent.status) } })
})

mpesa.get('/unmatched', async c => {
  const workspace = c.req.query('workspace_id'), job = c.req.query('job_id')
  if (!workspace) return c.json({ error: 'Choose a workspace.' }, 400)
  const denied = await requireMembership(c, workspace)
  if (denied) return denied
  const sql = `SELECT id,amount,received_amount,phone,provider_receipt,result_desc,created_at FROM payment_intents WHERE workspace_id=? AND status='unmatched'${job ? ' AND job_id=?' : ''} ORDER BY created_at DESC LIMIT 50`
  const statement = c.env.DB.prepare(sql)
  const { results } = await (job ? statement.bind(workspace, job) : statement.bind(workspace)).all()
  return c.json({ intents: results })
})

mpesa.post('/intents/:id/resolve', async c => {
  const input = resolveIntentInputSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: 'Choose whether to record or dismiss the payment.' }, 400)
  const denied = await requireMembership(c, input.data.workspace_id)
  if (denied) return denied
  const db = c.env.DB
  const intent = await db.prepare('SELECT id,job_id,workspace_id,quote_id,amount,received_amount,provider_receipt,status FROM payment_intents WHERE id=? AND workspace_id=?')
    .bind(c.req.param('id'), input.data.workspace_id).first<{ id: string; job_id: string; workspace_id: string; quote_id: string; amount: number; received_amount: number | null; provider_receipt: string | null; status: string }>()
  if (!intent) return c.json({ error: 'Payment request not found.' }, 404)
  if (intent.status !== 'unmatched') return c.json({ error: 'This payment request is not awaiting review.' }, 409)
  const resolvedAt = Math.floor(Date.now() / 1000), userId = c.get('user').id

  if (input.data.action === 'dismiss') {
    await db.prepare("UPDATE payment_intents SET status='dismissed',resolution='dismissed',resolved_at=?,resolved_by=?,updated_at=unixepoch() WHERE id=?")
      .bind(resolvedAt, userId, intent.id).run()
    return c.json({ success: true })
  }

  const amount = intent.received_amount ?? intent.amount
  if (!Number.isSafeInteger(amount) || amount <= 0) return c.json({ error: 'No valid received amount is available for this payment.' }, 409)
  const paymentId = `mpesa-resolved-${intent.id}`
  const inserted = await db.prepare(`INSERT OR IGNORE INTO payment_records (id,job_id,workspace_id,amount,payment_method,reference_code,notes)
    SELECT ?,?,?,?, 'mpesa', ?, ?
    WHERE EXISTS(SELECT 1 FROM quotes q WHERE q.id=? AND q.status='approved' AND q.total_amount-COALESCE((SELECT SUM(amount) FROM payment_records p WHERE p.job_id=q.job_id AND p.workspace_id=q.workspace_id),0)>=?)`)
    .bind(paymentId, intent.job_id, intent.workspace_id, amount, intent.provider_receipt, 'Recorded from unmatched M-Pesa review.', intent.quote_id, amount).run()
  const applied = inserted.meta.changes > 0 || Boolean(await db.prepare('SELECT id FROM payment_records WHERE id=?').bind(paymentId).first())
  if (!applied) return c.json({ error: 'The remaining balance no longer allows this payment. Refresh before trying again.' }, 409)
  await db.prepare("UPDATE payment_intents SET status='paid',payment_record_id=?,resolution='recorded',resolved_at=?,resolved_by=?,updated_at=unixepoch() WHERE id=?")
    .bind(paymentId, resolvedAt, userId, intent.id).run()
  return c.json({ success: true })
})

export default mpesa
