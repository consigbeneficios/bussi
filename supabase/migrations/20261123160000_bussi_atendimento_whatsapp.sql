create table public.bussi_atendimento_mensagens (
  id bigint generated always as identity primary key,
  telefone text not null check (telefone ~ '^[1-9][0-9]{7,14}$'),
  contato text,
  direcao text not null check (direcao in ('entrada','saida')),
  tipo text not null check (length(tipo) between 1 and 30),
  texto text not null check (length(texto) <= 4096),
  meta_id text unique,
  pedido uuid unique,
  estado text not null check (estado in ('recebido','reservado','aceito','recusado','incerto')),
  ocorrido_em timestamptz not null default now()
);
create index bussi_atendimento_por_contato on public.bussi_atendimento_mensagens (telefone, id desc);
create index bussi_atendimento_entradas on public.bussi_atendimento_mensagens (telefone, ocorrido_em desc)
  where direcao = 'entrada';
alter table public.bussi_atendimento_mensagens enable row level security;
revoke all on public.bussi_atendimento_mensagens from public, anon, authenticated;
grant select, insert, update on public.bussi_atendimento_mensagens to service_role;

create function public.bussi_atendimento_conversas(p_busca text default '', p_offset integer default 0)
returns table (
  telefone text, nome text, texto text, direcao text, tipo text, ocorrido_em timestamptz, ultima_entrada timestamptz
)
language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (m.telefone) m.telefone, m.texto, m.direcao, m.tipo, m.ocorrido_em
      from public.bussi_atendimento_mensagens m order by m.telefone, m.id desc
  )
  select l.telefone, coalesce(nullif(p.contato,''),l.telefone),l.texto,l.direcao,l.tipo,l.ocorrido_em,p.ocorrido_em
    from latest l
    left join lateral (
      select m.contato,m.ocorrido_em from public.bussi_atendimento_mensagens m
      where m.telefone = l.telefone and m.direcao = 'entrada'
      order by m.ocorrido_em desc limit 1
    ) p on true
    where position(lower(coalesce(p_busca,'')) in lower(coalesce(p.contato,''))) > 0
      or position(coalesce(p_busca,'') in l.telefone) > 0
    order by l.ocorrido_em desc, l.telefone
    limit 51 offset greatest(p_offset, 0)
$$;
revoke all on function public.bussi_atendimento_conversas(text,integer) from public, anon, authenticated;
grant execute on function public.bussi_atendimento_conversas(text,integer) to service_role;

create function public.bussi_atendimento_historico(p_tel text, p_antes bigint default null)
returns table (
  id bigint, direcao text, tipo text, texto text, estado text, ocorrido_em timestamptz
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.direcao, m.tipo, m.texto, coalesce(e.estado,m.estado),m.ocorrido_em
    from public.bussi_atendimento_mensagens m
    left join lateral (
      select a.estado from public.bussi_whatsapp_eventos a where a.mensagem = m.meta_id
      order by case a.estado when 'read' then 3 when 'delivered' then 2 when 'failed' then 1 else 0 end desc limit 1
    ) e on true
    where m.telefone = p_tel and (p_antes is null or m.id < p_antes)
    order by m.id desc limit 61
$$;
revoke all on function public.bussi_atendimento_historico(text,bigint) from public, anon, authenticated;
grant execute on function public.bussi_atendimento_historico(text,bigint) to service_role;
