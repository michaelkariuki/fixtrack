import { Hono } from 'hono'
import { requireMembership, type AuthEnv } from '../auth'
const attachments = new Hono<AuthEnv>()
const MAX_FILE_SIZE = 5 * 1024 * 1024

attachments.post('/', async c => {
  const workspace_id = c.req.query('workspace_id')
  const job_id = c.req.query('job_id')
  if (!workspace_id || !job_id) return c.json({ error: 'Workspace and job are required.' }, 400)
  const denied = await requireMembership(c, workspace_id)
  if (denied) return denied
  const job = await c.env.DB.prepare('SELECT id FROM repair_jobs WHERE id=? AND workspace_id=?').bind(job_id, workspace_id).first()
  if (!job) return c.json({ error: 'Job not found in this workspace.' }, 404)

  const file = await c.req.arrayBuffer()
  const fileName = (c.req.header('X-File-Name') ?? '').split(/[\\/]/).pop()?.trim().slice(0, 200) ?? ''
  const fileType = (c.req.header('Content-Type') || 'application/octet-stream').slice(0, 120)
  if (!fileName) return c.json({ error: 'File name required.' }, 400)
  if (!file.byteLength) return c.json({ error: 'The selected file is empty.' }, 400)
  if (file.byteLength > MAX_FILE_SIZE) return c.json({ error: 'File size exceeds the 5 MB limit.' }, 400)

  const id = crypto.randomUUID()
  const r2Key = `workspaces/${workspace_id}/jobs/${job_id}/${id}/${fileName}`
  await c.env.ATTACHMENTS.put(r2Key, file, { httpMetadata: { contentType: fileType } })
  await c.env.DB.prepare('INSERT INTO attachments (id, workspace_id, job_id, file_name, file_size, file_type, r2_key) VALUES (?,?,?,?,?,?,?)')
    .bind(id, workspace_id, job_id, fileName, file.byteLength, fileType, r2Key).run()

  return c.json({ attachment: await c.env.DB.prepare('SELECT id,workspace_id,job_id,file_name,file_size,file_type,created_at FROM attachments WHERE id=?').bind(id).first() }, 201)
})

attachments.get('/', async c => {
  const workspace_id = c.req.query('workspace_id')
  const job_id = c.req.query('job_id')
  if (!workspace_id || !job_id) return c.json({ error: 'Workspace and job are required.' }, 400)
  const denied = await requireMembership(c, workspace_id)
  if (denied) return denied
  const { results } = await c.env.DB.prepare('SELECT id,workspace_id,job_id,file_name,file_size,file_type,created_at FROM attachments WHERE workspace_id=? AND job_id=? ORDER BY created_at DESC')
    .bind(workspace_id, job_id).all()
  return c.json({ attachments: results })
})

attachments.get('/download/:id', async c => {
  const workspace_id = c.req.query('workspace_id')
  if (!workspace_id) return c.json({ error: 'Choose a workspace.' }, 400)
  const denied = await requireMembership(c, workspace_id)
  if (denied) return denied
  const attachment = await c.env.DB.prepare('SELECT file_name,file_type,r2_key FROM attachments WHERE id=? AND workspace_id=?')
    .bind(c.req.param('id'), workspace_id).first<{ file_name: string; file_type: string; r2_key: string }>()
  if (!attachment) return c.json({ error: 'Attachment not found.' }, 404)
  const object = await c.env.ATTACHMENTS.get(attachment.r2_key)
  if (!object) return c.json({ error: 'The stored file is missing.' }, 404)
  const asciiName = attachment.file_name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return new Response(object.body, {
    headers: {
      'Content-Type': attachment.file_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
      'Cache-Control': 'private, max-age=0',
    },
  })
})

export default attachments
