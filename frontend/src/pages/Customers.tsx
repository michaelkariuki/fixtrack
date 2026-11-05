import { Link } from 'react-router-dom'
import { Search, ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { useWorkspace } from '../state/Workspace'
import { PageHeading, StatePanel, ErrorNotice } from '../components/ui'
export default function Customers() {
  const { jobs, loading, error } = useWorkspace(); const [query,setQuery] = useState('')
  const grouped = new Map<string,{ name:string; phone:string; email:string|null; count:number; open:number }>()
  for (const job of jobs) { const previous = grouped.get(job.customer_phone); grouped.set(job.customer_phone, { name: job.customer_name, phone: job.customer_phone, email: job.customer_email, count: (previous?.count || 0)+1, open: (previous?.open || 0)+(job.status !== 'delivered' ? 1 : 0) }) }
  const customers = Array.from(grouped.values()).filter(customer => `${customer.name} ${customer.phone}`.toLowerCase().includes(query.toLowerCase()))
  return <><PageHeading eyebrow="Customer directory" title="Customers" description="Customer contacts and the repair jobs connected to them." /><section className="panel"><div className="toolbar"><h2>{grouped.size} customer contacts</h2><div className="search-field"><Search size={14} /><input aria-label="Search customers" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or phone" /></div></div>{error ? <div className="panel-body"><ErrorNotice message={error} /></div> : loading ? <StatePanel title="Loading customers" /> : customers.length ? <div style={{overflowX:'auto'}}><table className="data-table"><thead><tr><th>Customer</th><th>Contact</th><th>Repair jobs</th><th>Open jobs</th><th>Records</th></tr></thead><tbody>{customers.map(customer => <tr key={customer.phone}><td><strong>{customer.name}</strong></td><td><a href={`tel:${customer.phone}`}>{customer.phone}</a>{customer.email && <small><a href={`mailto:${customer.email}`}>{customer.email}</a></small>}</td><td>{customer.count}</td><td>{customer.open}</td><td><Link className="btn" to={`/jobs?q=${encodeURIComponent(customer.phone)}`}>View jobs<ArrowUpRight size={13} /></Link></td></tr>)}</tbody></table></div> : <StatePanel title={query ? 'No matching customers' : 'No customers yet'}>Customer contacts appear when you intake a repair job.</StatePanel>}</section></>
}
