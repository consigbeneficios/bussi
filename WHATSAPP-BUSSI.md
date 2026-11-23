# Campanha de WhatsApp do BUSSI

O operador escolhe um cliente do CRM e envia a oferta manualmente. Depois, o painel acompanha as confirmações da Meta, o clique em **EU QUERO**, o envio da fatura, a abertura do link, o atendimento e o pagamento. O CRM precisa ter nome completo, telefone único, contrato, CPF/CNPJ, e-mail e valores consistentes com o desconto de 50%.

## Modelos na Meta

| Nome | Idioma | Configuração |
| --- | --- | --- |
| `blackfriday` | Português (Brasil) | Variáveis posicionais nome, valor original e valor com desconto. Resposta rápida **EU QUERO**. |
| `fatura_bussi` | Português (Brasil) | Variáveis nomeadas `customer_name`, `tel`, `valor`, `desconto`. Botão de URL dinâmica **Gerar fatura** e resposta rápida **Falar com atendente**. |
| `pagamento_recebido_bussi` | Português (Brasil) | Utilidade. Corpo sem variáveis: Recebemos seu pagamento. Iremos dar baixa na parcela. |

Use `https://consigbeneficios.github.io/bussi/fatura-whatsapp.html#{{1}}` como URL dinâmica e um sufixo fictício como exemplo. Deixe o rastreamento do link desabilitado. O link contém apenas um token opaco no fragmento e expira após 24 horas. A primeira abertura emite a fatura. Aberturas seguintes recuperam a mesma fatura. A página continua no domínio oficial de pagamento.

O clique em **Falar com atendente** registra a solicitação e envia o aviso “Estamos transferindo para um de nossos atendentes. Aguarde, por favor.”. As respostas seguintes ficam a cargo do operador. O aviso de pagamento só é enviado quando a conciliação Nitro permite emitir o comprovante verificável. A mensagem informa a baixa futura. O fluxo não altera a parcela no sistema de contratos.

## Publicação e teste

1. Aplique as migrações do WhatsApp na ordem do repositório. A função `bussi_comprovante_verificado` deve estar instalada no projeto, como já está na produção.
2. Publique `bussi-whatsapp` com `verify_jwt = false` e atualize `fatura-bussi` preservando a sua configuração atual e dependências. A função WhatsApp valida a assinatura da Meta, a sessão administrativa ou as credenciais internas, conforme a ação.
3. Mantenha no Supabase `META_GRAPH_VERSION`, `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_WHATSAPP_TOKEN`, `META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN`. Na Meta, assine `messages` para a conta de produção.
4. Depois de aprovados os três modelos, publique o painel e teste com um único cadastro de teste. Verifique oferta, resposta, link, atendimento, pagamento e aviso final no painel. Repita a abertura para confirmar que o número da fatura é o mesmo.
5. Um retorno indeterminado exige conciliação antes de qualquer tentativa de reenvio.

Teste simulado: `node supabase/functions/bussi-whatsapp/test.mjs`.