import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ClipboardList } from 'lucide-react'
import { jobInputSchema, jobCreatedResponse } from '../../../shared/contracts'
import { useWorkspace } from '../state/Workspace'
import { apiRequest, errorMessage } from '../api/client'
import { PageHeading, ErrorNotice, Field, StatePanel } from '../components/ui'
export default function NewJob() {
  const { workspace, loading, error: workspaceError, refresh } = useWorkspace(); const navigate = useNavigate()
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspace || busy) return
    const data = new FormData(event.currentTarget)
    const raw = Object.fromEntries(data)
    const input = jobInputSchema.safeParse({ ...raw, workspace_id: workspace.id })
    if (!input.success) {
      const errs: Record<string, string> = {}
      for (const issue of input.error.issues) {
        if (issue.path[0]) errs[String(issue.path[0])] = issue.message
      }
      setFieldErrors(errs)
      setError('Please fix the highlighted form errors.')
      return
    }
    setBusy(true); setError(null); setFieldErrors({})
    try { 
      const result = await apiRequest('/jobs', jobCreatedResponse, { method: 'POST', body: JSON.stringify(input.data) })
      await refresh()
      navigate(`/jobs/${result.job.id}`) 
    } catch (cause) { 
      setError(errorMessage(cause)) 
    } finally { 
      setBusy(false) 
    }
  }
  
  if (loading) return <StatePanel title="Loading business details" />
  if (!workspace) return <><ErrorNotice message={workspaceError} /><StatePanel title="Set up your business" action={<Link className="btn btn-primary" to="/settings">Business settings</Link>}>A repair job needs a real workspace, not a test identifier.</StatePanel></>
  
  return <div className="form-width"><Link className="btn btn-link" to="/jobs"><ArrowLeft size={13} />Back to jobs</Link><PageHeading eyebrow="Device intake" title="New repair job" description="Capture what arrived, who owns it and what needs attention." /><form onSubmit={submit} className="panel"><div className="panel-header"><h2>Job card details</h2><ClipboardList size={17} color="var(--muted)" /></div><div className="panel-body stack"><ErrorNotice message={error} /><section className="form-section"><div><h2>Customer information</h2><p className="text-muted">Contact details for quotation approval and collection.</p></div><div className="form-grid">
    <Field label="Full name" error={fieldErrors.customer_name}><input required name="customer_name" autoComplete="name" maxLength={500} placeholder="Customer name" /></Field>
    <Field label="Phone number" hint="Use the customer’s reachable number, e.g. 0712… or +254…" error={fieldErrors.customer_phone}><input required name="customer_phone" type="tel" autoComplete="tel" placeholder="Customer phone" /></Field>
  </div>
  <Field label="Email address · optional" error={fieldErrors.customer_email}><input name="customer_email" type="email" autoComplete="email" placeholder="customer@example.com" /></Field></section><section className="form-section"><div><h2>Device information</h2><p className="text-muted">Describe the device and accessories in your care. Do not store passwords.</p></div><div className="form-grid">
    <Field label="Device category" error={fieldErrors.device_category}><select name="device_category"><option>Smartphone</option><option>Laptop</option><option>Tablet</option><option>TV</option><option>Appliance</option><option>Audio</option><option>Other</option></select></Field>
    <Field label="Brand / model" error={fieldErrors.device_model}><input required name="device_model" placeholder="e.g. Samsung Galaxy A54" maxLength={500} /></Field>
  </div>
  <Field label="Serial / IMEI · optional" error={fieldErrors.serial_number}><input name="serial_number" placeholder="Device identifier" maxLength={2000} /></Field>
  <Field label="Reported fault" error={fieldErrors.fault_description}><textarea name="fault_description" required placeholder="What is not working? Note visible condition as well." maxLength={500} /></Field>
  <Field label="Accessories left · optional" error={fieldErrors.accessories_included}><input name="accessories_included" placeholder="e.g. charger, laptop bag" maxLength={2000} /></Field></section><div className="form-actions"><Link className="btn btn-secondary" to="/jobs">Cancel</Link><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving job…' : 'Create job card'}<ArrowRight size={14} /></button></div></div></form></div>
}
