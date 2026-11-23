create table public.bussi_testes_campanha (
  id uuid primary key default gen_random_uuid(),
  contrato text not null unique,
  nome text not null check (length(nome) between 2 and 120),
  telefone text not null check (telefone ~ '^55[0-9]{10,11}$'),
  original integer not null check (original > 0),
  desconto integer not null check (desconto > 0 and desconto <= original)
);
alter table public.bussi_testes_campanha enable row level security;
revoke all on public.bussi_testes_campanha from public, anon, authenticated;
grant select, insert, update on public.bussi_testes_campanha to service_role;
