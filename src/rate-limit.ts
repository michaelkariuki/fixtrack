import type { AuthContext } from './auth'

export function clientAddress(c: AuthContext): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'local'
}

export async function rateLimit(c: AuthContext, key: string, limit: number, windowSeconds: number): Promise<Response | null> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds
  await c.env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(windowStart - 86400).run()
  await c.env.DB.prepare('INSERT INTO rate_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key,window_start) DO UPDATE SET count=count+1')
    .bind(key, windowStart).run()
  const row = await c.env.DB.prepare('SELECT count FROM rate_limits WHERE key=? AND window_start=?')
    .bind(key, windowStart).first<{ count: number }>()
  if ((row?.count ?? 0) <= limit) return null
  c.header('Retry-After', String(Math.max(1, windowStart + windowSeconds - Math.floor(Date.now() / 1000))))
  return c.json({ error: 'Too many requests. Wait a moment and try again.' }, 429)
}
