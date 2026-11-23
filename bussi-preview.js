"use strict";
(() => {
  const chat = document.getElementById("bussiPreviewChat");
  if (!chat) return;

  function bubble(text, customer = false) {
    const row = document.createElement("div");
    row.className = "bussi-preview-bubble" + (customer ? " customer" : "");
    row.textContent = text;
    chat.append(row);
    return row;
  }

  function actions(row, choices) {
    const group = document.createElement("div");
    group.className = "bussi-preview-actions";
    for (const [label, callback] of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        for (const choice of group.children) choice.disabled = true;
        callback();
        chat.scrollTop = chat.scrollHeight;
      });
      group.append(button);
    }
    row.append(group);
  }

  function start() {
    chat.replaceChildren();
    const offer = bubble("Olá, Cliente Exemplo.\nBlack Friday: 50% de desconto na antecipação da parcela de dezembro.\nParcela original: R$ 100,00\nParcela com desconto: R$ 50,00");
    actions(offer, [["EU QUERO", () => {
      bubble("EU QUERO", true);
      const invoice = bubble("Olá, Cliente Exemplo. Você solicitou os detalhes da antecipação de sua parcela.\nTelefone: 5511999990000\nParcela original: R$ 100,00\nValor com desconto: R$ 50,00\nToque em Gerar fatura para abrir a página da Consig Benefícios e continuar.");
      actions(invoice, [
        ["Gerar fatura", () => {
          const generated = bubble("Na campanha, este botão abre a página de finalização da fatura.");
          actions(generated, [["Simular pagamento confirmado", () => {
            bubble("Recebemos seu pagamento. Iremos dar baixa na parcela.");
          }]]);
        }],
        ["Falar com atendente", () => {
          bubble("Falar com atendente", true);
          bubble("Estamos transferindo para um de nossos atendentes. Aguarde, por favor.");
        }],
      ]);
    }]]);
    chat.scrollTop = 0;
  }

  document.getElementById("bussiPreviewReset").addEventListener("click", start);
  start();
})();
