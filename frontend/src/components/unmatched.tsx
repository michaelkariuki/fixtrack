import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import type { z } from 'zod'
import { successResponse, unmatchedIntentSchema, unmatchedIntentsResponse } from '../../../shared/contracts'
import { apiRequest, dateLabel, errorMessage, formatKES } from '../api/client'
import { ErrorNotice } from './ui'

type Intent = z.infer<typeof unmatchedIntentSchema>

export function UnmatchedPaymentsPanel({ workspaceId, jobId, onResolved }: { workspaceId: string; jobId: string; onResolved: () => void }) {
  const [intents, setIntents] = useState<Intent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await apiRequest(`/mpesa/unmatched?workspace_id=${encodeURIComponent(workspaceId)}&job_id=${encodeURIComponent(jobId)}`, unmatchedIntentsResponse)
      setIntents(result.intents)
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, jobId])

  useEffect(() => { void load() }, [load])

  async function resolve(id: string, action: 'record' | 'dismiss') {
    if (busy) return
    setBusy(id); setError(null)
    try {
      await apiRequest(`/mpesa/intents/${encodeURIComponent(id)}/resolve`, successResponse, { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, action }) })
      await load()
      onResolved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <section className="panel"><div className="panel-body"><p className="text-muted" role="status">Checking unmatched M-Pesa payments…</p></div></section>
  if (!intents.length && !error) return null

  return <section className="panel">
    <div className="panel-header"><div><h2>M-Pesa payments needing review</h2><p className="text-muted">The amount or receipt did not match the pending request. Record the money received or dismiss it.</p></div><AlertTriangle size={19} aria-hidden="true" /></div>
    <div className="panel-body stack">
      <ErrorNotice message={error} />
      {intents.map(intent => <div key={intent.id} className="notice">
        <div className="stack" style={{ gap: 8, width: '100%' }}>
          <div><strong>{formatKES(intent.received_amount ?? intent.amount)}</strong><p className="text-muted">{intent.phone} · {dateLabel(intent.created_at)}</p></div>
          {intent.provider_receipt && <p>Receipt: {intent.provider_receipt}</p>}
          {intent.result_desc && <p className="text-muted">{intent.result_desc}</p>}
          <div className="form-actions" style={{ borderTop: 0, paddingTop: 4 }}>
            <button className="btn btn-primary" disabled={busy !== null} onClick={() => void resolve(intent.id, 'record')}><Check size={15} aria-hidden="true" />{busy === intent.id ? 'Recording…' : 'Record received payment'}</button>
            <button className="btn btn-secondary" disabled={busy !== null} onClick={() => void resolve(intent.id, 'dismiss')}><X size={15} aria-hidden="true" />Dismiss</button>
          </div>
        </div>
      </div>)}
    </div>
  </section>
}
