import { useState, useEffect, useRef } from 'react'
import { FileUp, File, Download } from 'lucide-react'
import type { Attachment } from '../../../shared/contracts'
import { apiRequest, errorMessage } from '../api/client'
import { attachmentsResponse, attachmentCreatedResponse } from '../../../shared/contracts'

export function JobAttachments({ workspaceId, jobId }: { workspaceId: string; jobId: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchAttachments = async () => {
    try {
      const res = await apiRequest(`/attachments?workspace_id=${workspaceId}&job_id=${jobId}`, attachmentsResponse)
      setAttachments(res.attachments)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchAttachments() }, [workspaceId, jobId])

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('File size exceeds 5MB limit.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiRequest(`/attachments?workspace_id=${workspaceId}&job_id=${jobId}`, attachmentCreatedResponse, {
        method: 'POST',
        headers: { 'X-File-Name': file.name, 'Content-Type': file.type },
        body: await file.arrayBuffer()
      })
      await fetchAttachments()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Attachments & photos</h2>
        <button className="btn btn-secondary btn-icon" onClick={() => inputRef.current?.click()} disabled={busy}>
          <FileUp size={18} />
        </button>
        <input type="file" ref={inputRef} className="hidden" onChange={handleUpload} />
      </div>
      <div className="panel-body stack">
        {error && <div className="notice notice-error">{error}</div>}
        {loading ? <p className="text-muted">Loading attachments...</p> : attachments.length === 0 ? <p className="text-muted">No attachments uploaded yet.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {attachments.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg bg-gray-50/50">
                <div className="flex items-center gap-3 overflow-hidden">
                  <File size={16} className="text-muted shrink-0" />
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium truncate">{item.file_name}</p>
                    <p className="text-[10px] text-muted">{(item.file_size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                   <a href={`/api/attachments/download/${item.id}?workspace_id=${encodeURIComponent(workspaceId)}`} className="btn btn-icon btn-secondary" title="Download" download={item.file_name}>
                      <Download size={14} />
                   </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
