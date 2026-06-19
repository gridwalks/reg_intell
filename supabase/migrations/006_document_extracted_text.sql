-- Store extracted text on the document row so the background function
-- can read it from the DB instead of receiving it in the POST body.
-- This avoids Netlify's function request body size limit for large PDFs.
alter table public.documents add column if not exists extracted_text text;
