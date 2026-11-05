import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, CreditCard, RefreshCw } from 'lucide-react'
import type { z } from 'zod'
import { balanceResponse, paymentCreatedResponse, paymentInputSchema, paymentMethodSchema, type Job } from '../../../shared/contracts'
import { apiRequest, dateLabel, errorMessage, formatKES } from '../api/client'
import { ErrorNotice, Field, PageHeading, StatePanel } from '../components/ui'
import { useWorkspace } from '../state/Workspace'

type Balance = z.infer<typeof balanceResponse>
type PaymentMethod = z.infer<typeof paymentMethodSchema>
const methodLabels: Record<PaymentMethod, string> = { mpesa: 'M-Pesa', cash: 'Cash', bank: 'Bank transfer' }

function PaymentEntry({ job, workspaceId, refresh }: { job: Job; workspaceId: string; refresh: () => Promise<void> }) {
  const [balance, setBalance] = useState<Balance | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('mpesa')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [retry, setRetry] = useState(0)
  const alive = useRef(true)
  const submission = useRef<AbortController | null>(null)
  const submitting = useRef(false)
  const endpoint = `/payments/job/${encodeURIComponent(job.id)}?workspace_id=${encodeURIComponent(workspaceId)}`

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; submission.current?.abort() }
  }, [])

  useEffect(() => {
    const request = new AbortController()
    setLoading(true)
    setLoadError(null)
    setBalance(null)
    void apiRequest(endpoint, balanceResponse, { signal: request.signal })
      .then(result => { if (!request.signal.aborted) setBalance(result) })
      .catch(cause => { if (!request.signal.aborted) setLoadError(errorMessage(cause)) })
      .finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => request.abort()
  }, [endpoint, retry])

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || loading || !balance || balance.remaining_balance <= 0) return
    setError(null)
    setSuccess(null)
    const input = paymentInputSchema.safeParse({
      workspace_id: workspaceId, job_id: job.id, request_id: requestId,
      amount: amount.trim() ? Number(amount) : Number.NaN, payment_method: method,
      reference_code: reference.trim(), notes: notes.trim(),
    })
    if (!input.success) {
      setError(input.error.issues[0]?.message || 'Check the payment details.')
      return
    }
    if (input.data.amount > balance.remaining_balance) {
      setError(`The payment cannot exceed the outstanding balance of ${formatKES(balance.remaining_balance)}.`)
      return
    }
    const request = new AbortController()
    submission.current = request
    submitting.current = true
    setBusy(true)
    try {
      const result = await apiRequest('/payments', paymentCreatedResponse, { method: 'POST', signal: request.signal, body: JSON.stringify(input.data) })
      if (!alive.current || request.signal.aborted) return
      setSuccess(`Payment recorded. Total paid: ${formatKES(result.payment.total_paid)}. Remaining balance: ${formatKES(result.payment.remaining_balance)}.`)
      setRequestId(crypto.randomUUID())
      setAmount('')
      setReference('')
      setNotes('')
      setBalance(null)
      setLoading(true)
      setLoadError(null)
      try {
        const updated = await apiRequest(endpoint, balanceResponse, { signal: request.signal })
        if (alive.current && !request.signal.aborted) setBalance(updated)
      } catch (cause) {
        if (alive.current && !request.signal.aborted) setLoadError(`Payment was recorded, but the balance and history could not be reloaded. ${errorMessage(cause)}`)
      }
      if (alive.current && !request.signal.aborted) await refresh()
    } catch (cause) {
      if (alive.current && !request.signal.aborted) setError(`${errorMessage(cause)} Your payment request ID has been kept for a safe retry.`)
    } finally {
      if (alive.current && !request.signal.aborted) { setBusy(false); setLoading(false); submitting.current = false }
    }
  }

  return <div className="payment-layout">
    <section className="panel">
      <div className="panel-header"><div><h2>Manual payment entry</h2><p className="text-muted">Record money already received. This does not initiate an M-Pesa or bank transaction.</p></div><CreditCard size={20} aria-hidden="true" /></div>
      <div className="panel-body stack">
        {success && <div className="notice notice-success" role="status"><Check size={17} aria-hidden="true" /><span>{success}</span></div>}
        <ErrorNotice message={error} />
        <ErrorNotice message={loadError} />
        {loading && <p className="text-muted" role="status">Loading the approved quote balance and payment history…</p>}
        {!loading && !balance && <button className="btn btn-secondary" disabled={busy} onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Reload balance</button>}
        {balance && <div className="stack">
          <div className="summary-line"><span>Approved quote</span><strong className="amount">{formatKES(balance.total_amount)}</strong></div>
          <div className="summary-line"><span>Already paid</span><span className="amount">{formatKES(balance.total_paid)}</span></div>
          <div className="summary-line"><span>Outstanding balance</span><strong className="amount">{formatKES(balance.remaining_balance)}</strong></div>
        </div>}
        {balance && balance.remaining_balance <= 0 ? <div className="notice notice-success">The approved quote is settled. No further payment is needed.</div> : <form onSubmit={recordPayment} className="stack" aria-busy={busy}>
          <fieldset className="payment-fields stack" disabled={busy || loading || !balance}>
            <div className="form-grid">
              <Field label="Amount (KES)" hint={balance ? `Whole shillings, up to ${formatKES(balance.remaining_balance)}.` : 'Load the balance before recording a payment.'}><input type="number" inputMode="numeric" min={1} max={balance ? Math.min(balance.remaining_balance, 1_000_000_000) : undefined} step={1} required value={amount} onChange={event => setAmount(event.target.value)} /></Field>
              <Field label="Payment method"><select value={method} onChange={event => { const parsed = paymentMethodSchema.safeParse(event.target.value); if (parsed.success) setMethod(parsed.data) }}><option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="bank">Bank transfer</option></select></Field>
            </div>
            <Field label={method === 'mpesa' ? 'M-Pesa reference (required)' : 'Transaction reference (optional)'} hint={method === 'mpesa' ? 'Enter the reference from the payment you have confirmed.' : undefined}><input value={reference} onChange={event => setReference(event.target.value)} maxLength={2000} required={method === 'mpesa'} /></Field>
            <Field label="Payment notes (optional)"><textarea rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
            <button type="submit" className="btn btn-primary"><CreditCard size={16} aria-hidden="true" />{busy ? 'Recording payment…' : 'Record payment'}</button>
          </fieldset>
        </form>}
        <p className="text-muted">A payment does not mark the device as collected. Record collection separately on the job once it is ready and settled.</p>
        <div className="form-actions"><Link className="btn btn-secondary" to={`/jobs/${encodeURIComponent(job.id)}`}><ArrowLeft size={16} aria-hidden="true" />Back to {job.job_number}</Link>{balance && <button className="btn btn-secondary" disabled={busy || loading} onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Reload balance & history</button>}</div>
      </div>
    </section>
    <section className="panel">
      <div className="panel-header"><div><h2>Payment history</h2><p className="text-muted">{job.job_number} · {job.customer_name}</p></div></div>
      <div className="panel-body stack">
        {loading && <p className="text-muted" role="status">Loading payment history…</p>}
        {!loading && !balance && <p className="text-muted">Payment history is unavailable until the balance loads successfully.</p>}
        {balance && balance.payments.length === 0 && <StatePanel title="No payments recorded">Payments recorded for this job will appear here.</StatePanel>}
        {balance && balance.payments.map(payment => <article className="payment-history-item stack" key={payment.id}>
          <div className="summary-line"><strong>{methodLabels[payment.payment_method]}</strong><strong className="amount">{formatKES(payment.amount)}</strong></div>
          <p className="text-muted">{dateLabel(payment.created_at)}</p>
          {payment.reference_code && <p><span className="text-muted">Reference: </span>{payment.reference_code}</p>}
          {payment.notes && <p className="preserve-lines">{payment.notes}</p>}
        </article>)}
      </div>
    </section>
  </div>
}

function WorkspacePayments({ workspaceId, requestedJob }: { workspaceId: string; requestedJob: string }) {
  const { jobs, refresh } = useWorkspace()
  const [selected, setSelected] = useState(requestedJob)
  const job = jobs.find(item => item.id === selected && item.workspace_id === workspaceId)
  const approvedJobs = jobs.filter(item => item.workspace_id === workspaceId && item.quote_status === 'approved')
  return <div className="stack">
    <section className="panel"><div className="panel-body"><Field label="Repair job" hint="Choose a job with an approved quote. Customer and device details help identify the correct repair."><select value={selected} onChange={event => setSelected(event.target.value)}>
      <option value="">Select a repair job</option>
      {selected && !job && <option value={selected} disabled>Requested job is not in this workspace</option>}
      {job && job.quote_status !== 'approved' && <option value={job.id} disabled>{job.job_number} · {job.customer_name} · Quote not approved</option>}
      {approvedJobs.map(item => <option key={item.id} value={item.id}>{item.job_number} · {item.customer_name} · {item.device_model}</option>)}
    </select></Field></div></section>
    {selected && !job && <StatePanel title="Job not found in this workspace">Choose another repair job or switch to the job's workspace.</StatePanel>}
    {job && job.quote_status !== 'approved' && <StatePanel title="An approved quote is required" action={<Link className="btn btn-secondary" to={`/jobs/${encodeURIComponent(job.id)}`}>Open {job.job_number}</Link>}>This job cannot receive a payment until its quotation is approved.</StatePanel>}
    {!selected && <StatePanel title={approvedJobs.length ? 'Choose a repair job' : 'No approved quotations yet'} action={!approvedJobs.length ? <Link className="btn btn-secondary" to="/jobs">View repair jobs</Link> : undefined}>{approvedJobs.length ? 'Select the customer and device above to load the real balance and payment history.' : 'Prepare a quotation and obtain customer approval before recording payments.'}</StatePanel>}
    {job && job.quote_status === 'approved' && <PaymentEntry key={`${workspaceId}:${job.id}`} job={job} workspaceId={workspaceId} refresh={refresh} />}
  </div>
}

export default function RecordPayment() {
  const { workspace, jobs, loading, error, refresh } = useWorkspace()
  const [params] = useSearchParams()
  const requestedJob = params.get('job') || ''
  return <div className="stack">
    <PageHeading eyebrow="Payments" title="Record a payment" description="Manually record a confirmed M-Pesa, cash, or bank payment against an approved repair quote." />
    {error ? <><ErrorNotice message={error} /><StatePanel title="Workspace data unavailable" action={<button className="btn btn-secondary" onClick={() => void refresh()} disabled={loading}>Try again</button>}>Reload workspace data before recording payments.</StatePanel></> : loading && (!workspace || !jobs.length) ? <StatePanel title="Loading repair jobs">Retrieving jobs for the selected workspace.</StatePanel> : !workspace ? <StatePanel title="Select a workspace">Create or select your repair workspace before recording a payment.</StatePanel> : <WorkspacePayments key={`${workspace.id}:${requestedJob}`} workspaceId={workspace.id} requestedJob={requestedJob} />}
  </div>
}
