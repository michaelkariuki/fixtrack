import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { z } from 'zod'
import { type Workspace, type Job, type Preferences, preferencesSchema, workspacesResponse, workspaceResponse, jobsResponse, type workspaceInputSchema } from '../../../shared/contracts'
import { apiRequest, errorMessage } from '../api/client'

const defaults = preferencesSchema.parse({})
const storedIdSchema = z.string()
function selectedWorkspace(): string { try { return storedIdSchema.parse(JSON.parse(localStorage.getItem('fixtrack.workspace') || '""')) } catch { return '' } }
function readPreferences(id: string): Preferences { try { return preferencesSchema.parse(JSON.parse(localStorage.getItem(`fixtrack.preferences.${id}`) || '{}')) } catch { return defaults } }
interface WorkspaceState {
  workspace: Workspace | undefined; workspaces: Workspace[]; jobs: Job[]; loading: boolean; error: string | null;
  refresh: () => Promise<void>; selectWorkspace: (id: string) => void;
  saveWorkspace: (input: z.infer<typeof workspaceInputSchema>, create?: boolean) => Promise<void>;
  preferences: Preferences; updatePreferences: (value: Preferences) => void;
}
const WorkspaceContext = createContext<WorkspaceState | null>(null)
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState(selectedWorkspace)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preferences, setPreferences] = useState(() => readPreferences(id))
  const requestSequence = useRef(0)
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current
    setLoading(true); setError(null)
    try {
      const data = await apiRequest('/workspaces', workspacesResponse)
      if (sequence !== requestSequence.current) return
      setWorkspaces(data.workspaces)
      const nextId = data.workspaces.some(item => item.id === id) ? id : data.workspaces[0]?.id || ''
      if (nextId !== id) { setPreferences(readPreferences(nextId)); setId(nextId); setJobs([]); return }
      const nextJobs = id ? (await apiRequest(`/jobs?workspace_id=${encodeURIComponent(id)}`, jobsResponse)).jobs : []
      if (sequence === requestSequence.current) setJobs(nextJobs)
    } catch (cause) { if (sequence === requestSequence.current) { setError(errorMessage(cause)); setJobs([]) } }
    finally { if (sequence === requestSequence.current) setLoading(false) }
  }, [id])
  useEffect(() => { void refresh(); return () => { requestSequence.current++ } }, [refresh])
  useEffect(() => { setPreferences(readPreferences(id)); try { localStorage.setItem('fixtrack.workspace', JSON.stringify(id)) } catch { setError('Workspace selection cannot be stored in this browser.') } }, [id])
  useEffect(() => { document.documentElement.dataset.accent = preferences.accent; document.documentElement.dataset.density = preferences.density }, [preferences])
  function updatePreferences(value: Preferences) { const parsed = preferencesSchema.parse(value); localStorage.setItem(`fixtrack.preferences.${id}`, JSON.stringify(parsed)); setPreferences(parsed) }
  async function saveWorkspace(input: z.infer<typeof workspaceInputSchema>, create = false) {
    const result = await apiRequest(create || !id ? '/workspaces' : `/workspaces/${encodeURIComponent(id)}`, workspaceResponse, { method: create || !id ? 'POST' : 'PATCH', body: JSON.stringify(input) })
    setWorkspaces(previous => [...previous.filter(item => item.id !== result.workspace.id), result.workspace])
    if (result.workspace.id !== id) { requestSequence.current++; setPreferences(readPreferences(result.workspace.id)); setId(result.workspace.id); setJobs([]) }
    else await refresh()
  }
  const value = { workspace: workspaces.find(item => item.id === id), workspaces, jobs, loading, error, refresh, selectWorkspace: (next: string) => { requestSequence.current++; setJobs([]); setPreferences(readPreferences(next)); setId(next) }, saveWorkspace, preferences, updatePreferences }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
export function useWorkspace(): WorkspaceState { const value = useContext(WorkspaceContext); if (!value) throw new Error('WorkspaceProvider is required'); return value }
