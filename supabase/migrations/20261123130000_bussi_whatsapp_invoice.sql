alter table public.bussi_whatsapp_entregas
  add column pagador jsonb,
  add column fatura_acesso_hash text unique,
  add column fatura_expira_em timestamptz,
  add column fatura_pedido uuid not null default gen_random_uuid();

create function public.bussi_whatsapp_abrir_fatura(p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entrega public.bussi_whatsapp_entregas;
  link bussi_internal.fatura_links;
  chave text;
  numero_fatura bigint;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into entrega from public.bussi_whatsapp_entregas
    where fatura_acesso_hash = p_hash and fatura_expira_em > now()
      and oferta_status = 'aceito' and resposta_id is not null and pagador is not null
    for update;
  if not found then return null; end if;

  select * into link from bussi_internal.fatura_links where pedido = entrega.fatura_pedido;
  if not found then
    chave := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into bussi_internal.faturas(descricao, original_centavos, valor_centavos, token_hash, pagador)
      values('Antecipação de parcela — Black Friday', entrega.original, entrega.desconto,
        encode(sha256(convert_to(chave, 'UTF8')), 'hex'), entrega.pagador)
      returning numero into numero_fatura;
    insert into bussi_internal.fatura_links(numero, token, pedido)
      values(numero_fatura, chave, entrega.fatura_pedido) returning * into link;
  end if;
  return jsonb_build_object('numero', link.numero, 'token', link.token);
end
$$;
revoke all on function public.bussi_whatsapp_abrir_fatura(text) from public, anon, authenticated;
grant execute on function public.bussi_whatsapp_abrir_fatura(text) to service_role;