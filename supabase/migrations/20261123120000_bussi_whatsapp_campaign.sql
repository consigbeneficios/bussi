create table public.bussi_whatsapp_entregas (
  campanha text not null,
  telefone text not null check (telefone ~ '^55[0-9]{10,11}$'),
  nome text not null,
  original integer not null check (original > 0),
  desconto integer not null check (desconto > 0 and desconto = (original + 1) / 2),
  mensagem text unique,
  oferta_status text not null default 'reservado',
  fatura_status text,
  resposta_id text unique,
  criada_em timestamptz not null default now(),
  primary key (campanha, telefone)
);
create index bussi_whatsapp_resposta_idx on public.bussi_whatsapp_entregas (telefone, criada_em desc)
where oferta_status = 'aceito';
alter table public.bussi_whatsapp_entregas enable row level security;
revoke all on public.bussi_whatsapp_entregas from public, anon, authenticated;
grant select, insert, update on public.bussi_whatsapp_entregas to service_role;
