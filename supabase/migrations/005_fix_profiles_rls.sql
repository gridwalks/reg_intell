-- Drop the recursive admin policy that caused infinite recursion
drop policy if exists "admins read all profiles" on public.profiles;

-- Security-definer function checks is_admin without triggering RLS recursion
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  )
$$;

-- Re-add the admin read-all policy using the function
create policy "admins read all profiles"
  on public.profiles for select to authenticated
  using (public.is_admin());
