-- SQL para revisão e inclusão em uma migração antes da publicação do piloto.
alter table public.bussi_whatsapp_entregas add column if not exists fatura_manual_em timestamptz;

CREATE OR REPLACE FUNCTION public.bussi_whatsapp_abrir_fatura(p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  entrega public.bussi_whatsapp_entregas;
  link bussi_internal.fatura_links;
  chave text;
  numero_fatura bigint;
  descricao_fatura text;
  descricao_padrao constant text := 'Black Friday 50% OFF - Referente a Competência: Dezembro';
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into entrega from public.bussi_whatsapp_entregas
    where fatura_acesso_hash = p_hash and fatura_expira_em > now()
      and oferta_status = 'aceito' and (resposta_id is not null or fatura_manual_em is not null)
      and pagador is not null
    for update;
  if not found then return null; end if;

  select * into link from bussi_internal.fatura_links where pedido = entrega.fatura_pedido;
  if not found then
    select case when conteudo::jsonb #>> '{chargeDraft,chargeDesc}' in
      (descricao_padrao, 'Black Friday 50% OFF - Referente a Competência: Janeiro')
      then conteudo::jsonb #>> '{chargeDraft,chargeDesc}' else descricao_padrao end
      into descricao_fatura
      from public.bussi_portal_arquivos
      where owner_id = '62102276-1162-4b87-a368-4cc5a4ca0ec2'
      order by criado_em desc, id desc limit 1;
    descricao_fatura := case entrega.campanha
      when 'blackfriday-2026' then descricao_padrao
      when 'bussi-janeiro-2027' then 'Black Friday 50% OFF - Referente a Competência: Janeiro'
      else coalesce(descricao_fatura, descricao_padrao)
    end;
    chave := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into bussi_internal.faturas(descricao, original_centavos, valor_centavos, token_hash, pagador)
      values(descricao_fatura, entrega.original, entrega.desconto,
        encode(sha256(convert_to(chave, 'UTF8')), 'hex'), entrega.pagador)
      returning numero into numero_fatura;
    insert into bussi_internal.fatura_links(numero, token, pedido)
      values(numero_fatura, chave, entrega.fatura_pedido) returning * into link;
  end if;
  return jsonb_build_object('numero', link.numero, 'token', link.token);
end
$function$;
