-- Metadata columns for document chunks
alter table public.document_chunks
  add column if not exists source_type  text,   -- regulation | guideline | guidance | newsletter | Q&A
  add column if not exists issuing_body text,   -- ICH | FDA | EMA | PIC-S | EC | WHO | national
  add column if not exists product_type text[], -- drug | biologic | device | tobacco | veterinary
  add column if not exists geography    text[], -- US | EU | global
  add column if not exists domain       text[], -- GMP | GCP | GVP | CMC | clinical | pharmacovigilance | registration
  add column if not exists doc_version  text;

-- Update hybrid match to support optional domain/issuing_body filters
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
  with semantic as (
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
             order by ts_rank(to_tsvector('english', dc.content),
                              plainto_tsquery('english', query_text)) desc
           ) as rank
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where (p_user_id     is null or d.user_id       = p_user_id)
      and (p_domain      is null or dc.domain       @> array[p_domain])
      and (p_issuing_body is null or dc.issuing_body = p_issuing_body)
      and (p_geography   is null or dc.geography    @> array[p_geography])
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
    d.name       as document_name,
    dc.chunk_index,
    dc.content,
    f.rrf_score::float as similarity,
    dc.page_hint,
    dc.source_type,
    dc.issuing_body,
    dc.domain,
    dc.geography
  from fused f
  join public.document_chunks dc on dc.id = f.id
  join public.documents d        on d.id  = dc.document_id
  order by f.rrf_score desc
  limit match_count;
$$;
