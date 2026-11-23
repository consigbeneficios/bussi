alter table public.bussi_whatsapp_entregas
  add column resposta_em timestamptz,
  add column fatura_mensagem text unique,
  add column atendente_em timestamptz,
  add column atendente_resposta_id text unique,
  add column atendente_aviso_status text;

create table public.bussi_whatsapp_eventos (
  mensagem text not null,
  estado text not null check (estado in ('sent', 'delivered', 'read', 'failed')),
  ocorrido_em timestamptz not null,
  primary key (mensagem, estado)
);
alter table public.bussi_whatsapp_eventos enable row level security;
revoke all on public.bussi_whatsapp_eventos from public, anon, authenticated;
grant select, insert on public.bussi_whatsapp_eventos to service_role;

alter table public.bussi_whatsapp_entregas
  add column encerramento_em timestamptz,
  add column encerramento_status text;

create function public.bussi_whatsapp_reservar_encerramento(p_numero bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare destinatario text;
begin
  update public.bussi_whatsapp_entregas e
    set encerramento_em = now(), encerramento_status = 'reservado'
    from bussi_internal.fatura_links l join bussi_internal.faturas f using(numero)
    where f.numero = p_numero and l.pedido = e.fatura_pedido and e.encerramento_em is null
      and f.situacao = 'pago' and f.pago_verificado_em is not null
      and public.bussi_comprovante_verificado(f.numero, f.token_hash)->>'status' = 'LIQUIDADO'
    returning e.telefone into destinatario;
  return destinatario;
end
$$;
revoke all on function public.bussi_whatsapp_reservar_encerramento(bigint) from public, anon, authenticated;
grant execute on function public.bussi_whatsapp_reservar_encerramento(bigint) to service_role;

create function public.bussi_whatsapp_registrar_encerramento(p_numero bigint, p_status text)
returns void language sql security definer set search_path = '' as $$
  update public.bussi_whatsapp_entregas e set encerramento_status = p_status
    from bussi_internal.fatura_links l
    where l.numero = p_numero and l.pedido = e.fatura_pedido and e.encerramento_status = 'reservado'
      and p_status in ('aceito', 'recusado', 'incerto')
$$;
revoke all on function public.bussi_whatsapp_registrar_encerramento(bigint,text) from public, anon, authenticated;
grant execute on function public.bussi_whatsapp_registrar_encerramento(bigint,text) to service_role;

create function public.bussi_whatsapp_fluxo(p_offset integer default 0)
returns table (
  nome text, telefone text, oferta_status text, oferta_em timestamptz, resposta_em timestamptz,
  fatura_status text, fatura_em timestamptz, abertura_em timestamptz, pagamento text, pago_em timestamptz,
  atendente_em timestamptz, atendente_aviso_status text,
  encerramento_em timestamptz, encerramento_status text
)
language sql stable security definer set search_path = '' as $$
  select e.nome, e.telefone, coalesce(o.estado,e.oferta_status), coalesce(o.ocorrido_em,e.criada_em),
    e.resposta_em, coalesce(m.estado,e.fatura_status), coalesce(m.ocorrido_em,e.resposta_em),
    f.criada_em, f.situacao, f.pago_verificado_em, e.atendente_em, e.atendente_aviso_status, e.encerramento_em, e.encerramento_status
  from public.bussi_whatsapp_entregas e
  left join bussi_internal.fatura_links l on l.pedido = e.fatura_pedido
  left join bussi_internal.faturas f on f.numero = l.numero
  left join lateral (
    select a.estado,a.ocorrido_em from public.bussi_whatsapp_eventos a where a.mensagem = e.mensagem
      order by case a.estado when 'read' then 3 when 'delivered' then 2 when 'failed' then 1 else 0 end desc limit 1
  ) o on true
  left join lateral (
    select a.estado,a.ocorrido_em from public.bussi_whatsapp_eventos a where a.mensagem = e.fatura_mensagem
      order by case a.estado when 'read' then 3 when 'delivered' then 2 when 'failed' then 1 else 0 end desc limit 1
  ) m on true
  where e.campanha = 'blackfriday-2026'
  order by e.criada_em desc, e.telefone
  limit 50 offset greatest(p_offset, 0)
$$;
revoke all on function public.bussi_whatsapp_fluxo(integer) from public, anon, authenticated;
grant execute on function public.bussi_whatsapp_fluxo(integer) to service_role;