"use strict";
(() => {
  const chat = document.getElementById("bussiPreviewChat");
  if (!chat) return;

  function bubble(text, customer = false) {
    const row = document.createElement("div");
    row.className = "bussi-preview-bubble" + (customer ? " customer" : "");
    const body = document.createElement("p");
    for (const [index, segment] of text.split("*").entries()) {
      if (index % 2 === 0) body.append(document.createTextNode(segment));
      else {
        const emphasis = document.createElement("strong");
        emphasis.textContent = segment;
        body.append(emphasis);
      }
    }
    const time = document.createElement("time");
    time.className = "bussi-preview-time";
    const minutes = String(chat.children.length).padStart(2, "0");
    time.dateTime = time.textContent = "09:" + minutes;
    row.append(body, time);
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
    const offer = bubble("⚠️ Ola *Cliente Exemplo*!, SUA CONTA SERA BLOQUEADA⚠️\nSÓ SE VOCÊ DEIXAR PASSAR ESSA OPORTUNIDADE, NÉ😂\n\n*BLACK FRIDAY | 50% DE DESCONTO, ANTECIPANDO SUA PARCELA DO MÊS DE 12/Dezembro*\n\nParcela original: R$100,00\nParcela com desconto: R$50,00\n💰 Economize e tenha mais dinheiro para o final do ano!\n\n👉 Responda *\"EU QUERO\"* e daremos continuidade ao seu atendimento!");
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

  document.getElementById("bussiManualOpen").addEventListener("click", () => {
    const phone = document.getElementById("blackFridayRecipient").value;
    const text = document.getElementById("bussiManualBody").value.trim();
    const status = document.getElementById("bussiManualStatus");
    if (!/^55\d{10,11}$/.test(phone) || !text) {
      status.textContent = "Selecione um cliente e escreva a mensagem.";
      return;
    }
    window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(text), "_blank", "noopener,noreferrer");
    status.textContent = "Confira o rascunho no WhatsApp e envie por lá.";
  });
})();
