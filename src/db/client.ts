export type Bindings = {
  DB: D1Database
  ATTACHMENTS: R2Bucket
  MPESA_ENV?: 'sandbox' | 'production'
  MPESA_CONSUMER_KEY?: string
  MPESA_CONSUMER_SECRET?: string
  MPESA_SHORTCODE?: string
  MPESA_PASSKEY?: string
  MPESA_CALLBACK_URL?: string
  MPESA_CALLBACK_TOKEN?: string
  APP_URL?: string
  AUTH_DEV_LINKS?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  AT_API_KEY?: string
  AT_USERNAME?: string
  AT_SENDER_ID?: string
}

export function getDB(c: { env: Bindings }) {
  return c.env.DB
}

export function getAttachments(c: { env: Bindings }) {
  return c.env.ATTACHMENTS
}
