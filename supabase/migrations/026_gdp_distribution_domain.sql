-- Adds a 'distribution' domain bucket (GDP / wholesale distribution / supply
-- chain) to the taxonomy. classifyDomain() in chat.ts and inferMetadata() in
-- process-document-background.ts were updated in the same change to classify
-- queries and tag *newly ingested* documents into this bucket.
--
-- inferMetadata only runs at ingestion time, so documents already indexed
-- before this change (e.g. EU GDP 2013 Guidelines, 2013/C 343/01) never got
-- a chance to be tagged 'distribution'. Backfill them here by matching the
-- same name/title patterns the ingestion-time classifier now uses, plus a
-- couple of content-based patterns for documents whose name alone doesn't
-- signal this domain (e.g. a generically-titled "2013/C 343/01" document).
update public.document_chunks dc
set domain = array_append(coalesce(dc.domain, '{}'), 'distribution')
from public.documents d
where dc.document_id = d.id
  and not (dc.domain @> array['distribution'])
  and (
    d.name  ~* '\mgdp\M'
    or d.name  ~* 'good\s*distribution\s*practice'
    or d.name  ~* 'wholesale\s*distribut'
    or d.name  ~* 'distribution\s*practice'
    or d.name  ~* 'distribution\s*authoris'
    or coalesce(d.title, '') ~* '\mgdp\M'
    or coalesce(d.title, '') ~* 'good\s*distribution\s*practice'
    or coalesce(d.title, '') ~* 'wholesale\s*distribut'
    or d.name  ~* '2013/C\s*343'
    or coalesce(d.title, '') ~* '2013/C\s*343'
  );
