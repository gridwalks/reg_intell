-- No stored column — tsvector computed inline in queries to avoid memory limits

-- ── Hybrid match for regular users (RRF: semantic + keyword) ─────────────────
create or replace function public.hybrid_match_document_chunks(
  query_text      text,
  query_embedding vector(1536),
  match_count     int default 10,
  p_user_id       uuid default null
)
returns table (
  id            uuid,
  document_id   uuid,
  document_name text,
  chunk_index   int,
  content       text,
  similarity    float,
  page_hint     text
)
language sql stable
as $$
  with semantic as (
    select dc.id,
           row_number() over (order by dc.embedding <=> query_embedding) as rank
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where (p_user_id is null or d.user_id = p_user_id)
      and d.status = 'ready'
    limit 60
  ),
  keyword as (
    select dc.id,
           row_number() over (
             order by ts_rank(to_tsvector('english', dc.content), plainto_tsquery('english', query_text)) desc
           ) as rank
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where (p_user_id is null or d.user_id = p_user_id)
      and d.status = 'ready'
      and to_tsvector('english', dc.content) @@ plainto_tsquery('english', query_text)
    limit 60
  ),
  fused as (
    select
      coalesce(s.id, k.id) as id,
      coalesce(1.0 / (60.0 + s.rank), 0.0)
        + coalesce(1.0 / (60.0 + k.rank), 0.0) as rrf_score
    from semantic s
    full outer join keyword k on s.id = k.id
  )
  select
    dc.id,
    dc.document_id,
    d.name  as document_name,
    dc.chunk_index,
    dc.content,
    f.rrf_score::float as similarity,
    dc.page_hint
  from fused f
  join public.document_chunks dc on dc.id = f.id
  join public.documents d        on d.id  = dc.document_id
  order by f.rrf_score desc
  limit match_count;
$$;

-- ── Admin version (no user filter, uses same function with null p_user_id) ───
-- admin_match_document_chunks is replaced by hybrid_match_document_chunks
-- with p_user_id = null; keep the old name as an alias for compatibility.
create or replace function public.admin_match_document_chunks(
  query_embedding vector(1536),
  match_count     int default 10
)
returns table (
  id            uuid,
  document_id   uuid,
  document_name text,
  chunk_index   int,
  content       text,
  similarity    float,
  page_hint     text
)
language sql stable
as $$
  select * from public.hybrid_match_document_chunks(
    '', query_embedding, match_count, null
  );
$$;

