import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Bindings } from './db/client'

export type AuthUser = { id: string; email: string; name: string; email_verified: boolean }
export type AuthEnv = { Bindings: Bindings; Variables: { user: AuthUser } }
export type AuthContext = Context<AuthEnv>

const SESSION_COOKIE = 'fixtrack_session'
const SESSION_SECONDS = 60 * 60 * 24 * 30
const encoder = new TextEncoder()
type UserRow = { id: string; email: string; name: string; email_verified_at: number | null }

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)
  return `pbkdf2$100000$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations: Number(iterations) }, key, 256)
  const expected = fromBase64(hash)
  const actual = new Uint8Array(bits)
  if (expected.length !== actual.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index]
  return difference === 0
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function createSession(c: AuthContext, userId: string): Promise<void> {
  const token = randomHex(32)
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS
  await c.env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await hashToken(token), userId, expiresAt).run()
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_SECONDS, secure: new URL(c.req.url).protocol === 'https:',
  })
}

export async function currentUser(c: AuthContext): Promise<AuthUser | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const row = await c.env.DB.prepare('SELECT u.id,u.email,u.name,u.email_verified_at FROM sessions s JOIN owner_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>unixepoch()')
    .bind(await hashToken(token)).first<UserRow>()
  return row ? { id: row.id, email: row.email, name: row.name, email_verified: Boolean(row.email_verified_at) } : null
}

export async function destroySession(c: AuthContext): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hashToken(token)).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export async function destroyUserSessions(c: AuthContext, userId: string): Promise<void> {
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId).run()
}

export async function issueToken(c: AuthContext, userId: string, purpose: string, seconds: number): Promise<string> {
  await c.env.DB.prepare('DELETE FROM auth_tokens WHERE user_id=? AND purpose=?').bind(userId, purpose).run()
  const token = randomHex(32)
  await c.env.DB.prepare('INSERT INTO auth_tokens (token_hash,user_id,purpose,expires_at) VALUES (?,?,?,?)')
    .bind(await hashToken(token), userId, purpose, Math.floor(Date.now() / 1000) + seconds).run()
  return token
}

export async function consumeToken(c: AuthContext, token: string, purpose: string, keep = false): Promise<string | null> {
  const hash = await hashToken(token)
  const row = await c.env.DB.prepare('SELECT user_id FROM auth_tokens WHERE token_hash=? AND purpose=? AND expires_at>unixepoch()')
    .bind(hash, purpose).first<{ user_id: string }>()
  if (!row) return null
  if (!keep) await c.env.DB.prepare('DELETE FROM auth_tokens WHERE token_hash=?').bind(hash).run()
  return row.user_id
}

export function appUrl(c: AuthContext, path: string): string {
  const base = c.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
  return `${base}${path}`
}

export function devLink(c: AuthContext, path: string): string | null {
  return c.env.AUTH_DEV_LINKS === 'true' ? appUrl(c, path) : null
}

export function requireVerified(c: AuthContext): Response | null {
  return c.get('user').email_verified ? null : c.json({ error: 'Verify your email address before continuing.' }, 403)
}

export async function requireMembership(c: AuthContext, workspaceId: string): Promise<Response | null> {
  const member = await c.env.DB.prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?')
    .bind(workspaceId, c.get('user').id).first()
  return member ? null : c.json({ error: 'You do not have access to this workspace.' }, 403)
}

export async function requireOwner(c: AuthContext, workspaceId: string): Promise<Response | null> {
  const member = await c.env.DB.prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?')
    .bind(workspaceId, c.get('user').id).first<{ role: string }>()
  if (!member) return c.json({ error: 'You do not have access to this workspace.' }, 403)
  return member.role === 'owner' ? null : c.json({ error: 'Only workspace owners can do that.' }, 403)
}
