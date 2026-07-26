/**
 * reclassify-domains.mjs
 *
 * Backfill for the domain-tagging bug fixed in process-document-background.ts
 * (inferMetadata): document domain/issuing_body/source_type/geography/product_type
 * are inferred once from the filename at ingestion time and stored on every
 * chunk of that document. The original regexes assumed space-separated
 * filenames ("ICH E8 R1"), but real filenames mostly use underscores/hyphens
 * ("ICH_E8-R1_Guideline...") or omit "ICH" entirely ("E3_Guideline.pdf"), so
 * most of the numbered ICH E-series library (and a few others) was silently
 * mistagged 'general' instead of 'GCP'. Since hybrid_match_document_chunks
 * applies domain as a hard SQL filter, that made this content completely
 * unreachable for any question the query-side classifier correctly routed
 * to the GCP domain.
 *
 * This script re-runs the FIXED inferMetadata() against every already-
 * ingested document's stored filename and updates its chunks' metadata
 * columns to match — it does not touch embeddings or content, only the
 * five metadata columns.
 *
 * Usage:
 *   node --env-file=.env.local scripts/reclassify-domains.mjs           # dry run (default)
 *   node --env-file=.env.local scripts/reclassify-domains.mjs --apply   # writes changes
 *
 * Requires SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes('--apply')

if (!url || !key) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.')
  process.exit(1)
}

const supabase = createClient(url, key)

// ── Kept in sync by hand with inferMetadata() in
// netlify/functions/process-document-background.ts ────────────────────────
function inferMetadata(docName) {
  const n = docName.toUpperCase().replace(/[_\-()]/g, ' ')

  let issuing_body = 'unknown'
  if (/\bICH\b/.test(n)) issuing_body = 'ICH'
  else if (/\bEMA\b|\bEMEA\b|EudraLex|CHMP|CPMP|EMRN/.test(n)) issuing_body = 'EMA'
  else if (/\bFDA\b|CFR\b|CDER|CBER|CDRH|21\s*CFR/.test(n)) issuing_body = 'FDA'
  else if (/\bWHO\b/.test(n)) issuing_body = 'WHO'
  else if (/\bPIC.?S\b/.test(n)) issuing_body = 'PIC/S'
  else if (/\bEC\b|EUROPEAN COMMISSION/.test(n)) issuing_body = 'EC'
  else if (/MHRA/.test(n)) issuing_body = 'MHRA'

  const domain = []
  if (/\bGMP\b|GMP\s*ANNEX|CLEANROOM|EudraLex.*VOL.?4/.test(n)) domain.push('GMP')
  if (/\bGCP\b|ICH\s*E\d|CLINICAL\s*TRIAL|CTR\b|\bE\d{1,2}(?:[A-Z]{1,3})?\b/.test(n)) domain.push('GCP')
  if (/\bGVP\b|PHARMACOVIGILANCE|ADVERSE\s*REACTION|PSUR|PBRER|SUSAR|CIOMS/.test(n)) domain.push('pharmacovigilance')
  if (/\bCMC\b|CHEMISTRY|MANUFACTURING|CONTROL/.test(n)) domain.push('CMC')
  if (/REGISTRATION|MAA\b|NDA\b|BLA\b|VARIATION|DOSSIER/.test(n)) domain.push('registration')
  if (/CLINICAL|PHASE [123]|TRIAL/.test(n)) {
    if (!domain.includes('GCP')) domain.push('clinical')
  }
  if (/\bGDP\b|GOOD\s*DISTRIBUTION|WHOLESALE\s*DISTRIBUT|DISTRIBUTION\s*PRACTICE|DISTRIBUTION\s*AUTHORIS/.test(n)) domain.push('distribution')
  if (domain.length === 0) domain.push('general')

  let source_type = 'guideline'
  if (/REGULATION\b|\bREG\b|\bEC\s+\d{3,}|\bEU\s+\d{3,}|\b21\s*CFR/.test(n)) source_type = 'regulation'
  else if (/GUIDANCE\b/.test(n)) source_type = 'guidance'
  else if (/Q&A|QUESTION/.test(n)) source_type = 'Q&A'
  else if (/NEWSLETTER|BULLETIN/.test(n)) source_type = 'newsletter'

  const geography = []
  if (/\bEU\b|EMA\b|EMEA\b|EUROPEAN|EudraLex|EC\s+\d/.test(n)) geography.push('EU')
  if (/\bUS\b|FDA\b|CFR\b|CDER|CBER/.test(n)) geography.push('US')
  if (/\bICH\b|WHO\b|GLOBAL|INTERNATIONAL/.test(n)) geography.push('global')
  if (/\bUK\b|MHRA\b/.test(n)) geography.push('UK')
  if (geography.length === 0) geography.push('global')

  const product_type = ['drug']
  if (/BIOLOGIC|BIOLOGICS|BIOTECH|BIOSIMILAR/.test(n)) product_type.push('biologic')
  if (/DEVICE|MDR\b|IVDR\b/.test(n)) {
    product_type.length = 0
    product_type.push('device')
  }

  return { source_type, issuing_body, product_type, geography, domain }
}

// Merge newly-inferred domain tags into whatever a document's chunks
// already carry, rather than overwriting — some documents (e.g. the EU GDP
// guidelines notice, CELEX_52013XC1123(01)_EN_TXT.pdf) have a manually-added
// domain tag that no filename-based inference (old or new) could ever
// reproduce, since the trigger word isn't in the filename at all. Returns
// null when there is nothing to add, so those documents are left untouched
// rather than having their curated tag silently dropped.
function mergeDomain(current, inferred) {
  const cur = current ?? []
  const additions = inferred.filter(d => d !== 'general' && !cur.includes(d))
  if (additions.length === 0) {
    // Nothing new to add. Only fix a literally-empty array (never tagged at
    // all) — otherwise leave existing tags, including any manual ones, alone.
    return cur.length === 0 ? ['general'] : null
  }
  const merged = new Set([...cur.filter(d => d !== 'general'), ...additions])
  return [...merged].sort()
}

async function main() {
  console.log(`Connecting to ${url}`)
  console.log(APPLY ? 'Mode: APPLY (writing changes)\n' : 'Mode: DRY RUN (no writes — pass --apply to write)\n')

  const { data: documents, error: docErr } = await supabase
    .from('documents')
    .select('id, name')
    .order('name', { ascending: true })
  if (docErr) throw new Error(`Failed to fetch documents: ${docErr.message}`)

  console.log(`Found ${documents.length} document(s).\n`)

  let changedDocs = 0
  let changedChunks = 0
  let unchangedDocs = 0

  for (const doc of documents) {
    const metadata = inferMetadata(doc.name ?? '')

    // Peek at one existing chunk to compare current vs. new domain.
    const { data: sample, error: sampleErr } = await supabase
      .from('document_chunks')
      .select('domain')
      .eq('document_id', doc.id)
      .limit(1)
    if (sampleErr) throw new Error(`Failed to read chunk sample for ${doc.name}: ${sampleErr.message}`)
    if (!sample?.length) continue // no chunks yet (still processing) — skip

    const currentDomain = sample[0].domain ?? []
    const merged = mergeDomain(currentDomain, metadata.domain)
    const isChanged = merged !== null

    if (isChanged) {
      changedDocs++
      console.log(`CHANGE  ${doc.name}`)
      console.log(`        [${currentDomain.join(', ')}]  →  [${merged.join(', ')}]`)
    } else {
      unchangedDocs++
    }

    if (APPLY && isChanged) {
      // Only the domain column — source_type/issuing_body/geography/product_type
      // aren't part of the diagnosed bug, and leaving them alone avoids any risk
      // of clobbering unrelated manual corrections.
      const { error: updateErr, count } = await supabase
        .from('document_chunks')
        .update({ domain: merged }, { count: 'exact' })
        .eq('document_id', doc.id)
      if (updateErr) throw new Error(`Failed to update chunks for ${doc.name}: ${updateErr.message}`)
      changedChunks += count ?? 0
    }
  }

  console.log(`\n${changedDocs} document(s) need retagging, ${unchangedDocs} unchanged.`)
  if (APPLY) {
    console.log(`Updated ${changedChunks} chunk row(s).`)
  } else {
    console.log('Dry run only — re-run with --apply to write these changes.')
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
