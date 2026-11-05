import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ChevronRight, Copy, ExternalLink, Mail, Phone, Plus, RefreshCw, Save, Smartphone, Trash2, Wrench } from 'lucide-react'
import { JobAttachments } from '../components/attachments'
import { CustomerNotifyPanel } from '../components/notify'
import { UnmatchedPaymentsPanel } from '../components/unmatched'
import type { z } from 'zod'
import { ownerQuotesResponse, quoteCreatedResponse, quoteInputSchema, statusInputSchema, successResponse, type Job, type JobStatus, type Quote, type QuoteItem } from '../../../shared/contracts'
import { apiRequest, dateLabel, errorMessage, formatKES } from '../api/client'
import { ErrorNotice, Field, PageHeading, PaymentBadge, StatePanel, StatusBadge, statusLabels } from '../components/ui'
import { useWorkspace } from '../state/Workspace'

type OwnerQuotes = z.infer<typeof ownerQuotesResponse>
type QuoteInput = z.infer<typeof quoteInputSchema>
type EditorRow = { key: string; description: string; quantity: string; unitPrice: string }
const quoteLabels: Record<Quote['status'], string> = { draft: 'Draft', sent: 'Awaiting approval', approved: 'Approved', rejected: 'Declined', superseded: 'Superseded', changes_requested: 'Changes requested' }
const progress: JobStatus[] = ['received', 'diagnosed', 'approved', 'in_repair', 'ready', 'delivered']
const nextSteps: Partial<Record<JobStatus, { status: JobStatus; label: string }>> = {
  approved: { status: 'in_repair', label: 'Start repair' },
  in_repair: { status: 'ready', label: 'Mark ready for collection' },
  ready: { status: 'delivered', label: 'Record device collected' },
}
function numeric(value: string): number { return value.trim() ? Number(value) : Number.NaN }

function QuoteEditor({ workspaceId, jobId, quote, items, defaultTerms, busy, onSave, onCancel }: {
  workspaceId: string; jobId: string; quote?: Quote; items: QuoteItem[]; defaultTerms: string;
  busy: boolean; onSave: (input: QuoteInput) => Promise<void>; onCancel: () => void;
}) {
  const [rows, setRows] = useState<EditorRow[]>(() => items.length ? items.map(item => ({ key: crypto.randomUUID(), description: item.description, quantity: String(item.quantity), unitPrice: String(item.unit_price) })) : [{ key: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '' }])
  const [deposit, setDeposit] = useState(String(quote?.required_deposit ?? 0))
  const [terms, setTerms] = useState(quote?.terms ?? defaultTerms)
  const [error, setError] = useState<string | null>(null)
  const total = rows.reduce((sum, row) => sum + numeric(row.quantity) * numeric(row.unitPrice), 0)
  const validTotal = Number.isSafeInteger(total) && total >= 0 && total <= 1_000_000_000

  function changeRow(key: string, property: 'description' | 'quantity' | 'unitPrice', value: string) {
    setRows(previous => previous.map(row => row.key === key ? { ...row, [property]: value } : row))
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const result = quoteInputSchema.safeParse({ workspace_id: workspaceId, job_id: jobId, required_deposit: numeric(deposit), terms, items: rows.map(row => ({ description: row.description, quantity: numeric(row.quantity), unit_price: numeric(row.unitPrice) })) })
    if (!result.success) { setError(result.error.issues[0]?.message || 'Check the quotation details.'); return }
    await onSave(result.data)
  }

  return <form className="stack quote-editor" onSubmit={submit} aria-busy={busy}>
    <div><h3>{quote ? `Revise version ${quote.version}` : 'Prepare an itemized quote'}</h3><p className="text-muted">Saving creates a new customer approval link. Totals are calculated from quantities and unit prices.</p></div>
    <ErrorNotice message={error} />
    <fieldset className="quote-editor-fields stack" disabled={busy}>
      {rows.map((row, index) => {
        const lineTotal = numeric(row.quantity) * numeric(row.unitPrice)
        return <div className="quote-editor-row" key={row.key}>
          <Field label={`Item ${index + 1} description`}><input required maxLength={500} value={row.description} onChange={event => changeRow(row.key, 'description', event.target.value)} /></Field>
          <Field label="Quantity"><input type="number" inputMode="numeric" required min={1} max={10000} step={1} value={row.quantity} onChange={event => changeRow(row.key, 'quantity', event.target.value)} /></Field>
          <Field label="Unit price (KES)"><input type="number" inputMode="numeric" required min={0} max={1_000_000_000} step={1} value={row.unitPrice} onChange={event => changeRow(row.key, 'unitPrice', event.target.value)} /></Field>
          <div className="quote-line-total"><span className="text-muted">Line total</span><strong className="amount">{Number.isSafeInteger(lineTotal) && lineTotal >= 0 ? formatKES(lineTotal) : '—'}</strong></div>
          <button type="button" className="btn btn-icon btn-secondary" aria-label={`Remove item ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows(previous => previous.filter(item => item.key !== row.key))}><Trash2 size={16} aria-hidden="true" /></button>
        </div>
      })}
      <div><button type="button" className="btn btn-secondary" disabled={rows.length >= 50} onClick={() => setRows(previous => [...previous, { key: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '' }])}><Plus size={16} aria-hidden="true" />Add item</button></div>
      <div className="form-grid">
        <Field label="Quote total (calculated)"><output className="amount quote-total-output">{validTotal ? formatKES(total) : 'Enter valid whole-shilling prices and quantities'}</output></Field>
        <Field label="Required deposit (KES)" hint="Whole shillings; cannot exceed the quote total."><input type="number" inputMode="numeric" required min={0} max={validTotal ? total : 1_000_000_000} step={1} value={deposit} onChange={event => setDeposit(event.target.value)} /></Field>
      </div>
      <Field label="Repair terms" hint="Included in the customer quotation."><textarea rows={4} maxLength={4000} value={terms} onChange={event => setTerms(event.target.value)} /></Field>
      <div className="form-actions"><button type="submit" className="btn btn-primary"><Save size={16} aria-hidden="true" />{busy ? 'Saving quotation…' : quote ? 'Save revised quotation' : 'Save quotation'}</button><button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button></div>
    </fieldset>
  </form>
}

function JobWorkspaceDetail({ job, workspaceId, defaultTerms, refresh }: { job: Job; workspaceId: string; defaultTerms: string; refresh: () => Promise<void> }) {
  const [data, setData] = useState<OwnerQuotes | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [savedLink, setSavedLink] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const alive = useRef(true)
  const mutation = useRef<AbortController | null>(null)
  const mutating = useRef(false)
  const copyAttempt = useRef(0)
  const endpoint = `/quotes/job/${encodeURIComponent(job.id)}?workspace_id=${encodeURIComponent(workspaceId)}`
  const latest = data?.quotes[0]
  const selectedQuote = data?.quotes.find(quote => quote.id === selectedVersion) ?? latest
  const selectedItems = data?.items.filter(item => item.quote_id === selectedQuote?.id) ?? []
  const latestItems = data?.items.filter(item => item.quote_id === latest?.id) ?? []
  const approved = data?.quotes.some(quote => quote.status === 'approved') || job.quote_status === 'approved'
  const canQuote = !approved && !!data && (latest ? latest.status === 'sent' || latest.status === 'changes_requested' : job.status === 'received' || job.status === 'diagnosed')
  const next = nextSteps[job.status]
  const settled = job.quote_status === 'approved' && job.total_amount !== null && job.total_paid >= job.total_amount
  const canProgress = !!next && !!approved && (next.status !== 'delivered' || settled)
  const selectedLink = selectedQuote ? new URL(`/quote/${encodeURIComponent(selectedQuote.approval_token)}`, window.location.origin).href : null
  const displayedLink = savedLink || selectedLink

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; mutation.current?.abort(); copyAttempt.current += 1 }
  }, [])

  useEffect(() => {
    const request = new AbortController()
    setLoading(true)
    setLoadError(null)
    void apiRequest(endpoint, ownerQuotesResponse, { signal: request.signal })
      .then(result => {
        if (request.signal.aborted) return
        setData(result)
        if (!result.quotes.length && (job.status === 'received' || job.status === 'diagnosed')) setEditing(true)
        if (result.quotes.some(quote => quote.status === 'approved')) setEditing(false)
      })
      .catch(cause => { if (!request.signal.aborted) setLoadError(errorMessage(cause)) })
      .finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => request.abort()
  }, [endpoint, retry, job.status])

  useEffect(() => { copyAttempt.current += 1; setCopied(false); setCopyError(null); setCopying(false) }, [displayedLink])

  async function saveQuote(input: QuoteInput) {
    if (mutating.current || !canQuote || loading) return
    const request = new AbortController()
    mutation.current = request
    mutating.current = true
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const created = await apiRequest('/quotes', quoteCreatedResponse, { method: 'POST', signal: request.signal, body: JSON.stringify(input) })
      if (!alive.current || request.signal.aborted) return
      setSavedLink(new URL(`/quote/${encodeURIComponent(created.quote.approval_token)}`, window.location.origin).href)
      setSuccess('Quotation saved. Share the customer link below to request approval.')
      setEditing(false)
      setLoading(true)
      setLoadError(null)
      try {
        const updated = await apiRequest(endpoint, ownerQuotesResponse, { signal: request.signal })
        if (alive.current && !request.signal.aborted) {
          setData(updated)
          setSelectedVersion(created.quote.id)
          setSavedLink(null)
        }
      } catch (cause) {
        if (alive.current && !request.signal.aborted) {
          setData(null)
          setLoadError(`The quotation was saved, but version history could not be reloaded. ${errorMessage(cause)}`)
        }
      }
      if (alive.current && !request.signal.aborted) await refresh()
    } catch (cause) {
      if (alive.current && !request.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (alive.current && !request.signal.aborted) { setSaving(false); setLoading(false); mutating.current = false }
    }
  }

  async function advanceStatus() {
    if (mutating.current || !next || !canProgress || loading) return
    const input = statusInputSchema.safeParse({ workspace_id: workspaceId, status: next.status })
    if (!input.success) { setError(input.error.issues[0]?.message || 'The status could not be updated.'); return }
    const request = new AbortController()
    mutation.current = request
    mutating.current = true
    setStatusBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await apiRequest(`/jobs/${encodeURIComponent(job.id)}/status`, successResponse, { method: 'PATCH', signal: request.signal, body: JSON.stringify(input.data) })
      if (!result.success) throw new Error('The job status was not updated. Please try again.')
      if (!alive.current || request.signal.aborted) return
      setSuccess(`Job status updated: ${statusLabels[next.status]}.`)
      await refresh()
    } catch (cause) {
      if (alive.current && !request.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (alive.current && !request.signal.aborted) { setStatusBusy(false); mutating.current = false }
    }
  }

  async function copyLink() {
    if (!displayedLink || copying) return
    const attempt = ++copyAttempt.current
    setCopying(true)
    setCopyError(null)
    setCopied(false)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard copying is unavailable in this browser.')
      await navigator.clipboard.writeText(displayedLink)
      if (alive.current && attempt === copyAttempt.current) setCopied(true)
    } catch (cause) {
      if (alive.current && attempt === copyAttempt.current) setCopyError(`${errorMessage(cause)} Select and copy the link below manually, or open the customer quote.`)
    } finally {
      if (alive.current && attempt === copyAttempt.current) setCopying(false)
    }
  }

  return <div className="stack">
    <PageHeading eyebrow={`Repair job · ${dateLabel(job.created_at)}`} title={job.job_number} description={`${job.customer_name} · ${job.device_model}`} action={<Link className="btn btn-secondary" to="/jobs"><ArrowLeft size={16} aria-hidden="true" />All jobs</Link>} />
    <ErrorNotice message={error} />
    {success && <div className="notice notice-success" role="status"><Check size={17} aria-hidden="true" /><span>{success}</span></div>}
    <div className="detail-grid">
      <section className="panel"><div className="panel-header"><h2>Device & reported fault</h2><Smartphone size={20} aria-hidden="true" /></div><div className="panel-body stack">
        <div><h3>{job.device_model}</h3><p className="text-muted">{job.device_category}</p></div>
        <dl className="job-facts"><div><dt>Serial / IMEI</dt><dd>{job.serial_number || 'Not recorded'}</dd></div><div><dt>Reported fault</dt><dd className="preserve-lines">{job.fault_description}</dd></div><div><dt>Accessories received</dt><dd className="preserve-lines">{job.accessories_included || 'None recorded'}</dd></div></dl>
      </div></section>
      <section className="panel"><div className="panel-header"><h2>Customer & payment</h2><Phone size={20} aria-hidden="true" /></div><div className="panel-body stack">
        <h3>{job.customer_name}</h3>
        <a className="contact-link" href={`tel:${job.customer_phone.replace(/[^+\d]/g, '')}`}><Phone size={16} aria-hidden="true" />{job.customer_phone}</a>
        {job.customer_email && <a className="contact-link" href={`mailto:${job.customer_email}`}><Mail size={16} aria-hidden="true" />{job.customer_email}</a>}
        <div className="summary-line"><span>Payment status</span><PaymentBadge job={job} /></div>
        {job.quote_status === 'approved' && <><div className="summary-line"><span>Total paid</span><span className="amount">{formatKES(job.total_paid)}</span></div><Link className="btn btn-secondary" to={`/payments/new?job=${encodeURIComponent(job.id)}`}><Plus size={16} aria-hidden="true" />Record payment / view history</Link></>}
        {job.quote_status !== 'approved' && <p className="text-muted">Payments become available after customer quote approval.</p>}
      </div></section>
    </div>
    <JobAttachments workspaceId={workspaceId} jobId={job.id} />
    <UnmatchedPaymentsPanel workspaceId={workspaceId} jobId={job.id} onResolved={() => { setRetry(value => value + 1); void refresh() }} />
    <CustomerNotifyPanel workspaceId={workspaceId} jobId={job.id} />
    <section className="panel"><div className="panel-header"><h2>Repair progress</h2><StatusBadge status={job.status} quoteStatus={job.quote_status} /></div><div className="panel-body stack">
      <ol className="job-progress" aria-label="Repair progress">{progress.map((status, index) => <li key={status} className={index < progress.indexOf(job.status) ? 'complete' : status === job.status ? 'current' : ''} aria-current={status === job.status ? 'step' : undefined}><span className="progress-marker">{index < progress.indexOf(job.status) ? <Check size={13} aria-hidden="true" /> : index + 1}</span><span>{statusLabels[status]}</span></li>)}</ol>
      <div className="form-actions">{next && <button className="btn btn-primary" disabled={!canProgress || saving || statusBusy || loading} onClick={() => void advanceStatus()}><ChevronRight size={16} aria-hidden="true" />{statusBusy ? 'Updating status…' : next.label}</button>}<button className="btn btn-secondary" disabled={saving || statusBusy || loading} onClick={() => { setRetry(value => value + 1); void refresh() }}><RefreshCw size={16} aria-hidden="true" />Reload job & quotes</button></div>
      {job.status === 'received' && <p className="text-muted">Prepare a quotation below after diagnosing the fault. Saving the quote moves the job to awaiting approval.</p>}
      {job.status === 'diagnosed' && <p className="text-muted">The customer must approve the current quote before repair can begin.</p>}
      {job.status === 'ready' && !settled && <p className="text-muted">Settle the approved quote balance before recording collection. A payment alone never changes delivery status.</p>}
      {job.status === 'delivered' && <p className="text-muted">Collection has been recorded for this job.</p>}
    </div></section>
    <section className="panel"><div className="panel-header"><div><h2>Quotation & version history</h2><p className="text-muted">Customer approval applies to one version. Approved quotations cannot be edited.</p></div><Wrench size={20} aria-hidden="true" /></div><div className="panel-body stack">
      <ErrorNotice message={loadError} />
      {loading && <p className="text-muted" role="status">Loading quotation versions…</p>}
      {!loading && loadError && <button className="btn btn-secondary" disabled={saving || statusBusy} onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Reload quotation history</button>}
      {!loading && data && !data.quotes.length && !editing && <StatePanel title="No quotation yet" action={canQuote ? <button className="btn btn-primary" onClick={() => setEditing(true)}><Plus size={16} aria-hidden="true" />Create quotation</button> : undefined}>Prepare itemized repair costs and terms to request customer approval.</StatePanel>}
      {!loading && data && selectedQuote && <>
        <Field label="Quotation version"><select value={selectedQuote.id} disabled={saving || statusBusy} onChange={event => { setSelectedVersion(event.target.value); setSavedLink(null) }}>{data.quotes.map(quote => <option key={quote.id} value={quote.id}>Version {quote.version} · {quoteLabels[quote.status]} · {dateLabel(quote.created_at)}</option>)}</select></Field>
        <div className="form-actions"><span className={`badge quote-${selectedQuote.status}`}>{quoteLabels[selectedQuote.status]}</span><span className="text-muted">Created {dateLabel(selectedQuote.created_at)}{selectedQuote.approved_at ? ` · Approved ${dateLabel(selectedQuote.approved_at)}` : ''}</span></div>
        {selectedQuote.customer_notes && <div className="notice"><div><strong>Customer note</strong><p className="preserve-lines">{selectedQuote.customer_notes}</p></div></div>}
        <div className="table-scroll"><table className="quote-table"><caption className="eyebrow">Version {selectedQuote.version} itemized costs</caption><thead><tr><th scope="col">Description</th><th scope="col">Qty</th><th scope="col">Unit price</th><th scope="col">Line total</th></tr></thead><tbody>{selectedItems.map(item => <tr key={item.id}><td data-label="Description">{item.description}</td><td data-label="Quantity">{item.quantity}</td><td data-label="Unit price" className="amount">{formatKES(item.unit_price)}</td><td data-label="Line total" className="amount">{formatKES(item.quantity * item.unit_price)}</td></tr>)}</tbody></table></div>
        <div className="summary-line"><span>Quote total</span><strong className="amount">{formatKES(selectedQuote.total_amount)}</strong></div>
        <div className="summary-line"><span>Required deposit</span><span className="amount">{formatKES(selectedQuote.required_deposit)}</span></div>
        <div><h3>Repair terms</h3><p className="preserve-lines">{selectedQuote.terms || 'No additional terms recorded.'}</p></div>
      </>}
      {displayedLink && <div className="stack customer-quote-link"><Field label={savedLink ? 'New customer quotation link' : `Customer link · version ${selectedQuote?.version}`} hint="Share this link with the customer. They can view the quotation and respond."><input readOnly value={displayedLink} onFocus={event => event.currentTarget.select()} /></Field><div className="form-actions"><button type="button" className="btn btn-secondary" disabled={copying} onClick={() => void copyLink()}><Copy size={16} aria-hidden="true" />{copying ? 'Copying…' : copied ? 'Link copied' : 'Copy customer link'}</button><a className="btn btn-secondary" href={displayedLink} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" />Open customer quote</a></div><ErrorNotice message={copyError} />{copied && <p className="text-muted" role="status">Customer link copied to the clipboard.</p>}</div>}
      {!loading && data && approved && <div className="notice">The approved quotation is frozen. Its agreed prices, deposit, and terms cannot be revised.</div>}
      {!loading && data && canQuote && !editing && latest && <div className="form-actions"><button className="btn btn-secondary" disabled={saving || statusBusy} onClick={() => setEditing(true)}><Plus size={16} aria-hidden="true" />Revise latest quote (v{latest.version})</button></div>}
      {!loading && canQuote && editing && <QuoteEditor key={latest?.id || 'new'} workspaceId={workspaceId} jobId={job.id} quote={latest} items={latestItems} defaultTerms={defaultTerms} busy={saving || statusBusy} onSave={saveQuote} onCancel={() => setEditing(false)} />}
    </div></section>
  </div>
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const { workspace, jobs, loading, error, refresh, preferences } = useWorkspace()
  const job = jobs.find(item => item.id === id && item.workspace_id === workspace?.id)
  if (error) return <div className="stack"><PageHeading title="Repair job" /><ErrorNotice message={error} /><StatePanel title="Unable to load this workspace" action={<button className="btn btn-secondary" disabled={loading} onClick={() => void refresh()}>Try again</button>}>Reload workspace data to view the job.</StatePanel></div>
  if (loading && !job) return <StatePanel title="Loading repair job">Retrieving the selected workspace's repair jobs.</StatePanel>
  if (!workspace) return <StatePanel title="Select a repair workspace">Select or create a workspace to view its repair jobs.</StatePanel>
  if (!job) return <StatePanel title="Job not found in this workspace" action={<Link className="btn btn-secondary" to="/jobs"><ArrowLeft size={16} aria-hidden="true" />All jobs</Link>}>The requested job is not in the selected workspace. Check the link or select the correct workspace.</StatePanel>
  return <JobWorkspaceDetail key={`${workspace.id}:${job.id}`} job={job} workspaceId={workspace.id} defaultTerms={preferences.quoteTerms} refresh={refresh} />
}
