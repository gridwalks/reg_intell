import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Document = {
  id: string
  user_id: string
  name: string
  title: string | null
  document_date: string | null
  source_url: string | null
  processing_error: string | null
  file_path: string
  file_size: number | null
  file_type: string | null
  status: 'processing' | 'ready' | 'error'
  chunk_count: number
  created_at: string
  updated_at: string
}
