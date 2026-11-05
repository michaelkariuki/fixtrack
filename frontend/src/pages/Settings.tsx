import { useState, type FormEvent } from 'react'
import { Plus, Check, Building2, Palette, FileText, Users } from 'lucide-react'
import { useWorkspace } from '../state/Workspace'
import { useAuth } from '../state/Auth'
import { TeamPanel } from '../components/TeamPanel'
import { workspaceInputSchema, preferencesSchema } from '../../../shared/contracts'
import { errorMessage } from '../api/client'
import { PageHeading, Field, ErrorNotice } from '../components/ui'
export default function Settings() {
  const { workspace, loading, error: connectionError, preferences, updatePreferences, saveWorkspace } = useWorkspace()
  const { user } = useAuth()
  const [tab, setTab] = useState<'business'|'appearance'|'quotes'|'team'>('business'); const [create, setCreate] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(null); setSaved('')
    try {
      if (tab === 'business') { const input = workspaceInputSchema.parse(Object.fromEntries(data)); await saveWorkspace(input, create); setCreate(false); setSaved('Business details and branding saved to the database.') }
      else { const input = preferencesSchema.parse({ ...preferences, ...(tab === 'appearance' ? { accent: data.get('accent'), density: data.get('density'), collapsed: data.has('collapsed') } : { quoteTerms: data.get('quoteTerms') }) }); updatePreferences(input); setSaved('Preferences saved in this browser for this workspace.') }
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  return <><PageHeading eyebrow="Your workspace" title="Settings" description="Business branding, legal details, appearance and consistent quotation defaults." />
    <div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections">{([{id:'business',label:'Business & branding',Icon:Building2},{id:'appearance',label:'Appearance',Icon:Palette},{id:'quotes',label:'Quotation defaults',Icon:FileText},{id:'team',label:'Team',Icon:Users}] as const).map(item => <button key={item.id} className={`tab ${tab === item.id ? 'active' : ''}`} onClick={() => { setTab(item.id); setError(null); setSaved('') }} aria-pressed={tab === item.id}><item.Icon size={14} style={{display:'inline',marginRight:9}} />{item.label}</button>)}</nav>{tab === 'team' ? <TeamPanel workspaceId={workspace?.id} currentUserId={user?.id ?? ''} /> : <form className="panel" onSubmit={submit} key={`${tab}-${workspace?.id}-${create}`}><div className="panel-header"><h2>{tab === 'business' ? create || !workspace ? 'Create a business workspace' : 'Business branding & details' : tab === 'appearance' ? 'Workspace appearance' : 'Quotation defaults'}</h2>{tab === 'business' && workspace && !create && <button type="button" className="btn" onClick={() => setCreate(true)}><Plus size={13} />New workspace</button>}</div><div className="panel-body stack"><ErrorNotice message={error || connectionError} />{saved && <div className="notice notice-success" role="status"><Check size={16} />{saved}</div>}
    {tab === 'business' ? <><p className="text-muted">These details identify your shop and appear on customer repair quotations stored in D1.</p>
    <Field label="Business name"><input name="name" required defaultValue={create ? '' : workspace?.name} placeholder="Your repair shop" /></Field>
    <div className="form-grid">
      <Field label="Contact phone"><input name="phone" type="tel" required defaultValue={create ? '' : workspace?.phone} /></Field>
      <Field label="Tax ID / KRA PIN · optional"><input name="tax_id" defaultValue={create ? '' : workspace?.tax_id || ''} placeholder="e.g. P051234567X" /></Field>
    </div>
    <Field label="Shop address · optional"><input name="address" defaultValue={create ? '' : workspace?.address || ''} placeholder="Physical street address or town" /></Field>
    <Field label="Location summary · optional"><input name="location" defaultValue={create ? '' : workspace?.location || ''} placeholder="e.g. Nairobi CBD" /></Field>
    <Field label="Payment instructions · optional" hint="Provide M-Pesa Till/Paybill number or bank details to display on customer quotes."><textarea name="payment_instructions" rows={2} defaultValue={create ? '' : workspace?.payment_instructions || ''} placeholder="e.g. M-Pesa Buy Goods Till: 123456" /></Field>
    <Field label="Quote header message · optional" hint="Custom greeting or introductory note shown at the top of customer quotes."><input name="quote_header" defaultValue={create ? '' : workspace?.quote_header || ''} placeholder="e.g. Thank you for choosing our repair center!" /></Field>
    <Field label="Quote footer message · optional" hint="Closing note or warranty reminder shown at the bottom of customer quotes."><input name="quote_footer" defaultValue={create ? '' : workspace?.quote_footer || ''} placeholder="e.g. Devices uncollected after 30 days incur storage fees." /></Field>
    <div className="notice">Records are private to workspace members. Public quotation links and the M-Pesa callback remain open by design.</div></> : tab === 'appearance' ? <><p className="text-muted">Saved per workspace in this browser. Solid surfaces and readable status colors stay consistent.</p><div className="field"><span>Accent color</span><div className="radio-cards">{['violet','blue','teal'].map(value => <label className="radio-card" key={value}><input type="radio" name="accent" value={value} defaultChecked={preferences.accent === value} /><span style={{width:12,height:12,borderRadius:'50%',background:value === 'violet' ? '#6357b7' : value === 'blue' ? '#315fae' : '#28796f'}} />{value[0].toUpperCase()+value.slice(1)}</label>)}</div></div><div className="field"><span>List density</span><div className="radio-cards">{['compact','comfortable'].map(value => <label className="radio-card" key={value}><input name="density" type="radio" value={value} defaultChecked={preferences.density === value} />{value[0].toUpperCase()+value.slice(1)}</label>)}</div></div><label className="radio-card"><input type="checkbox" name="collapsed" defaultChecked={preferences.collapsed} />Collapse desktop sidebar</label></> : <><p className="text-muted">Used as the starting text for new quotations in this browser. Existing quotes are not changed.</p><Field label="Default repair terms" hint="State the scope, warranty and deposit terms you actually offer. This does not authorize device disposal."><textarea name="quoteTerms" defaultValue={preferences.quoteTerms} rows={7} maxLength={4000} placeholder="Add your shop’s agreed repair terms…" /></Field></>}
    <div className="form-actions">{create && <button type="button" className="btn" onClick={() => setCreate(false)}>Cancel</button>}<button className="btn btn-primary" disabled={busy || loading}>{busy ? 'Saving…' : 'Save changes'}</button></div></div></form>}</div>
  </>
}
