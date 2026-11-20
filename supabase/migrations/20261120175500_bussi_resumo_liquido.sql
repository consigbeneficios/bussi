create or replace function public.bussi_resumo_recebimentos() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.bussi_operador_ativo() then raise insufficient_privilege; end if;
 return (select jsonb_build_object('quantidade',count(*),'total_centavos',coalesce(sum(r.amount_minor),0)::text)
 from bussi_internal.payment_reconciliation r
 where r.currency='BRL' and not exists(select 1 from bussi_internal.faturas f
   where r.provider='nitro' and f.nitro_id=r.provider_transaction_id and f.situacao='reembolsado'));
end $$;
