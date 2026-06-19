alter table public.documents
  add column if not exists title text,
  add column if not exists document_date date;
