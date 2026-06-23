create policy "admins can insert newsletter_drafts"
  on public.newsletter_drafts for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create policy "admins can update newsletter_drafts"
  on public.newsletter_drafts for update
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create policy "admins can delete newsletter_drafts"
  on public.newsletter_drafts for delete
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
