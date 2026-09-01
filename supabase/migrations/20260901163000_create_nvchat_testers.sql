create extension if not exists pgcrypto;

create table if not exists public.nvchat_testers (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  created_at timestamptz not null default now(),
  consent boolean not null default false,
  status text not null default 'interessado',
  invited_at timestamptz,
  notes text,
  constraint nvchat_testers_email_normalized check (email = lower(btrim(email))),
  constraint nvchat_testers_email_format check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint nvchat_testers_name_length check (name is null or char_length(name) <= 120),
  constraint nvchat_testers_notes_length check (notes is null or char_length(notes) <= 1000),
  constraint nvchat_testers_status_check check (status in ('interessado','convidado','ativo','removido')),
  constraint nvchat_testers_public_defaults check (
    (status <> 'interessado') or (invited_at is null)
  )
);

create unique index if not exists nvchat_testers_email_unique
  on public.nvchat_testers (email);

alter table public.nvchat_testers enable row level security;

revoke all on table public.nvchat_testers from anon, authenticated;
grant insert (name, email, consent) on table public.nvchat_testers to anon, authenticated;
grant select, update on table public.nvchat_testers to authenticated;

create policy "public_can_register_interest"
on public.nvchat_testers
for insert
to anon, authenticated
with check (
  consent = true
  and status = 'interessado'
  and invited_at is null
  and notes is null
  and email = lower(btrim(email))
);

create policy "nvchat_admin_can_read_testers"
on public.nvchat_testers
for select
to authenticated
using (
  coalesce((auth.jwt() -> 'app_metadata' ->> 'nvchat_admin')::boolean, false)
);

create policy "nvchat_admin_can_update_testers"
on public.nvchat_testers
for update
to authenticated
using (
  coalesce((auth.jwt() -> 'app_metadata' ->> 'nvchat_admin')::boolean, false)
)
with check (
  coalesce((auth.jwt() -> 'app_metadata' ->> 'nvchat_admin')::boolean, false)
);

comment on table public.nvchat_testers is 'Interessados em participar dos testes do NVChat na Google Play.';
comment on column public.nvchat_testers.notes is 'Observação interna visível apenas para administradores autorizados.';
