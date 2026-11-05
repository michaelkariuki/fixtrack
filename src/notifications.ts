import type { Bindings } from './db/client'
import { sendEmail } from './email'

export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-()]/g, '').replace(/^\+/, '')
  const digits = compact.startsWith('00254') ? compact.slice(2) : compact
  const normalized = /^0[71]\d{8}$/.test(digits) ? `254${digits.slice(1)}` : digits
  return /^254[71]\d{8}$/.test(normalized) ? `+${normalized}` : null
}

export async function sendSms(env: Bindings, to: string, message: string): Promise<{ ok: boolean; error?: string }> {
  if (!env.AT_API_KEY || !env.AT_USERNAME) return { ok: false, error: 'SMS is not configured for this deployment.' }
  const baseUrl = env.AT_USERNAME === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com'
  const body = new URLSearchParams({ username: env.AT_USERNAME, to, message })
  if (env.AT_SENDER_ID) body.set('from', env.AT_SENDER_ID)
  const response = await fetch(`${baseUrl}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey: env.AT_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  if (!response.ok) return { ok: false, error: `SMS provider returned status ${response.status}.` }
  const data = await response.json<{ SMSMessageData?: { Recipients?: { status?: string }[] } }>().catch(() => null)
  const status = data?.SMSMessageData?.Recipients?.[0]?.status
  return status === 'Success' ? { ok: true } : { ok: false, error: 'The SMS provider did not accept the message.' }
}

export async function sendNotificationEmail(env: Bindings, to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'Email is not configured for this deployment.' }
  const sent = await sendEmail(env, { to, subject, text })
  return sent ? { ok: true } : { ok: false, error: 'The email provider did not accept the message.' }
}
