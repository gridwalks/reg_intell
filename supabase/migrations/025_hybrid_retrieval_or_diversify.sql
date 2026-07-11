-- Two fixes to hybrid_match_document_chunks (last redefined in 020_chunk_metadata.sql,
-- the only surviving overload after 022_fix_hybrid_match_overload.sql):
--
-- 1. The keyword arm used plainto_tsquery, which ANDs every word in the query
--    together. A natural-language question ("What are the ICH Q10 requirements
--    for pharmaceutical quality systems?") rarely has all of those words
--    co-occur in a single chunk, so the keyword arm silently contributed
--    nothing and the match depended entirely on the (HyDE) embedding arm.
--    We rewrite the AND-tsquery into an OR-tsquery so chunks matching *any*
--    query term are found, still ranked by ts_rank.
--
-- 2. The final selection was a pure global "order by rrf_score desc limit
--    match_count" with no per-document diversification. A handful of chunks
--    from one or two documents (e.g. boilerplate/cover-page chunks, or
--    several unrelated-but-term-dense documents) could occupy the entire
--    top-N and crowd out the substantively relevant document entirely, even
--    though that document is indexed and has a matching chunk further down
--    the ranking. We now rank chunks within each document (doc_rank) and
--    order by (doc_rank, rrf_score) instead of (rrf_score) alone, so the
--    top match_count slots are filled breadth-first: the single best chunk
--    from every distinct matching document first, then second-best chunks,
--    etc. This guarantees a relevant-but-lower-scoring document still gets
--    a seat at the table instead of losing every slot to other documents.
create or replace function public.hybrid_match_document_chunks(
  query_text       text,
  query_embedding  vector(1536),
  match_count      int     default 10,
  p_user_id        uuid    default null,
  p_domain         text    default null,
  p_issuing_body   text    default null,
  p_geography      text    default null
)
returns table (
  id            uuid,
  document_id   uuid,
  document_name text,
  chunk_index   int,
  content       text,
  similarity    float,
  page_hint     text,
  source_type   text,
  issuing_body  text,
  domain        text[],
  geography     text[]
)
language sql stable
as $$
  with query as (
    select case
             when plainto_tsquery('english', query_text) = ''::tsquery
               then plainto_tsquery('english', query_text)
             else (replace(plainto_tsquery('english', query_text)::text, ' & ', ' | '))::tsquery
           end as tsq
  ),
  semantic as (
    select dc.id,
           row_number() over (order by dc.embedding <=> query_embedding) as rank
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where (p_user_id     is null or d.user_id       = p_user_id)
      and (p_domain      is null or dc.domain       @> array[p_domain])
      and (p_issuing_body is null or dc.issuing_body = p_issuing_body)
      and (p_geography   is null or dc.geography    @> array[p_geography])
      and d.status = 'ready'
    limit 60
  ),
  keyword as (
    select dc.id,
           row_number() over (
             order by ts_rank(to_tsvector('english', dc.content), query.tsq) desc
           ) as rank
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    cross join query
    where (p_user_id     is null or d.user_id       = p_user_id)
      and (p_domain      is null or dc.domain       @> array[p_domain])
      and (p_issuing_body is null or dc.issuing_body = p_issuing_body)
      and (p_geography   is null or dc.geography    @> array[p_geography])
      and d.status = 'ready'
      and to_tsvector('english', dc.content) @@ query.tsq
    limit 60
  ),
  fused as (
    select
      coalesce(s.id, k.id) as id,
      coalesce(1.0 / (60.0 + s.rank), 0.0)
        + coalesce(1.0 / (60.0 + k.rank), 0.0) as rrf_score
    from semantic s
    full outer join keyword k on s.id = k.id
  ),
  scored as (
    select
      f.id,
      f.rrf_score,
      dc.document_id,
      row_number() over (partition by dc.document_id order by f.rrf_score desc) as doc_rank
    from fused f
    join public.document_chunks dc on dc.id = f.id
  )
  select
    dc.id,
    dc.document_id,
    d.name       as document_name,
    dc.chunk_index,
    dc.content,
    sc.rrf_score::float as similarity,
    dc.page_hint,
    dc.source_type,
    dc.issuing_body,
    dc.domain,
    dc.geography
  from scored sc
  join public.document_chunks dc on dc.id = sc.id
  join public.documents d        on d.id  = dc.document_id
  order by sc.doc_rank asc, sc.rrf_score desc
  limit match_count;
$$;
