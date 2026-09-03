create table if not exists public.nvchat_short_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  destination_url text not null,
  title text,
  active boolean not null default true,
  click_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nvchat_short_links_code_format check (code ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  constraint nvchat_short_links_url_http check (destination_url ~* '^https?://'),
  constraint nvchat_short_links_title_length check (title is null or char_length(title) <= 120)
);

alter table public.nvchat_short_links enable row level security;

revoke all on table public.nvchat_short_links from anon, authenticated;
grant select, insert, update, delete on table public.nvchat_short_links to authenticated;

create policy "nvchat_admin_can_read_short_links"
on public.nvchat_short_links
for select
to authenticated
using (coalesce((auth.jwt() -> 'app_metadata' ->> 'nvchat_admin')::boolean, false));

create policy "nvchat_admin_can_insert_short_links"
on public.nvchat_short_links
for insert
to authenticated
with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'nvchat_admin')::boolean, false));

create policy "nvchat_admin_can_update_short_links"
on public.nvchat_short_links
for update
to authenticated
using (coalesce((auth.jwt() -> 'app_metadata' ->> 'nvchat_admin')::boolean, false))
with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'nvchat_admin')::boolean, false));

create policy "nvchat_admin_can_delete_short_links"
on public.nvchat_short_links
for delete
to authenticated
using (coalesce((auth.jwt() -> 'app_metadata' ->> 'nvchat_admin')::boolean, false));

create or replace function public.resolve_nvchat_short_link(p_code text)
returns table(destination_url text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.nvchat_short_links
     set click_count = click_count + 1,
         updated_at = now()
   where code = lower(btrim(p_code))
     and active = true
  returning nvchat_short_links.destination_url;
end;
$$;

revoke all on function public.resolve_nvchat_short_link(text) from public;
grant execute on function public.resolve_nvchat_short_link(text) to anon, authenticated;

comment on table public.nvchat_short_links is 'Links curtos gerenciados pelo painel administrativo do site NVChat.';
