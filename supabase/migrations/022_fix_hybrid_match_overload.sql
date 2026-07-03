-- 020_chunk_metadata.sql added hybrid_match_document_chunks(text, vector, int, uuid, text, text, text)
-- via `create or replace function`, which created a second overload alongside the original
-- (text, vector, int, uuid) from 019_hybrid_retrieval.sql instead of replacing it — Postgres
-- distinguishes functions by full argument list. Calls that omit the optional p_domain/
-- p_issuing_body/p_geography params (i.e. pass only the first 4 named args) are now ambiguous
-- between the two overloads and fail with "function ... is not unique".
drop function if exists public.hybrid_match_document_chunks(text, vector(1536), int, uuid);
