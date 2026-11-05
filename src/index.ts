import { Hono } from 'hono'
import { currentUser, type AuthEnv } from './auth'
import jobs from './api/jobs'
import quotes from './api/quotes'
import payments from './api/payments'
import workspaces from './api/workspaces'
import attachments from './api/attachments'
import mpesa from './api/mpesa'
import auth from './api/auth'
import invites from './api/invites'
import notifications from './api/notifications'

const app = new Hono<AuthEnv>()
const publicApi = [
  /^\/api\/health$/,
  /^\/api\/auth\/(signup|login|logout|me|verify-email|forgot-password|reset-password)$/,
  /^\/api\/quotes\/public\//,
  /^\/api\/mpesa\/(callback|stkpush)$/,
  /^\/api\/mpesa\/intent\//,
]
const publicInvite = /^\/api\/invites\/[^/]+$/

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (publicApi.some(pattern => pattern.test(path)) || (c.req.method === 'GET' && publicInvite.test(path))) return next()
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401)
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('Origin')
    const allowed = new Set([new URL(c.req.url).origin])
    if (c.env.APP_URL) allowed.add(new URL(c.env.APP_URL).origin)
    if (origin && !allowed.has(origin)) return c.json({ error: 'This request came from a different site.' }, 403)
  }
  c.set('user', user)
  await next()
})

app.get('/api/health', async c => { await c.env.DB.prepare('SELECT 1').first(); return c.json({ status: 'up' }) })
app.route('/api/auth', auth)
app.route('/api/invites', invites)
app.route('/api/notifications', notifications)
app.route('/api/workspaces', workspaces)
app.route('/api/jobs', jobs)
app.route('/api/quotes', quotes)
app.route('/api/payments', payments)
app.route('/api/attachments', attachments)
app.route('/api/mpesa', mpesa)
app.notFound(c => c.json({ error: 'API route not found.' }, 404))
app.onError((error, c) => { console.error(error); return c.json({ error: 'The request could not be completed. Check the database migrations and API logs.' }, 500) })
export default app
