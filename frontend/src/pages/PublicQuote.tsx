import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Check, FileText, Phone, Printer } from 'lucide-react'
import type { z } from 'zod'
import { decisionInputSchema, mpesaIntentResponse, mpesaPushInputSchema, publicQuoteResponse, successResponse, type MpesaIntent, type Quote } from '../../../shared/contracts'
import { apiRequest, dateLabel, errorMessage, formatKES } from '../api/client'
import { ErrorNotice, Field, StatePanel } from '../components/ui'

type QuoteData = z.infer<typeof publicQuoteResponse>
const quoteLabels: Record<Quote['status'], string> = {
  draft: 'Draft', sent: 'Awaiting your approval', approved: 'Approved', rejected: 'Declined',
  superseded: 'Replaced by a newer quote', changes_requested: 'Changes requested',
}

function QuoteView({ token }: { token: string }) {
  const [data, setData] = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'changes' | null>(null)
  const [notes, setNotes] = useState('')
  const [payPhone, setPayPhone] = useState('')
  const [payError, setPayError] = useState<string | null>(null)
  const [payBusy, setPayBusy] = useState(false)
  const [intent, setIntent] = useState<MpesaIntent | null>(null)
  const [retry, setRetry] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const deciding = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; controller.current?.abort() }
  }, [])

  useEffect(() => {
    const request = new AbortController()
    setLoading(true)
    setError(null)
    void apiRequest(`/quotes/public/${encodeURIComponent(token)}`, publicQuoteResponse, { signal: request.signal })
      .then(result => { if (!request.signal.aborted) setData(result) })
      .catch(cause => { if (!request.signal.aborted) setError(errorMessage(cause)) })
      .finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => request.abort()
  }, [token, retry])

  useEffect(() => {
    if (!intent || intent.status !== 'pending') return
    const request = new AbortController()
    let timer: number | undefined
    const poll = async () => {
      try {
        const result = await apiRequest(`/mpesa/intent/${intent.id}?token=${encodeURIComponent(token)}`, mpesaIntentResponse, { signal: request.signal })
        if (request.signal.aborted) return
        setIntent(result.intent)
        if (result.intent.status === 'paid') setRetry(value => value + 1)
        if (result.intent.status === 'pending') timer = window.setTimeout(() => void poll(), 3000)
      } catch (cause) {
        if (request.signal.aborted) return
        setPayError(errorMessage(cause))
        timer = window.setTimeout(() => void poll(), 5000)
      }
    }
    timer = window.setTimeout(() => void poll(), 2000)
    return () => { request.abort(); if (timer !== undefined) window.clearTimeout(timer) }
  }, [intent?.id, intent?.status, token])

  async function startPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (payBusy || intent?.status === 'pending') return
    const input = mpesaPushInputSchema.safeParse({ phone: payPhone })
    if (!input.success) { setPayError('Enter the M-Pesa phone number that will receive the prompt.'); return }
    setPayBusy(true)
    setPayError(null)
    try {
      const result = await apiRequest('/mpesa/stkpush', mpesaIntentResponse, { method: 'POST', body: JSON.stringify({ quote_token: token, phone: input.data.phone }) })
      if (alive.current) setIntent(result.intent)
    } catch (cause) {
      if (alive.current) setPayError(errorMessage(cause))
    } finally {
      if (alive.current) setPayBusy(false)
    }
  }

  async function decide(action: 'approve' | 'changes') {
    if (deciding.current || !data || data.quote.status !== 'sent') return
    const note = notes.trim()
    if (action === 'changes' && !note) {
      setDecisionError('Describe the changes you would like before sending your request.')
      return
    }
    const input = decisionInputSchema.safeParse({ customer_notes: note })
    if (!input.success) { setDecisionError(input.error.issues[0]?.message || 'Check your note.'); return }
    const request = new AbortController()
    controller.current = request
    deciding.current = true
    setBusy(action)
    setDecisionError(null)
    setSuccess(null)
    try {
      const result = await apiRequest(`/quotes/public/${encodeURIComponent(token)}/${action}`, successResponse, {
        method: 'POST', signal: request.signal, body: JSON.stringify(input.data),
      })
      if (!result.success) throw new Error('Your response was not saved. Please try again.')
      if (!alive.current || request.signal.aborted) return
      setData(previous => previous ? {
        ...previous, quote: { ...previous.quote, status: action === 'approve' ? 'approved' : 'changes_requested', customer_notes: note || null },
      } : previous)
      setSuccess(action === 'approve' ? 'Your approval has been saved.' : 'Your request for changes has been saved.')
      try {
        const refreshed = await apiRequest(`/quotes/public/${encodeURIComponent(token)}`, publicQuoteResponse, { signal: request.signal })
        if (alive.current && !request.signal.aborted) setData(refreshed)
      } catch (cause) {
        if (alive.current && !request.signal.aborted) setDecisionError(`Your response was saved, but the latest quote could not be reloaded. ${errorMessage(cause)}`)
      }
    } catch (cause) {
      if (alive.current && !request.signal.aborted) setDecisionError(errorMessage(cause))
    } finally {
      if (alive.current && !request.signal.aborted) { setBusy(null); deciding.current = false }
    }
  }

  function submitChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void decide('changes')
  }

  if (loading) return <main className="public-quote"><StatePanel title="Loading your quote">Retrieving the repair details and terms.</StatePanel></main>
  if (error || !data) return <main className="public-quote"><section className="panel"><StatePanel title="Quote link unavailable" action={<button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button>}>This link could not be opened. Check the link or contact the repair shop.</StatePanel><div className="panel-body"><ErrorNotice message={error} /></div></section></main>

  const { quote, items, payments } = data
  return (
    <main className="public-quote stack">
      <section className="panel">
        <header className="panel-header public-quote-header">
          <div><p className="eyebrow">{quote.workspace_name}</p>{quote.workspace_quote_header && <p className="text-sm font-medium text-gray-900">{quote.workspace_quote_header}</p>}<h1>Repair quotation</h1><p className="text-muted">Version {quote.version} · {dateLabel(quote.created_at)}</p></div>
          <FileText size={25} aria-hidden="true" />
        </header>
        <div className="panel-body stack">
          <div className="form-actions"><span className={`badge quote-${quote.status}`}>{quoteLabels[quote.status]}</span><a className="btn btn-secondary" href={`tel:${quote.workspace_phone.replace(/[^+\d]/g, '')}`}><Phone size={16} aria-hidden="true" />{quote.workspace_phone}</a></div>
          {quote.workspace_address && <p className="text-xs text-muted">{quote.workspace_address}</p>}
          {quote.workspace_tax_id && <p className="text-xs text-muted">KRA PIN: {quote.workspace_tax_id}</p>}
          <div><p className="eyebrow">Device</p><h2>{quote.device_model}</h2><p className="text-muted">{quote.device_category}</p><p>{quote.fault_description}</p></div>
          <div className="table-scroll">
            <table className="quote-table">
              <caption className="eyebrow">Itemized repair costs</caption>
              <thead><tr><th scope="col">Description</th><th scope="col">Qty</th><th scope="col">Unit price</th><th scope="col">Line total</th></tr></thead>
              <tbody>{items.map(item => <tr key={item.id}><td data-label="Description">{item.description}</td><td data-label="Quantity">{item.quantity}</td><td data-label="Unit price" className="amount">{formatKES(item.unit_price)}</td><td data-label="Line total" className="amount">{formatKES(item.quantity * item.unit_price)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="stack">
            <div className="summary-line"><span>Quote total</span><strong className="amount">{formatKES(quote.total_amount)}</strong></div>
            <div className="summary-line"><span>Required deposit</span><strong className="amount">{formatKES(quote.required_deposit)}</strong></div>
            {payments && <><div className="summary-line"><span>Paid so far</span><span className="amount">{formatKES(payments.total_paid)}</span></div><div className="summary-line"><span>{payments.remaining_balance === 0 ? 'Balance' : 'Balance due'}</span><strong className="amount">{formatKES(payments.remaining_balance)}</strong></div></>}
            {quote.workspace_payment_instructions && <div className="notice" style={{marginTop: 15, background: '#fefcf8', borderColor: '#fde68a'}}><strong>Payment Instructions</strong><p className="preserve-lines">{quote.workspace_payment_instructions}</p></div>}
            {quote.status === 'approved' && payments?.mpesa_enabled && payments.remaining_balance > 0 && !intent && <section className="stack"><h2>Pay with M-Pesa</h2><p className="text-muted">Pay {formatKES(payments.remaining_balance)} to {quote.workspace_name}. M-Pesa will prompt you for your PIN.</p><form className="stack" onSubmit={startPayment}><Field label="M-Pesa phone number" hint="Safaricom number, for example 0712 345 678."><input type="tel" inputMode="tel" autoComplete="tel" value={payPhone} onChange={event => setPayPhone(event.target.value)} placeholder="0712 345 678" disabled={payBusy} /></Field><button className="btn btn-primary" disabled={payBusy}>{payBusy ? 'Sending prompt…' : 'Send payment prompt'}</button></form></section>}
            {intent && <div className={`notice ${intent.status === 'paid' ? 'notice-success' : ''}`} role="status"><div><strong>{intent.status === 'pending' ? 'Waiting for M-Pesa' : intent.status === 'paid' ? 'Payment received' : intent.status === 'unmatched' ? 'Payment received — shop review needed' : 'Payment not completed'}</strong><p>{intent.message}</p>{intent.provider_receipt && <p className="text-muted">M-Pesa receipt: {intent.provider_receipt}</p>}{intent.status === 'pending' && <p className="text-muted">Keep this page open; it updates automatically.</p>}</div></div>}
            {intent && (intent.status === 'failed' || intent.status === 'cancelled') && <div className="form-actions"><button className="btn btn-secondary" onClick={() => { setIntent(null); setPayError(null) }}>Try again</button></div>}
            <ErrorNotice message={payError} />
          </div>
          {quote.workspace_quote_footer && <section><h2>Important note</h2><p className="preserve-lines">{quote.workspace_quote_footer}</p></section>}
          <section><h2>Repair terms</h2><p className="preserve-lines">{quote.terms || 'No additional terms were included in this quote.'}</p></section>
          {quote.customer_notes && <section><h2>Your note</h2><p className="preserve-lines">{quote.customer_notes}</p></section>}
          {success && <div className="notice notice-success" role="status"><Check size={17} aria-hidden="true" /><span>{success}</span></div>}
          <ErrorNotice message={decisionError} />
          {quote.status === 'approved' && <div className="notice notice-success">This quote is approved{quote.approved_at ? ` as of ${dateLabel(quote.approved_at)}` : ''}. Contact the shop for repair or collection updates.</div>}
          {quote.status === 'changes_requested' && <div className="notice">Your change request is recorded. Contact the shop about a revised quotation; this version has not been approved.</div>}
          {quote.status === 'superseded' && <div className="notice">This version has been replaced. Ask the shop for the latest quotation link.</div>}
          {(quote.status === 'draft' || quote.status === 'rejected') && <div className="notice">This quote is not available for approval. Contact the shop for the current quotation.</div>}
          {quote.status === 'sent' && <form onSubmit={submitChanges} className="stack public-quote-decisions" aria-busy={busy !== null}>
            <Field label="Note for the shop" hint="Optional when approving. Required when requesting changes."><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} rows={3} disabled={busy !== null} /></Field>
            <p className="text-muted">Approving authorizes the repair at the quoted total and under the terms above.</p>
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void decide('approve')}><Check size={16} aria-hidden="true" />{busy === 'approve' ? 'Saving approval…' : 'Approve repair & terms'}</button>
            <button type="submit" className="btn btn-secondary" disabled={busy !== null}>{busy === 'changes' ? 'Saving request…' : 'Request changes'}</button>
          </form>}
          <div className="form-actions public-quote-tools"><button className="btn btn-secondary" onClick={() => window.print()} disabled={busy !== null}><Printer size={16} aria-hidden="true" />Print quote</button><button className="btn btn-secondary" disabled={busy !== null} onClick={() => setRetry(value => value + 1)}>Reload quote</button></div>
        </div>
      </section>
      <p className="text-muted public-quote-footer">Questions about this repair? Contact {quote.workspace_name} using the number above.</p>
    </main>
  )
}

export default function PublicQuote() {
  const { token } = useParams<{ token: string }>()
  if (!token) return <main className="public-quote"><StatePanel title="Quote link unavailable">A complete quotation link is required. Contact the repair shop for the correct link.</StatePanel></main>
  return <QuoteView key={token} token={token} />
}
