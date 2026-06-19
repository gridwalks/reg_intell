-- Allow authenticated users to manage news sources from the admin UI
create policy "authenticated insert sources"
  on public.news_sources for insert to authenticated
  with check (true);

create policy "authenticated update sources"
  on public.news_sources for update to authenticated
  using (true) with check (true);

create policy "authenticated delete sources"
  on public.news_sources for delete to authenticated
  using (true);
