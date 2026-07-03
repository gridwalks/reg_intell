alter table public.documents
  add column if not exists issuing_body text; -- FDA | EMA | ICH | MHRA | PIC/S | WHO | EC | Health Canada | TGA | ANVISA | PMDA | other
