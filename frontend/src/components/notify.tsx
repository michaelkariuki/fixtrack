import { useCallback, useEffect, useState } from 'react'
import { Bell, Mail, MessageSquare, Send } from 'lucide-react'
import type { z } from 'zod'
import { notificationCreatedResponse, notificationsResponse, notificationSchema, type notificationChannelSchema } from '../../../shared/contracts'
import { apiRequest, dateLabel, errorMessage } from '../api/client'
import { ErrorNotice } from './ui'

type Notification = z.infer<typeof notificationSchema>
type Channel = z.infer<typeof notificationChannelSchema>

const labels: Record<Channel, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' }

export function CustomerNotifyPanel({ workspaceId, jobId }: { workspaceId: string; jobId: string }) {
  const [history, setHistory] = useState<Notification[]>([])
  const [busy, setBusy] = useState<Channel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await apiRequest(`/notifications?workspace_id=${encodeURIComponent(workspaceId)}&job_id=${encodeURIComponent(jobId)}`, notificationsResponse)
      setHistory(result.notifications)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [workspaceId, jobId])

  useEffect(() => { void load() }, [load])

  async function send(channel: Channel) {
    if (busy) return
    setBusy(channel); setError(null); setNotice(null); setShareUrl(null)
    try {
      const result = await apiRequest('/notifications', notificationCreatedResponse, {
        method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, job_id: jobId, channel }),
      })
      setNotice(channel === 'whatsapp' ? 'WhatsApp share link ready.' : `${labels[channel]} notification sent.`)
      setShareUrl(result.share_url ?? null)
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  return <section className="panel">
    <div className="panel-header"><div><h2>Customer notifications</h2><p className="text-muted">Send the current quotation link using the contact details on file.</p></div><Bell size={19} aria-hidden="true" /></div>
    <div className="panel-body stack">
      <div className="form-actions" style={{ borderTop: 0, paddingTop: 0 }}>
        <button className="btn btn-secondary" disabled={busy !== null} onClick={() => void send('email')}><Mail size={15} aria-hidden="true" />{busy === 'email' ? 'Sending…' : 'Email quote'}</button>
        <button className="btn btn-secondary" disabled={busy !== null} onClick={() => void send('sms')}><MessageSquare size={15} aria-hidden="true" />{busy === 'sms' ? 'Sending…' : 'SMS quote'}</button>
        <button className="btn btn-secondary" disabled={busy !== null} onClick={() => void send('whatsapp')}><Send size={15} aria-hidden="true" />{busy === 'whatsapp' ? 'Preparing…' : 'WhatsApp link'}</button>
      </div>
      <ErrorNotice message={error} />
      {notice && <div className="notice notice-success" role="status">{notice}{shareUrl && <a className="btn btn-secondary" href={shareUrl} target="_blank" rel="noreferrer">Open WhatsApp</a>}</div>}
      {history.length > 0 && <div className="stack">{history.slice(0, 5).map(item => <div key={item.id} className="queue-item"><div><strong>{labels[item.channel]}</strong><small>{item.recipient} · {dateLabel(item.created_at)} · {item.status}</small>{item.error && <small>{item.error}</small>}</div></div>)}</div>}
    </div>
  </section>
}
