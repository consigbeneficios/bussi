"use strict";
(() => {
  const chat = document.getElementById("bussiPreviewChat");
  if (!chat) return;
  const inbox = document.getElementById("bussiChatList");
  const demo = document.getElementById("bussiChatDemo");
  const examples = document.getElementById("bussiExampleList");
  const search = document.getElementById("bussiChatSearch");
  const all = document.getElementById("bussiChatAll");
  const handoff = document.getElementById("bussiChatHandoff");
  const title = document.getElementById("bussiPreviewTitle");
  const subtitle = document.getElementById("bussiPreviewSubtitle");
  const caption = document.getElementById("bussiPreviewCaption");
  const reset = document.getElementById("bussiPreviewReset");
  const selection = document.getElementById("blackFridayRecipient");
  const money = new Intl.NumberFormat("pt-BR", {minimumFractionDigits:2,maximumFractionDigits:2});
  const testPhone = "5511959322028";
  const sample = {nome:"Cliente Exemplo",telefone:testPhone,original:10000,desconto:5000};
  const statusLabels = {reservado:"Reservado",aceito:"Aceito pela Meta",sent:"Enviado",delivered:"Entregue",
    read:"Lido",recusado:"Recusado",failed:"Falhou",incerto:"Indeterminado",
    aberta:"Aguardando pagamento",processando:"Processando",pendente:"Pix pendente",pago:"Pago",
    cancelado:"Cancelado",reembolsado:"Reembolsado"};
  let client = null;
  let example = null;
  let deliveries = [];
  let active = "";
  let onlyHandoff = false;
  const eventTime = new Intl.DateTimeFormat("pt-BR", {dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"});

  function bubble(text, customer = false, date = undefined) {
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
    if (date) {
      time.dateTime = date;
      time.textContent = eventTime.format(new Date(date));
    } else if (!active) time.dateTime = time.textContent = "09:" + minutes;
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
    active = "";
    chat.replaceChildren();
    const person = example || client || sample;
    const original = money.format(person.original / 100);
    const discounted = money.format(person.desconto / 100);
    title.textContent = "Consig Benefícios";
    subtitle.textContent = example ? "Exemplo para " + example.nome : client ? "Prévia para " + client.nome : "Prévia de conversa no WhatsApp";
    caption.textContent = example ? "Simulação para o número de teste final 2028. Nenhuma mensagem é enviada." :
      client ? "Prévia com o cadastro selecionado. Nenhuma mensagem é enviada." : "Simulação com dados fictícios. Nenhuma mensagem é enviada.";
    reset.hidden = false;
    renderList();
    const offer = bubble("⚠️ Ola *" + person.nome.replaceAll("*", "") + "*!, SUA CONTA SERA BLOQUEADA⚠️\nSÓ SE VOCÊ DEIXAR PASSAR ESSA OPORTUNIDADE, NÉ😂\n\n*BLACK FRIDAY | 50% DE DESCONTO, ANTECIPANDO SUA PARCELA DO MÊS DE 12/Dezembro*\n\nParcela original: R$" + original + "\nParcela com desconto: R$" + discounted + "\n💰 Economize e tenha mais dinheiro para o final do ano!\n\n👉 Responda *\"EU QUERO\"* e daremos continuidade ao seu atendimento!");
    actions(offer, [["EU QUERO", () => {
      bubble("EU QUERO", true);
      const invoice = bubble("Olá, " + person.nome.replaceAll("*", "") + ". Você solicitou os detalhes da antecipação de sua parcela.\nTelefone: " + person.telefone + "\nParcela original: R$ " + original + "\nValor com desconto: R$ " + discounted + "\nToque em Gerar fatura para abrir a página da Consig Benefícios e continuar.");
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

  function openTimeline(row) {
    if (selection.value !== row.telefone && selection.querySelector('option[value="' + row.telefone + '"]')) {
      selection.value = row.telefone;
      selection.dispatchEvent(new Event("change"));
    }
    example = null;
    active = row.telefone;
    title.textContent = row.nome;
    subtitle.textContent = row.telefone;
    caption.textContent = "Eventos registrados pelo BUSSI para esta campanha.";
    reset.hidden = true;
    chat.replaceChildren();
    const timeline = [
      ["Oferta Black Friday · " + (statusLabels[row.oferta_status] || "Aguardando"), row.oferta_em],
      ["EU QUERO", row.resposta_em, true],
      ["Mensagem de fatura · " + (statusLabels[row.fatura_status] || "Aguardando"), row.fatura_em],
      ["Fatura aberta no navegador", row.abertura_em, true],
      ["Falar com atendente", row.atendente_em, true],
      ["Pagamento confirmado", row.pago_em],
      ["Aviso de pagamento · " + (statusLabels[row.encerramento_status] || "Aguardando"), row.encerramento_em],
    ];
    for (const [label,date,customer] of timeline.filter(event => event[1]).sort((a,b) => Date.parse(a[1])-Date.parse(b[1]))) {
      bubble(label, customer, date);
    }
    renderList();
    chat.scrollTop = chat.scrollHeight;
  }

  function renderList() {
    demo.setAttribute("aria-pressed", String(!active && !example));
    for (const button of examples.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.example === example?.key && !active));
    inbox.replaceChildren();
    const term = search.value.trim().toLowerCase();
    const visible = deliveries.filter(row => (!onlyHandoff || row.atendente_em) &&
      (row.nome.toLowerCase().includes(term) || row.telefone.includes(term)));
    document.getElementById("bussiChatEmpty").hidden = visible.length > 0;
    for (const row of visible) {
      const button = document.createElement("button");
      button.className = "bussi-thread";
      button.type = "button";
      button.setAttribute("aria-pressed", String(row.telefone === active));
      const avatar = document.createElement("span");
      avatar.className = "bussi-thread-avatar";
      avatar.textContent = row.nome.trim().split(/\s+/).slice(0,2).map(part => part[0]).join("").toUpperCase();
      const info = document.createElement("span");
      const name = document.createElement("strong");
      const detail = document.createElement("small");
      name.textContent = row.nome;
      detail.textContent = row.encerramento_em ? "Encerramento registrado" : row.atendente_em ? "Atendimento solicitado" : statusLabels[row.oferta_status] || "Aguardando";
      info.append(name, detail);
      button.append(avatar, info);
      button.addEventListener("click", () => openTimeline(row));
      inbox.append(button);
    }
  }

  search.addEventListener("input",renderList);
  function filter(waiting) {
    onlyHandoff = waiting;
    all.setAttribute("aria-pressed",String(!waiting));
    handoff.setAttribute("aria-pressed",String(waiting));
    renderList();
  }
  all.addEventListener("click",() => filter(false));
  handoff.addEventListener("click",() => filter(true));
  demo.addEventListener("click", () => { example = null; start(); });
  document.addEventListener("bussi:campaign-examples", ({detail}) => {
    examples.replaceChildren();
    if (!detail.length) return;
    const heading = document.createElement("p");
    heading.className = "bussi-example-heading";
    heading.textContent = "Exemplos · menores parcelas";
    examples.append(heading);
    for (const person of detail) {
      const button = document.createElement("button");
      button.className = "bussi-thread";
      button.type = "button";
      button.dataset.example = person.telefone;
      button.setAttribute("aria-pressed", "false");
      const avatar = document.createElement("span");
      avatar.className = "bussi-thread-avatar";
      avatar.textContent = "R$";
      const info = document.createElement("span");
      const name = document.createElement("strong");
      const value = document.createElement("small");
      name.textContent = person.nome;
      value.textContent = "Parcela original: R$ " + money.format(person.original / 100);
      info.append(name, value);
      button.append(avatar, info);
      button.addEventListener("click", () => { example = {...person, key:person.telefone, telefone:testPhone}; start(); });
      examples.append(button);
    }
    renderList();
  });
  reset.addEventListener("click", start);
  document.addEventListener("bussi:campaign-recipient", event => {
    if (client?.telefone !== event.detail?.telefone) {
      document.getElementById("bussiManualBody").value = "";
      document.getElementById("bussiManualStatus").textContent = "";
    }
    example = null;
    client = event.detail;
    start();
  });
  document.addEventListener("bussi:campaign-flow", event => {
    deliveries = event.detail;
    const selected = deliveries.find(row => row.telefone === active);
    if (selected) openTimeline(selected);
    else if (active) start();
    else renderList();
  });
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
