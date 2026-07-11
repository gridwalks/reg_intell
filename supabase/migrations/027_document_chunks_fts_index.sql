-- Migration 025 converted the keyword arm of hybrid_match_document_chunks from
-- an AND-tsquery to an OR-tsquery to fix recall for natural-language questions.
-- That means a question can now match a much larger fraction of document_chunks
-- than before. There has never been an index supporting
-- `to_tsvector('english', content) @@ ...` (only the ivfflat index on the
-- embedding column exists) — every call did a full sequential scan computing
-- to_tsvector per row. That was cheap enough under the old strict AND filter
-- (few matching rows to rank), but with OR the resulting `order by ts_rank(...)
-- limit 60` now has to rank a much larger candidate set, which appears to be
-- pushing the chat Netlify function (a standard synchronous function with no
-- custom timeout) past its execution ceiling and producing a platform-level
-- 504.
--
-- Add a GIN index on the same to_tsvector expression used in the query so
-- Postgres can find matching rows without a full table scan.
set local statement_timeout = '10min';

create index if not exists document_chunks_content_fts_idx
  on public.document_chunks
  using gin (to_tsvector('english', content));
