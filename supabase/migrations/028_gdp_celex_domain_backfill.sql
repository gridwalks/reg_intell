-- The correct EU GDP 2013 guideline (2013/C 343/01) was re-uploaded under the
-- filename CELEX_52013XC1123(01)_EN_TXT.pdf, replacing an earlier upload that
-- turned out to be the wrong document (EU Regulation 2019/6 on veterinary
-- medicinal products, mislabeled "EU Good Distribution Practice (GDP).pdf").
--
-- inferMetadata() in process-document-background.ts classifies domain from
-- the filename only, matching keywords like "GDP", "GOOD DISTRIBUTION",
-- "WHOLESALE DISTRIBUT". The CELEX filename is an opaque legal-citation code
-- with none of those keywords, so it was tagged 'general' at ingestion time
-- instead of 'distribution' — the same failure mode migration 026 backfilled
-- for the previous (wrong) file, just triggered by a different filename this
-- time. Backfill it here by matching on document content instead of the
-- filename, since we know this specific chunk set is genuinely GDP content.
set local statement_timeout = '5min';

with matching_docs as (
  select id
  from public.documents
  where name ~* 'CELEX.*52013XC1123'
     or name ~* '52013XC1123'
)
update public.document_chunks dc
set domain = array_append(coalesce(dc.domain, '{}'), 'distribution')
where dc.document_id in (select id from matching_docs)
  and not (dc.domain @> array['distribution']);
