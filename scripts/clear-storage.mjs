/**
 * clear-storage.mjs
 * Deletes all files in the regulatory-documents Supabase Storage bucket.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your-key \
 *   node scripts/clear-storage.mjs
 *
 * Or create a .env.local file and run:
 *   node --env-file=.env.local scripts/clear-storage.mjs
 */

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'regulatory-documents'
const PAGE_SIZE = 100

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.')
  process.exit(1)
}

const supabase = createClient(url, key)

async function listAllFiles() {
  const allFiles = []
  // Storage is flat — files are nested under user-id prefixes.
  // We list the top-level "folders" (user ID prefixes) first, then list inside each.
  const { data: topLevel, error: topErr } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: PAGE_SIZE })

  if (topErr) throw new Error(`Failed to list bucket root: ${topErr.message}`)
  if (!topLevel?.length) return []

  for (const entry of topLevel) {
    if (entry.id) {
      // It's a file at the root level (shouldn't happen, but handle it)
      allFiles.push(entry.name)
    } else {
      // It's a folder prefix — list files inside
      let offset = 0
      while (true) {
        const { data: files, error } = await supabase.storage
          .from(BUCKET)
          .list(entry.name, { limit: PAGE_SIZE, offset })
        if (error) throw new Error(`Failed to list ${entry.name}: ${error.message}`)
        if (!files?.length) break
        for (const f of files) {
          allFiles.push(`${entry.name}/${f.name}`)
        }
        if (files.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }
    }
  }
  return allFiles
}

async function main() {
  console.log(`Connecting to ${url}`)
  console.log(`Scanning bucket: ${BUCKET}…\n`)

  const files = await listAllFiles()

  if (files.length === 0) {
    console.log('Bucket is already empty.')
    return
  }

  console.log(`Found ${files.length} file(s):`)
  files.forEach(f => console.log(`  ${f}`))
  console.log()

  // Delete in batches of 100 (Supabase limit per call)
  let deleted = 0
  for (let i = 0; i < files.length; i += PAGE_SIZE) {
    const batch = files.slice(i, i + PAGE_SIZE)
    const { error } = await supabase.storage.from(BUCKET).remove(batch)
    if (error) throw new Error(`Delete failed at batch ${i}: ${error.message}`)
    deleted += batch.length
    console.log(`Deleted ${deleted}/${files.length} files…`)
  }

  console.log(`\nDone. ${deleted} file(s) removed from ${BUCKET}.`)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
