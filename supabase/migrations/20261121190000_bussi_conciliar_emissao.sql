-- Reserve one read-only lookup per invoice every two minutes across all workers.
alter table bussi_internal.faturas add column consulta_emissao_em timestamptz;
create function public.bussi_reservar_consulta_emissao(p_hash text)
returns boolean language sql security definer set search_path='' as $$
  with reserva as (
    update bussi_internal.faturas set consulta_emissao_em = now()
    where token_hash=p_hash and situacao='processando' and nitro_id is null
      and aceite_em between now()-interval '3 days' and now()-interval '45 seconds'
      and (consulta_emissao_em is null or consulta_emissao_em < now()-interval '2 minutes')
    returning 1
  ) select exists(select from reserva)
$$;
revoke all on function public.bussi_reservar_consulta_emissao(text) from public,anon,authenticated;
grant execute on function public.bussi_reservar_consulta_emissao(text) to service_role;
