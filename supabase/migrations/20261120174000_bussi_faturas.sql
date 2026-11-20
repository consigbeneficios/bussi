create table bussi_internal.faturas (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity (start with 11) unique,
  token_hash text not null unique,
  descricao text not null,
  original_centavos bigint not null check (original_centavos between 2 and 999999999),
  valor_centavos bigint not null check (valor_centavos > 0),
  criada_em timestamptz not null default now(),
  vence_em timestamptz not null default (((now() at time zone 'America/Sao_Paulo')::date + 2)::timestamp at time zone 'America/Sao_Paulo'),
  situacao text not null default 'aberta' check (situacao in ('aberta','processando','pendente','pago','reembolsado','cancelado')),
  aceite_em timestamptz, pagador jsonb, nitro_id text unique, pix text, qr text,
  verificado_em timestamptz, pago_verificado_em timestamptz
);
alter table bussi_internal.faturas enable row level security;
revoke all on bussi_internal.faturas from public, anon, authenticated;

create function public.bussi_criar_fatura(p_descricao text, p_original bigint, p_token_hash text)
returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
  if not public.bussi_operador_ativo() then raise insufficient_privilege; end if;
  if length(trim(p_descricao)) not between 8 and 180 or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Dados inválidos'; end if;
  insert into bussi_internal.faturas(descricao,original_centavos,valor_centavos,token_hash)
  values(trim(p_descricao),p_original,(p_original+1)/2,p_token_hash)
  on conflict (token_hash) do nothing returning numero into n;
  if n is null then select numero into strict n from bussi_internal.faturas
    where token_hash=p_token_hash and descricao=trim(p_descricao) and original_centavos=p_original; end if;
  return n;
end $$;
revoke all on function public.bussi_criar_fatura(text,bigint,text) from public,anon;
grant execute on function public.bussi_criar_fatura(text,bigint,text) to authenticated;

-- Only the server may resolve a bearer link, claim a Pix, or apply a gateway result.
create function public.bussi_fatura_servidor(p_op text,p_chave text,p_dados jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare f bussi_internal.faturas; novo text;
begin
  if p_op='notificacao' then
    select * into f from bussi_internal.faturas where id::text=p_chave and aceite_em is not null;
  else
    select * into f from bussi_internal.faturas where token_hash=p_chave for update;
  end if;
  if f.id is null then return null; end if;
  if p_op='aceitar' then
    if f.situacao<>'aberta' or f.vence_em<=now() then return null; end if;
    update bussi_internal.faturas set situacao='processando',aceite_em=now(),pagador=p_dados where id=f.id returning * into f;
  elsif p_op='recusada' then
    if f.situacao='processando' and f.nitro_id is null then
      update bussi_internal.faturas set situacao='aberta',pagador=null,aceite_em=null where id=f.id returning * into f;
    end if;
  elsif p_op='vincular' then
    if f.situacao<>'processando' or f.nitro_id is not null then return null; end if;
    update bussi_internal.faturas set situacao='pendente',nitro_id=p_dados->>'id',pix=p_dados->>'pix',qr=p_dados->>'qr' where id=f.id returning * into f;
  elsif p_op='verificar' then
    novo=p_dados->>'situacao';
    if f.nitro_id is distinct from p_dados->>'id' or f.valor_centavos is distinct from (p_dados->>'centavos')::bigint or f.id::text is distinct from p_dados->>'ordem'
       or novo not in ('pendente','pago','reembolsado','cancelado') then return null; end if;
    if f.situacao='reembolsado' or (f.situacao='pago' and novo<>'reembolsado') or (f.situacao='cancelado' and novo='pendente') then novo=f.situacao; end if;
    update bussi_internal.faturas set situacao=novo,verificado_em=now(),
      pago_verificado_em=case when novo='pago' then coalesce(pago_verificado_em,now()) else pago_verificado_em end,
      pix=case when novo='pendente' then pix end,qr=case when novo='pendente' then qr end
      where id=f.id returning * into f;
    if novo = 'pago' then
      insert into bussi_internal.payment_reconciliation(provider,provider_transaction_id,internal_reference,currency,amount_minor,received_at)
      values('nitro',f.nitro_id,f.id::text,'BRL',f.valor_centavos,coalesce(f.pago_verificado_em,now()))
      on conflict(provider,provider_transaction_id) do nothing;
    end if;
  elsif p_op not in ('ler','notificacao') then raise exception 'Operação inválida'; end if;
  return to_jsonb(f) - 'pagador';
end $$;
revoke all on function public.bussi_fatura_servidor(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bussi_fatura_servidor(text,text,jsonb) to service_role;
