import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Link } from 'react-router-dom'
import './index.css'
import App from './App'
import Dashboard from './pages/Dashboard'
import NewJob from './pages/NewJob'
import JobBoard from './pages/JobBoard'
import JobDetail from './pages/JobDetail'
import RecordPayment from './pages/RecordPayment'
import PublicQuote from './pages/PublicQuote'
import Settings from './pages/Settings'
import Customers from './pages/Customers'
import SignIn from './pages/SignIn'
import VerifyEmail from './pages/VerifyEmail'
import ResetPassword from './pages/ResetPassword'
import InviteAccept from './pages/InviteAccept'
import { WorkspaceProvider } from './state/Workspace'
import { AuthProvider, useAuth } from './state/Auth'
import { StatePanel } from './components/ui'
function Protected() {
  const { user, loading } = useAuth()
  if (loading) return <main className="public-quote"><StatePanel title="Checking your session">Loading your workspace.</StatePanel></main>
  if (!user) return <SignIn />
  return <WorkspaceProvider><App /></WorkspaceProvider>
}
const router=createBrowserRouter([
  {path:'/quote/:token',element:<PublicQuote />},
  {path:'/verify/:token',element:<VerifyEmail />},
  {path:'/reset/:token',element:<ResetPassword />},
  {path:'/invite/:token',element:<AuthProvider><InviteAccept /></AuthProvider>},
  {path:'/',element:<AuthProvider><Protected /></AuthProvider>,children:[
    {index:true,element:<Dashboard />},{path:'jobs/new',element:<NewJob />},{path:'jobs',element:<JobBoard />},{path:'jobs/:id',element:<JobDetail />},{path:'payments/new',element:<RecordPayment />},{path:'settings',element:<Settings />},{path:'customers',element:<Customers />},
    {path:'*',element:<StatePanel title="Page not found" action={<Link className="btn" to="/">Back to overview</Link>} />}
  ]}
])
const root=document.getElementById('root')
if(!root) throw new Error('The application root is missing.')
ReactDOM.createRoot(root).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>)
