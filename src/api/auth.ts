import { Hono } from 'hono'
import { z } from 'zod'
import {
  appUrl, consumeToken, createSession, currentUser, destroySession, destroyUserSessions,
  devLink, hashPassword, issueToken, verifyPassword, type AuthEnv,
} from '../auth'
import { sendEmail } from '../email'
import { clientAddress, rateLimit } from '../rate-limit'

const auth = new Hono<AuthEnv>()
const signupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  email: z.email('Enter a valid email address.').max(254),
  password: z.string().min(10, 'Use at least 10 characters for the password.').max(200),
})
const loginSchema = z.object({
  email: z.email('Enter a valid email address.').max(254),
  password: z.string().min(1, 'Enter your password.').max(200),
})
const tokenSchema = z.object({ token: z.string().trim().min(20, 'This link is invalid or expired.').max(200) })
const resetSchema = z.object({
  token: z.string().trim().min(20, 'This link is invalid or expired.').max(200),
  password: z.string().min(10, 'Use at least 10 characters for the password.').max(200),
})

auth.post('/signup', async c => {
  const limited = await rateLimit(c, `signup:${clientAddress(c)}`, 5, 3600)
  if (limited) return limited
  const input = signupSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? 'Check your account details.' }, 400)
  const email = input.data.email.trim().toLowerCase()
  if (await c.env.DB.prepare('SELECT id FROM owner_users WHERE email=?').bind(email).first()) {
    return c.json({ error: 'An account with this email already exists. Sign in instead.' }, 409)
  }
  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare('INSERT INTO owner_users (id,email,name,password_hash) VALUES (?,?,?,?)')
      .bind(id, email, input.data.name, await hashPassword(input.data.password)).run()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error('Account creation failed:', message)
    const duplicate = message.toUpperCase().includes('UNIQUE')
    return c.json({ error: duplicate ? 'An account with this email already exists. Sign in instead.' : 'The account could not be created. Try again.' }, duplicate ? 409 : 500)
  }
  const token = await issueToken(c, id, 'verify_email', 60 * 60 * 24)
  const link = appUrl(c, `/verify/${token}`)
  await sendEmail(c.env, {
    to: email,
    subject: 'Verify your FixTrack email',
    text: `Hello ${input.data.name},\n\nVerify your email address to finish setting up FixTrack:\n${link}\n\nThis link expires in 24 hours.`,
  })
  await createSession(c, id)
  return c.json({ user: { id, email, name: input.data.name, email_verified: false }, dev_link: devLink(c, `/verify/${token}`) }, 201)
})

auth.post('/login', async c => {
  const input = loginSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? 'Check your sign-in details.' }, 400)
  const email = input.data.email.trim().toLowerCase()
  const limited = await rateLimit(c, `login:ip:${clientAddress(c)}`, 20, 900) || await rateLimit(c, `login:acct:${email}`, 10, 900)
  if (limited) return limited
  const user = await c.env.DB.prepare('SELECT id,email,name,password_hash,email_verified_at FROM owner_users WHERE email=?')
    .bind(email).first<{ id: string; email: string; name: string; password_hash: string; email_verified_at: number | null }>()
  if (!user || !(await verifyPassword(input.data.password, user.password_hash))) {
    return c.json({ error: 'Email or password is incorrect.' }, 401)
  }
  await createSession(c, user.id)
  return c.json({ user: { id: user.id, email: user.email, name: user.name, email_verified: Boolean(user.email_verified_at) } })
})

auth.post('/logout', async c => {
  await destroySession(c)
  return c.json({ success: true })
})

auth.get('/me', async c => {
  return c.json({ user: await currentUser(c) })
})

auth.post('/verify-email', async c => {
  const input = tokenSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? 'This link is invalid or expired.' }, 400)
  const userId = await consumeToken(c, input.data.token, 'verify_email', true)
  if (!userId) return c.json({ error: 'This verification link is invalid or expired. Sign in and request a new one.' }, 400)
  await c.env.DB.prepare('UPDATE owner_users SET email_verified_at=unixepoch() WHERE id=? AND email_verified_at IS NULL').bind(userId).run()
  return c.json({ success: true })
})

auth.post('/resend-verification', async c => {
  const user = c.get('user')
  if (user.email_verified) return c.json({ error: 'This email address is already verified.' }, 409)
  const limited = await rateLimit(c, `verify:user:${user.id}`, 3, 3600)
  if (limited) return limited
  const token = await issueToken(c, user.id, 'verify_email', 60 * 60 * 24)
  const link = appUrl(c, `/verify/${token}`)
  await sendEmail(c.env, {
    to: user.email,
    subject: 'Verify your FixTrack email',
    text: `Verify your email address to finish setting up FixTrack:\n${link}\n\nThis link expires in 24 hours.`,
  })
  return c.json({ success: true, dev_link: devLink(c, `/verify/${token}`) })
})

auth.post('/forgot-password', async c => {
  const input = z.object({ email: z.email('Enter a valid email address.').max(254) }).safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? 'Enter your email address.' }, 400)
  const email = input.data.email.trim().toLowerCase()
  const limited = await rateLimit(c, `forgot:ip:${clientAddress(c)}`, 5, 3600) || await rateLimit(c, `forgot:acct:${email}`, 3, 3600)
  if (limited) return limited
  const user = await c.env.DB.prepare('SELECT id,name FROM owner_users WHERE email=?').bind(email).first<{ id: string; name: string }>()
  let resetPath: string | null = null
  if (user) {
    const token = await issueToken(c, user.id, 'reset_password', 60 * 60)
    resetPath = `/reset/${token}`
    const link = appUrl(c, resetPath)
    await sendEmail(c.env, {
      to: email,
      subject: 'Reset your FixTrack password',
      text: `Hello ${user.name},\n\nReset your FixTrack password:\n${link}\n\nThis link expires in 1 hour. If you did not request this, ignore this message.`,
    })
  }
  return c.json({ success: true, dev_link: resetPath ? devLink(c, resetPath) : null })
})

auth.post('/reset-password', async c => {
  const limited = await rateLimit(c, `reset:ip:${clientAddress(c)}`, 10, 3600)
  if (limited) return limited
  const input = resetSchema.safeParse(await c.req.json<unknown>().catch(() => null))
  if (!input.success) return c.json({ error: input.error.issues[0]?.message ?? 'Check the new password.' }, 400)
  const userId = await consumeToken(c, input.data.token, 'reset_password')
  if (!userId) return c.json({ error: 'This reset link is invalid or expired. Request a new one.' }, 400)
  await c.env.DB.prepare('UPDATE owner_users SET password_hash=? WHERE id=?').bind(await hashPassword(input.data.password), userId).run()
  await destroyUserSessions(c, userId)
  return c.json({ success: true })
})

export default auth
