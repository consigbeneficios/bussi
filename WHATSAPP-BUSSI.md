# Campanha Black Friday no BUSSI

O painel GitHub Pages usa a sessão administrativa existente. O Supabase verifica essa sessão e envia os modelos pela Cloud API. O webhook recebe respostas, valida a assinatura da Meta e usa o cadastro associado ao envio para preencher o modelo `fatura`.

## Publicação

1. Aplique a migração `bussi_whatsapp_campaign` e publique a Edge Function `bussi-whatsapp`. O gateway precisa usar `verify_jwt = false` para aceitar o webhook da Meta. A função valida a assinatura do webhook ou a sessão administrativa com MFA, conforme a origem.
2. Configure os segredos da função no Supabase: `META_GRAPH_VERSION`, `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_WHATSAPP_TOKEN`, `META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN`. Use um token autorizado a consultar modelos e enviar mensagens pelo número.
3. No aplicativo da Meta, configure o webhook `https://<projeto>.supabase.co/functions/v1/bussi-whatsapp` com o token de verificação e assine o evento `messages` da conta WhatsApp Business.
4. Confirme que `blackfriday` e `fatura` foram aprovados em pt_BR. Valide o envio e a resposta com uma conta de teste antes de trocar a integração em uso.
5. Publique o painel e, em **Campanhas**, use **Verificar modelos**. Confira o público no CRM e envie depois de confirmar que os contatos elegíveis autorizaram mensagens pelo WhatsApp.

A campanha usa um cadastro por número brasileiro e uma oferta de 50%. O servidor reserva cada destinatário antes do envio para impedir duplicação. Um resultado indeterminado exige conciliação antes de qualquer reenvio. A confirmação da API indica aceite pela Meta.

Teste local com Node 24: `node supabase/functions/bussi-whatsapp/test.mjs`.