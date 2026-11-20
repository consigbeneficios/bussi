create function public.bussi_operador_ativo() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal' = 'aal2', false) and exists (
    select 1 from bussi_internal.recebimentos_admin a join auth.sessions s on s.user_id = a.user_id
    where a.user_id = auth.uid() and s.id::text = (auth.jwt()->>'session_id')
  )
$$;
revoke all on function public.bussi_operador_ativo() from public, anon;
grant execute on function public.bussi_operador_ativo() to authenticated;
create table public.bussi_portal_arquivos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  criado_em timestamptz not null default now(),
  conteudo jsonb not null check (
    jsonb_typeof(conteudo) = 'object' and pg_column_size(conteudo) <= 16000000
    and conteudo ?& array['clients','campaigns','charges','settings']
    and jsonb_typeof(conteudo->'clients')='array' and jsonb_typeof(conteudo->'charges')='array'
    and jsonb_typeof(conteudo->'campaigns')='array' and jsonb_typeof(conteudo->'settings')='object'
  ),
  assinatura text generated always as (md5(conteudo::text)) stored,
  unique(owner_id, assinatura)
);
alter table public.bussi_portal_arquivos enable row level security;
revoke all on public.bussi_portal_arquivos from public, anon, authenticated;
grant select on public.bussi_portal_arquivos to authenticated;
grant insert(conteudo) on public.bussi_portal_arquivos to authenticated;
create policy arquivos_leitura on public.bussi_portal_arquivos for select to authenticated
using (owner_id = (select auth.uid()) and (select public.bussi_operador_ativo()));
create policy arquivos_gravacao on public.bussi_portal_arquivos for insert to authenticated
with check (owner_id = (select auth.uid()) and (select public.bussi_operador_ativo()));
