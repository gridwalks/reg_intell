-- Returns total database size in bytes
create or replace function public.get_db_size()
returns bigint language sql security definer stable set search_path = public as $$
  select pg_database_size(current_database())::bigint;
$$;

-- Returns total size of all objects in the regulatory-documents storage bucket
create or replace function public.get_storage_size()
returns bigint language sql security definer stable set search_path = public as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint
  from storage.objects
  where bucket_id = 'regulatory-documents';
$$;

-- Returns per-table row counts and sizes for key tables
create or replace function public.get_table_sizes()
returns table (
  table_name text,
  row_count  bigint,
  size_bytes bigint
) language sql security definer stable set search_path = public as $$
  select
    relname::text as table_name,
    reltuples::bigint as row_count,
    pg_total_relation_size(oid)::bigint as size_bytes
  from pg_class
  where relname in (
    'documents', 'document_chunks', 'newsletter_chunks',
    'newsletter_drafts', 'news_articles', 'news_sources', 'profiles'
  )
  order by 3 desc;
$$;
