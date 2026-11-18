# BUSSI — plano de publicação dos domínios
Atualizado: 2026-11-18.

## Endereços aprovados

- Painel: https://consigbeneficio.com.br/portal/
- Links curtos de pagamento: https://pay.consigbeneficio.com.br/fatura0011, /fatura0012, ...
- Página atual (mantida enquanto migração): https://consigbeneficios.github.io/bussi/

## Implementado no repositório

- Numeração local de faturas a partir de fatura0011, separada do campo Contrato.
- Contador salvo em localStorage, incluído no backup e que não diminui ao excluir faturas.
- O botão Gerar mantém URL de cobrança funcional no GitHub Pages.
- O painel mostra o endereço curto pretendido como PENDENTE — nunca como link já publicado.
- Histórico local registra data e horário de abertura, Pix exibido, Pix copiado e fatura baixada.
- Páginas de pagamento e comprovante preservadas.

## Para ativar os endereços em qualquer dispositivo

1. Identificar quem administra o DNS do domínio consigbeneficio.com.br e qual hospedagem serve seu site principal. Não substituir apontamentos da raiz do domínio sem verificar o site e o e-mail existentes.
2. Publicar os arquivos do painel em /portal/ no servidor do site principal, ou configurar reverse proxy com rota /portal/ para a origem BUSSI (com suporte a caminhos relativos).
3. Criar pay.consigbeneficio.com.br com certificado TLS/HTTPS e backend próprio.
4. Implementar registro central de faturas, com contador transacional e armazenamento seguro. A rota GET /fatura0011 deve buscar no banco a cobrança associada e carregar somente a informação pública necessária. Não colocar dados de clientes em arquivos públicos do GitHub.
5. Publicar API autenticada de emissão, confirmação manual, recusa e revogação; rejeitar cobranças expiradas no servidor; integrar o provedor financeiro caso seja necessário cancelar Pix dinamicamente.
6. Receber via backend os eventos do link, Pix, cópia e download, com horários e identificação por cobrança, para o dashboard do administrador funcionar em qualquer aparelho.
7. Configurar autenticação real do administrador, com recuperação de senha por e-mail. Senhas e tokens não podem ficar no HTML público.
8. Após validar HTTPS, DNS, backend, permissões e redirecionamentos, alterar o gerador para usar automaticamente os links curtos como links funcionais.

## Limitação atual

O GitHub Pages é estático. localStorage funciona apenas em cada navegador. Numeração em múltiplos dispositivos, URLs curtas de faturas, confirmação remota e relatórios globais precisam de backend. Apenas criar um CNAME ou um arquivo /fatura0011 não resolve esses requisitos de forma segura.

## Testes obrigatórios antes da migração

- Abrir /portal/ em desktop e celular.
- Acessar /fatura0011 num navegador anônimo e confirmar a fatura correta.
- Emitir fatura0011 e fatura0012 em sessões diferentes sem colisão de sequência.
- Receber e visualizar eventos e pagamentos registrados em outros dispositivos.
- Garantir que um número de fatura não dê acesso ao CRM nem a dados de outros clientes.
- Com pagamento confirmado ou vencimento, bloquear no backend o pagamento dinâmico e exibir estado encerrado.
- Garantir que os links GitHub Pages antigos sigam funcionando, com redirecionamento quando necessário.
