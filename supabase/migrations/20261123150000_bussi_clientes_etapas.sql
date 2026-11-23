create function public.bussi_clientes_etapas()
returns table (telefone text, nome text, etapa text, atualizado_em timestamptz, disparado boolean)
language sql stable security definer set search_path = '' as $$
  with campanha as (
    select e.telefone, e.nome,
      case
        when f.situacao = 'pago' and f.pago_verificado_em is not null and e.encerramento_status = 'aceito' then 'finalizado'
        when f.situacao = 'pago' and f.pago_verificado_em is not null then 'pago'
        when f.numero is not null then 'fatura'
        else 'em_acao'
      end as etapa,
      greatest(e.criada_em,e.resposta_em,f.criada_em,f.pago_verificado_em,e.encerramento_em) as atualizado_em,
      (e.oferta_status = 'aceito' or e.mensagem is not null) as disparado,
      1 as origem
    from public.bussi_whatsapp_entregas e
    left join bussi_internal.fatura_links l on l.pedido = e.fatura_pedido
    left join bussi_internal.faturas f on f.numero = l.numero
    where e.oferta_status = 'aceito' or e.mensagem is not null or f.numero is not null
  ),
  manuais as (
    select '55' || d.telefone as telefone, f.pagador->>'name' as nome,
      case when f.situacao = 'pago' and f.pago_verificado_em is not null then 'pago' else 'fatura' end as etapa,
      greatest(f.criada_em,f.pago_verificado_em) as atualizado_em, false as disparado, 0 as origem
    from bussi_internal.faturas f
    cross join lateral (select regexp_replace(coalesce(f.pagador->>'phone',''), '[^0-9]', '', 'g') as telefone) d
    where d.telefone ~ '^[0-9]{10,11}$' and length(trim(coalesce(f.pagador->>'name',''))) > 0
  ),
  etapas as (select * from campanha union all select * from manuais)
  select distinct on (e.telefone) e.telefone, e.nome, e.etapa, e.atualizado_em, e.disparado
    from etapas e
    order by e.telefone, e.origem desc, e.atualizado_em desc, e.etapa
$$;
revoke all on function public.bussi_clientes_etapas() from public, anon, authenticated;
grant execute on function public.bussi_clientes_etapas() to service_role;
