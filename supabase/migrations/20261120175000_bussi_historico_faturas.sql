create table bussi_internal.fatura_links (
 numero bigint primary key references bussi_internal.faturas(numero),
 token text unique not null,
 pedido uuid unique not null
);
alter table bussi_internal.fatura_links enable row level security;
revoke all on bussi_internal.fatura_links from public,anon,authenticated;
revoke execute on function public.bussi_criar_fatura(text,bigint,text) from authenticated;

create function public.bussi_emitir_link(p_descricao text,p_original bigint,p_pedido uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link bussi_internal.fatura_links; chave text; n bigint;
begin
 if not public.bussi_operador_ativo() then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_pedido::text,0));
 select * into link from bussi_internal.fatura_links where pedido=p_pedido;
 if found then
   if not exists(select 1 from bussi_internal.faturas where numero=link.numero and descricao=trim(p_descricao) and original_centavos=p_original) then
     raise exception 'O pedido já existe com outro valor ou descrição'; end if;
 else
   chave:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
   n:=public.bussi_criar_fatura(p_descricao,p_original,encode(sha256(convert_to(chave,'UTF8')),'hex'));
   insert into bussi_internal.fatura_links(numero,token,pedido) values(n,chave,p_pedido) returning * into link;
 end if;
 return jsonb_build_object('numero',link.numero,'token',link.token);
end $$;
revoke all on function public.bussi_emitir_link(text,bigint,uuid) from public,anon;
grant execute on function public.bussi_emitir_link(text,bigint,uuid) to authenticated;
create function public.bussi_historico_faturas(p_antes bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.bussi_operador_ativo() then raise insufficient_privilege; end if;
 return (select coalesce(jsonb_agg(to_jsonb(h) order by h.numero desc),'[]') from (
 select f.numero,f.descricao,f.valor_centavos,f.vence_em,
 case when f.vence_em<=now() and f.situacao in ('aberta','pendente') then 'expirada' else f.situacao end as situacao,l.token
 from bussi_internal.faturas f join bussi_internal.fatura_links l using(numero)
 where p_antes is null or f.numero<p_antes order by f.numero desc limit 50) h);
end $$;
revoke all on function public.bussi_historico_faturas(bigint) from public,anon;
grant execute on function public.bussi_historico_faturas(bigint) to authenticated;
