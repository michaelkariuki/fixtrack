import type { Bindings } from './db/client'

type Message = { to: string; subject: string; text: string }

export async function sendEmail(env: Bindings, message: Message): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.warn(`Email is not configured; skipped "${message.subject}".`)
    return false
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'FixTrack <onboarding@resend.dev>',
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  })
  if (!response.ok) {
    console.error(`Email delivery failed with status ${response.status}.`)
    return false
  }
  return true
}
