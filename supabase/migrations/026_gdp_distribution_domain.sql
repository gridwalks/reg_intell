-- Adds a 'distribution' domain bucket (GDP / wholesale distribution / supply
-- chain) to the taxonomy. classifyDomain() in chat.ts and inferMetadata() in
-- process-document-background.ts were updated in the same change to classify
-- queries and tag *newly ingested* documents into this bucket.
--
-- inferMetadata only runs at ingestion time, so documents already indexed
-- before this change (e.g. EU GDP 2013 Guidelines, 2013/C 343/01) never got
-- a chance to be tagged 'distribution'. Backfill them here.
--
-- First attempt at this migration hit "canceling statement due to statement
-- timeout": document_chunks has no index on document_id (only the ivfflat
-- index on embedding), so `update document_chunks ... from documents ...`
-- forced a full sequential scan + regex evaluation joined row-by-row against
-- every chunk. Fixed by (a) adding the missing document_id index — useful
-- generally, not just for this migration — and (b) filtering the small
-- `documents` table down to matching ids first via a CTE, so the update
-- itself only has to match against a short, known id list.
set local statement_timeout = '5min';

create index if not exists document_chunks_document_id_idx
  on public.document_chunks (document_id);

with matching_docs as (
  select id
  from public.documents
  where name  ~* '\mgdp\M'
     or name  ~* 'good\s*distribution\s*practice'
     or name  ~* 'wholesale\s*distribut'
     or name  ~* 'distribution\s*practice'
     or name  ~* 'distribution\s*authoris'
     or name  ~* '2013/C\s*343'
     or coalesce(title, '') ~* '\mgdp\M'
     or coalesce(title, '') ~* 'good\s*distribution\s*practice'
     or coalesce(title, '') ~* 'wholesale\s*distribut'
     or coalesce(title, '') ~* '2013/C\s*343'
)
update public.document_chunks dc
set domain = array_append(coalesce(dc.domain, '{}'), 'distribution')
where dc.document_id in (select id from matching_docs)
  and not (dc.domain @> array['distribution']);
