import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Upload,
  FileText,
  Trash2,
  CheckCircle,
  Clock,
  AlertTriangle,
  X,
  CloudUpload,
} from 'lucide-react'
import { supabase, type Document } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Text extraction helpers ──────────────────────────────────────────────────

async function extractPdfText(file: File): Promise<string> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  // Use the bundled worker via a CDN-like URL that Vite can resolve
  GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: arrayBuffer }).promise
  const parts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    parts.push(content.items.map((item: unknown) => (item as { str: string }).str).join(' '))
  }
  return parts.join('\n\n')
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

async function extractText(file: File): Promise<string> {
  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    return extractPdfText(file)
  }
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.endsWith('.docx')
  ) {
    return extractDocxText(file)
  }
  // Plain text / markdown
  return file.text()
}

// ── Component ────────────────────────────────────────────────────────────────

type UploadJob = {
  file: File
  status: 'extracting' | 'uploading' | 'embedding' | 'done' | 'error'
  error?: string
  progress: number
}

export default function DocumentsPage() {
  const { user, session } = useAuth()
  const [docs, setDocs] = useState<Document[]>([])
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchDocs = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setDocs(data ?? [])
  }, [user])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  // Poll processing documents every 3 s
  useEffect(() => {
    const hasProcessing = docs.some(d => d.status === 'processing')
    if (!hasProcessing) return
    const id = setInterval(fetchDocs, 3000)
    return () => clearInterval(id)
  }, [docs, fetchDocs])

  const processFile = async (file: File) => {
    if (!user || !session) return

    const ACCEPTED = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown']
    const isAccepted = ACCEPTED.includes(file.type) || file.name.match(/\.(pdf|docx|txt|md)$/i)
    if (!isAccepted) {
      setJobs(j => [...j, { file, status: 'error', error: 'Unsupported file type', progress: 0 }])
      return
    }

    const jobIdx = jobs.length
    const addJob = (update: Partial<UploadJob>) =>
      setJobs(prev => {
        const next = [...prev]
        next[jobIdx] = { ...next[jobIdx], ...update } as UploadJob
        return next
      })

    setJobs(prev => [...prev, { file, status: 'extracting', progress: 10 }])

    try {
      // 1. Hash file and check for duplicate
      const contentHash = await hashFile(file)
      const { data: existing } = await supabase
        .from('documents')
        .select('id, name')
        .eq('user_id', user.id)
        .eq('content_hash', contentHash)
        .maybeSingle()
      if (existing) {
        addJob({
          status: 'error',
          error: `Duplicate: this file has already been uploaded${existing.name !== file.name ? ` as "${existing.name}"` : ''}.`,
          progress: 0,
        })
        return
      }

      // 2. Extract text client-side
      const text = await extractText(file)
      if (text.trim().length < 50) throw new Error('Could not extract enough text from this file.')
      addJob({ status: 'uploading', progress: 30 })

      // 3. Upload raw file to Supabase Storage
      const filePath = `${user.id}/${Date.now()}_${file.name}`
      const { error: storageErr } = await supabase.storage
        .from('regulatory-documents')
        .upload(filePath, file)
      if (storageErr) throw storageErr
      addJob({ progress: 50 })

      // 3. Insert document record (including extracted text to avoid POST body size limits)
      const { data: docData, error: docErr } = await supabase
        .from('documents')
        .insert({
          user_id: user.id,
          name: file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: file.type,
          status: 'processing',
          extracted_text: text,
          content_hash: contentHash,
        })
        .select()
        .single()
      if (docErr) throw docErr
      addJob({ status: 'embedding', progress: 70 })

      // 4. Call Netlify Function to chunk + embed
      // Background function — returns 202 immediately, processes async
      // Document status is polled every 3s via fetchDocs
      const res = await fetch('/.netlify/functions/process-document-background', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ document_id: docData.id }),
      })
      if (res.status !== 202 && !res.ok) {
        throw new Error(`Server error ${res.status}`)
      }
      addJob({ status: 'done', progress: 100 })
      fetchDocs()
    } catch (err: unknown) {
      addJob({ status: 'error', error: err instanceof Error ? err.message : 'Upload failed', progress: 0 })
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(processFile)
  }

  const deleteDoc = async (doc: Document) => {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return
    await supabase.storage.from('regulatory-documents').remove([doc.file_path])
    await supabase.from('documents').delete().eq('id', doc.id)
    fetchDocs()
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="text-gray-500 mt-1">
          Upload regulatory documents to build your knowledge base.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors mb-6 ${
          dragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/50'
        }`}
      >
        <CloudUpload className="w-10 h-10 text-blue-400 mx-auto mb-3" />
        <p className="text-gray-700 font-medium">Drop files here or click to browse</p>
        <p className="text-gray-400 text-sm mt-1">
          Supports PDF, Word (.docx), and plain text / Markdown
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      {/* Active upload jobs */}
      {jobs.length > 0 && (
        <div className="space-y-2 mb-6">
          {jobs.map((job, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <p className="text-sm font-medium text-gray-800 flex-1 truncate">{job.file.name}</p>
                {job.status === 'done' && <CheckCircle className="w-4 h-4 text-green-500" />}
                {job.status === 'error' && <X className="w-4 h-4 text-red-500" />}
                {['extracting', 'uploading', 'embedding'].includes(job.status) && (
                  <span className="text-xs text-blue-600">
                    {job.status === 'extracting' && 'Extracting text…'}
                    {job.status === 'uploading' && 'Uploading…'}
                    {job.status === 'embedding' && 'Generating embeddings…'}
                  </span>
                )}
                <button onClick={() => setJobs(j => j.filter((_, idx) => idx !== i))}>
                  <X className="w-4 h-4 text-gray-300 hover:text-gray-500" />
                </button>
              </div>
              {job.status !== 'done' && job.status !== 'error' && (
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              )}
              {job.error && (
                <p className="text-xs text-red-600 mt-1">{job.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Document list */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          Your Documents ({docs.length})
        </h2>
        {docs.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No documents yet. Upload one above to get started.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {docs.map(doc => (
              <div key={doc.id} className="flex items-center gap-4 px-5 py-4 group">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-400">
                      {new Date(doc.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </span>
                    {doc.file_size && (
                      <span className="text-xs text-gray-400">
                        {(doc.file_size / 1024).toFixed(0)} KB
                      </span>
                    )}
                    {doc.chunk_count > 0 && (
                      <span className="text-xs text-gray-400">
                        {doc.chunk_count} chunks indexed
                      </span>
                    )}
                  </div>
                </div>
                <StatusChip status={doc.status} />
                <button
                  onClick={() => deleteDoc(doc)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 transition-all"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: Document['status'] }) {
  const styles: Record<Document['status'], string> = {
    ready: 'bg-green-100 text-green-700',
    processing: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
  }
  const icons: Record<Document['status'], ReactNode> = {
    ready: <CheckCircle className="w-3 h-3" />,
    processing: <Clock className="w-3 h-3 animate-spin" />,
    error: <AlertTriangle className="w-3 h-3" />,
  }
  return (
    <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
      {icons[status]}
      {status}
    </span>
  )
}
