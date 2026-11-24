# Campanha de WhatsApp do BUSSI

O operador escolhe um cliente do CRM e envia a oferta manualmente. Depois, o painel acompanha as confirmações da Meta, o clique em **EU QUERO**, o envio da fatura, a abertura do link, o atendimento e o pagamento. O CRM precisa ter nome completo, telefone único, contrato, CPF/CNPJ, e-mail e valores consistentes com o desconto de 50%.

## Modelos na Meta

| Nome | Idioma | Configuração |
| --- | --- | --- |
| `blackconsig` | Português (Brasil) | Nome, valor original e valor com desconto, nessa ordem. Resposta rápida **EU QUERO**. |
| `blackconsigconfe` | Português (Brasil) | Nome, telefone, valor original e valor com desconto, nessa ordem. Respostas rápidas **Gerar fatura** e **Falar com atendente**. |
| `blackdireatendente` | Português (Brasil) | Aviso de encaminhamento ao atendimento, sem variáveis. |

**Gerar fatura** envia um link em uma mensagem de texto. O link contém um token opaco no fragmento e expira após 24 horas. A primeira abertura emite a fatura. Aberturas seguintes recuperam a mesma fatura.

**Falar com atendente** registra a solicitação e envia o aviso de encaminhamento. As respostas seguintes ficam a cargo do operador. A conciliação Nitro confirma o pagamento. O operador envia a confirmação de pagamento manualmente pelo WhatsApp após verificar a liquidação. No atendimento BUSSI, a mensagem de texto exige uma conversa dentro da janela de 24 horas. Se o operador usar o modelo `blackconfirmapag` na ferramenta de atendimento, deve primeiro confirmar que a solicitação de baixa já foi encaminhada.

## Publicação e teste

1. Aplique as migrações do WhatsApp na ordem do repositório. A função `bussi_comprovante_verificado` deve estar instalada no projeto, como já está na produção.
2. Publique `bussi-whatsapp` com `verify_jwt = false` e atualize `fatura-bussi` preservando a sua configuração atual e dependências. A função WhatsApp valida a assinatura da Meta, a sessão administrativa ou as credenciais internas, conforme a ação.
3. Mantenha no Supabase `META_GRAPH_VERSION`, `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_WHATSAPP_TOKEN`, `META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN`. Na Meta, assine `messages` para a conta de produção.
4. Depois de aprovados os três modelos, publique o painel e teste com um único cadastro de teste. Verifique oferta, resposta, link, atendimento, pagamento no painel. Repita a abertura para confirmar que o número da fatura é o mesmo. Envie o aviso final manualmente após verificar o pagamento.
5. Um retorno indeterminado exige conciliação antes de qualquer tentativa de reenvio.

Teste simulado: `node supabase/functions/bussi-whatsapp/test.mjs`.

## Fluxo pelo Novus CRM

No BUSSI, selecione o cliente e clique em **Preparar oferta para o Novus** após confirmar o consentimento. Isso registra a oferta e os dados de emissão, sem disparar uma mensagem.

Configure um segredo aleatório dedicado de pelo menos 32 caracteres como `BUSSI_NOVUS_FLOW_TOKEN` no Supabase. No Novus, configure a autenticação do aplicativo para enviar `Authorization: Bearer <segredo>`. A URL da operação é `https://yzhjtqwpmxhigrijiuze.supabase.co/functions/v1/bussi-whatsapp?integracao=novus`, com método POST e JSON.

- Antes de preencher os modelos, envie `{"action":"dados_oferta","telefone":"<telefone do contato>"}`. Use a resposta com nome, telefone, valor original e valor com desconto.
- Após **GERAR FATURA**, envie `{"action":"gerar_fatura","telefone":"<telefone do contato>"}`. Responda ao cliente com a propriedade `url`. A URL abre diretamente em `pay.consigbeneficio.com.br`. A recuperação do link pelo Novus fica disponível por 24 horas, e a cobrança segue o vencimento da fatura.
- Em **FALAR COM ATENDENTE**, use o modelo original e transfira para o Financeiro. A confirmação de pagamento continua manual.

CPF/CNPJ, contrato e e-mail do pagador são usados no BUSSI para emissão. A resposta de integração entrega apenas os dados necessários à mensagem ou o link.
