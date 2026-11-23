"use strict";
(() => {
  const chat = document.getElementById("bussiPreviewChat");
  if (!chat) return;
  const card = chat.closest(".bussi-preview");
  const inbox = document.getElementById("bussiChatList");
  const demo = document.getElementById("bussiChatDemo");
  const examples = document.getElementById("bussiExampleList");
  const search = document.getElementById("bussiChatSearch");
  const mediaInput = document.getElementById("bussiCampaignImage");
  const mediaStatus = document.getElementById("bussiCampaignImageStatus");
  let mediaPreview = "";
  const officialArtwork = "blackfriday-consig.svg";
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
  let manualPhone = "";
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
    card.dataset.mode = "preview";
    active = "";
    chat.replaceChildren();
    const person = example || client || sample;
    const original = money.format(person.original / 100);
    const discounted = money.format(person.desconto / 100);
    title.textContent = "Consig Benefícios";
    subtitle.textContent = example ? "Exemplo para " + example.nome : client ? "Prévia para " + client.nome : "Prévia de conversa no WhatsApp";
    caption.textContent = example ? "Cadastro de teste. Nenhuma mensagem é enviada." :
      client ? "Prévia com o cadastro selecionado. Nenhuma mensagem é enviada." : "Simulação com dados fictícios. Nenhuma mensagem é enviada.";
    reset.hidden = false;
    renderList();
    const offer = bubble("*Black Friday 50%OFF - P/Referente ao Mês - 12/Dezembro*\nConfirme os dados, a baixo!\n\nNome: " +
      person.nome.replaceAll("*","") + "\nTelefone:" + person.telefone + "\nParcela original: *R$" + original +
      "*\nValor com desconto: *R$" + discounted + "*\n\nDados incorretos? Selecione *\"Falar com Atendente\"*");
    const image = document.createElement("img");
    image.className = "bussi-message-media";
    image.alt = "Imagem da campanha Black Friday";
    image.src = mediaPreview || officialArtwork;
    offer.prepend(image);
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
    }],["Falar com atendente", () => {
      bubble("Falar com atendente",true);
      bubble("Estamos transferindo para um de nossos atendentes. Aguarde, por favor.");
    }]]);
    chat.scrollTop = 0;
  }

  function openTimeline(row) {
    card.dataset.mode = "history";
    if (selection.value !== row.telefone && selection.querySelector('option[value="' + row.telefone + '"]')) {
      selection.value = row.telefone;
      selection.dispatchEvent(new Event("change"));
    }
    example = null;
    manualPhone = row.telefone;
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

  mediaInput.addEventListener("change", () => {
    const file = mediaInput.files[0];
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    mediaPreview = "";
    if (file && ["image/jpeg","image/png"].includes(file.type) && file.size <= 5 * 1024 * 1024) {
      mediaPreview = URL.createObjectURL(file);
      mediaStatus.textContent = "Imagem exibida na prévia nesta sessão.";
    } else {
      mediaInput.value = "";
      mediaStatus.textContent = file ? "Selecione um JPG ou PNG de até 5 MB." : "Selecione o JPG ou PNG do modelo.";
    }
    example = null;
    start();
  });

  search.addEventListener("input",renderList);
  function filter(waiting) {
    onlyHandoff = waiting;
    all.setAttribute("aria-pressed",String(!waiting));
    handoff.setAttribute("aria-pressed",String(waiting));
    renderList();
  }
  all.addEventListener("click",() => filter(false));
  handoff.addEventListener("click",() => filter(true));
  demo.addEventListener("click", () => { manualPhone = ""; example = null; start(); });
  document.addEventListener("bussi:campaign-examples", ({detail}) => {
    examples.replaceChildren();
    if (!detail.length) return;
    const heading = document.createElement("p");
    heading.className = "bussi-example-heading";
    heading.textContent = "Clientes de teste";
    examples.append(heading);
    for (const person of detail) {
      const button = document.createElement("button");
      button.className = "bussi-thread";
      button.type = "button";
      button.dataset.example = person.id;
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
      button.addEventListener("click", () => { example = {...person, key:person.id}; start(); });
      examples.append(button);
    }
    renderList();
  });
  reset.addEventListener("click", start);
  document.addEventListener("bussi:open-test-client", ({detail}) => {
    manualPhone = "";
    example = {...detail,key:detail.id};
    document.getElementById("bussiManualBody").value = "";
    start();
  });
  document.addEventListener("bussi:open-real-client", ({detail}) => {
    if (selection.value !== detail.telefone && [...selection.options].some(option => option.value === detail.telefone)) {
      selection.value = detail.telefone;
      selection.dispatchEvent(new Event("change"));
    }
    manualPhone = detail.telefone;
    document.getElementById("bussiManualBody").value = "";
    document.getElementById("bussiManualStatus").textContent = "Conversa com " + detail.nome + ".";
    const match = deliveries.find(item => item.telefone === detail.telefone);
    if (match) openTimeline(match);
    else {
      card.dataset.mode = "history";
      active = detail.telefone;
      example = null;
      title.textContent = detail.nome;
      subtitle.textContent = detail.telefone;
      caption.textContent = "Use o campo de mensagem para abrir esta conversa no WhatsApp.";
      reset.hidden = true;
      chat.replaceChildren();
      bubble("Nenhum evento desta campanha para este cliente.");
      renderList();
    }
    document.getElementById("bussiManualBody").focus();
  });
  document.addEventListener("bussi:campaign-recipient", event => {
    manualPhone = "";
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
    else renderList();
  });
  start();

  const batchStart = document.getElementById("bussiBatchStart");
  const batchStop = document.getElementById("bussiBatchStop");
  const progress = document.getElementById("bussiBatchProgress");
  const batchStatus = document.getElementById("bussiBatchStatus");
  let timer;
  function finishBatch() {
    clearTimeout(timer);
    batchStart.disabled = false;
    batchStop.disabled = true;
  }
  batchStart.addEventListener("click", () => {
    const total = Number(document.getElementById("bussiBatchCount").value);
    const seconds = Number(document.getElementById("bussiBatchPause").value);
    if (!Number.isInteger(total) || total < 1 || total > 150 ||
        !Number.isInteger(seconds) || seconds < 5 || seconds > 120) {
      batchStatus.textContent = "Informe 1 a 150 contatos e uma pausa de 5 a 120 segundos.";
      return;
    }
    progress.max = total;
    progress.value = 0;
    batchStart.disabled = true;
    batchStop.disabled = false;
    function next() {
      progress.value = Math.min(total, progress.value + 15);
      if (progress.value === total) {
        batchStatus.textContent = "Simulação concluída. Nenhuma mensagem enviada.";
        finishBatch();
        return;
      }
      batchStatus.textContent = progress.value + " de " + total + " simulados. Próxima rodada em " + seconds + " segundos.";
      timer = setTimeout(next, seconds * 1000);
    }
    next();
  });
  batchStop.addEventListener("click", () => {
    finishBatch();
    batchStatus.textContent = "Simulação pausada após " + progress.value + " contato(s).";
  });

  document.getElementById("bussiManualOpen").addEventListener("click", () => {
    const phone = example ? "" : manualPhone || selection.value;
    const text = document.getElementById("bussiManualBody").value.trim();
    const status = document.getElementById("bussiManualStatus");
    if (example) {
      status.textContent = "Este cadastro é de teste. Selecione um cliente real para abrir o WhatsApp.";
      return;
    }
    if (!/^55\d{10,11}$/.test(phone) || !text) {
      status.textContent = "Selecione um cliente e escreva a mensagem.";
      return;
    }
    window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(text), "_blank", "noopener,noreferrer");
    status.textContent = "Confira o rascunho no WhatsApp e envie por lá.";
  });
})();
