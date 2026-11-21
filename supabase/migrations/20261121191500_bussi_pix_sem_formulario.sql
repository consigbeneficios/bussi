alter table bussi_internal.faturas add column emissao_http_status smallint check (emissao_http_status between 400 and 599);

CREATE OR REPLACE FUNCTION public.bussi_fatura_servidor(p_op text, p_chave text, p_dados jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    update bussi_internal.faturas set situacao='processando',aceite_em=now(),emissao_http_status=null,pagador=coalesce(nullif(p_dados,'{}'::jsonb),f.pagador) where id=f.id returning * into f;
    -- Only a successful server-side claim needs payer data for the gateway.
    return to_jsonb(f);
  elsif p_op='falha_emissao' then
    if f.situacao='processando' and f.nitro_id is null then
      update bussi_internal.faturas set emissao_http_status=(p_dados->>'http')::smallint where id=f.id returning * into f;
    end if;
  elsif p_op='recusada' then
    if f.situacao='processando' and f.nitro_id is null then
      update bussi_internal.faturas set situacao='aberta',aceite_em=null where id=f.id returning * into f;
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
end $function$
;
