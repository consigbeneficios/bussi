"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const pane = $("inbox");
  if (!pane) return;
  const nav = document.querySelector('button[data-view="inbox"]');
  const desk = pane.querySelector(".bussi-desk");
  const threadBox = $("bussiDeskThreads");
  const messages = $("bussiDeskMessages");
  const history = pane.querySelector(".bussi-desk-history");
  const input = $("bussiDeskText");
  const send = $("bussiDeskSend");
  const search = $("bussiDeskSearch");
  const more = $("bussiDeskMore");
  const older = $("bussiDeskOlder");
  const note = $("bussiDeskStatus");
  const timestamp = new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"});
  const shortTime = new Intl.DateTimeFormat("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"});
  const states = {reservado:"Processando",aceito:"Aceito pela Meta",sent:"Enviado",delivered:"Entregue",read:"Lido",
    failed:"Falha na entrega",recusado:"Recusado",incerto:"Indeterminado"};
  let api, selected, canReply = false, sending = false, listSeq = 0, historySeq = 0, debounce;
  let contacts = [], chat = [], offset = 0;
  const drafts = new Map();

  function initials(name) {
    const words = name.trim().split(/\s+/);
    return /^[+\d]+$/.test(name) ? name.slice(-2) : words.slice(0,2).map(word => Array.from(word)[0]).join("").toUpperCase();
  }

  function renderContacts() {
    threadBox.replaceChildren();
    for (const contact of contacts) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "bussi-desk-thread";
      item.setAttribute("aria-pressed",String(contact.telefone === selected?.telefone));
      const avatar = document.createElement("span");
      avatar.className = "bussi-desk-avatar";
      avatar.textContent = initials(contact.nome);
      const details = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = contact.nome;
      const text = document.createElement("small");
      text.textContent = (contact.direcao === "saida" ? "Você: " : "") + contact.texto;
      const when = document.createElement("time");
      when.dateTime = contact.ocorrido_em;
      when.textContent = shortTime.format(new Date(contact.ocorrido_em));
      details.append(name,text);
      item.append(avatar,details,when);
      item.addEventListener("click",() => choose(contact));
      threadBox.append(item);
    }
  }

  async function loadContacts(append = false) {
    if (!api) return;
    const seq = ++listSeq;
    const page = append ? offset + 50 : 0;
    try {
      const result = await api({action:"atendimento_lista",busca:search.value.trim(),offset:page});
      if (seq !== listSeq) return;
      offset = page;
      const merged = new Map((append ? contacts : []).map(row => [row.telefone,row]));
      for (const row of result.conversas) merged.set(row.telefone,row);
      contacts = [...merged.values()];
      more.hidden = !result.mais;
      renderContacts();
      $("bussiDeskListStatus").textContent = contacts.length ? "" : "Nenhuma conversa encontrada.";
    } catch (error) {
      if (seq === listSeq) $("bussiDeskListStatus").textContent = error.message;
    }
  }

  function setComposer() {
    input.disabled = !selected || !canReply;
    send.disabled = sending || input.disabled || !input.value.trim();
    $("bussiDeskWindow").classList.toggle("is-open", canReply);
    $("bussiDeskWindow").textContent = selected ? (canReply ? "Atendimento aberto" : "Aguardando nova mensagem") : "";
    if (selected && !canReply && !note.textContent) note.textContent = "A resposta livre fica disponível por 24 horas após a última mensagem do cliente.";
  }

  function renderMessages(scrollToEnd) {
    messages.replaceChildren();
    $("bussiDeskEmpty").hidden = chat.length > 0;
    $("bussiDeskEmpty").textContent = selected ? "Nenhuma mensagem nova foi registrada para este contato." : "Escolha um contato na lista para ler e responder.";
    let previousDate = "";
    const ordered = [...chat].sort((a,b) => Date.parse(a.ocorrido_em)-Date.parse(b.ocorrido_em) || a.id-b.id);
    for (const item of ordered) {
      const stamp = timestamp.format(new Date(item.ocorrido_em));
      const day = stamp.split(",")[0];
      if (day !== previousDate) {
        const divider = document.createElement("p");
        divider.className = "bussi-desk-date";
        divider.textContent = day;
        messages.append(divider);
        previousDate = day;
      }
      const bubble = document.createElement("div");
      bubble.className = "bussi-desk-bubble" + (item.direcao === "saida" ? " outbound" : "");
      const content = document.createElement("p");
      content.textContent = item.texto;
      const footer = document.createElement("small");
      footer.textContent = shortTime.format(new Date(item.ocorrido_em)) + (item.direcao === "saida" && states[item.estado] ? " · " + states[item.estado] : "");
      bubble.append(content,footer);
      messages.append(bubble);
    }
    if (scrollToEnd) history.scrollTop = history.scrollHeight;
  }

  async function loadHistory(before) {
    if (!api || !selected) return;
    const seq = ++historySeq, phone = selected.telefone;
    const previousHeight = history.scrollHeight, previousTop = history.scrollTop;
    const atBottom = previousHeight-previousTop-history.clientHeight < 55;
    try {
      const result = await api({action:"atendimento_historico",telefone:phone,antes:before ?? null});
      if (seq !== historySeq || selected?.telefone !== phone) return;
      const hadMessages = chat.length > 0;
      const windowChanged = canReply !== result.pode_responder;
      canReply = result.pode_responder;
      if (windowChanged) note.textContent = "";
      const byId = new Map(chat.map(m => [m.id,m]));
      for (const item of result.mensagens) byId.set(item.id,item);
      const next = [...byId.values()];
      const changed = next.length !== chat.length || next.some((item,i) => item.estado !== chat[i]?.estado);
      chat = next;
      if (before || !hadMessages) older.hidden = !result.mais;
      if (changed || !hadMessages) renderMessages(!before && (atBottom || !hadMessages));
      if (before) history.scrollTop = previousTop + history.scrollHeight - previousHeight;
      setComposer();
    } catch (error) {
      if (seq === historySeq) note.textContent = error.message;
    }
  }

  function choose(contact) {
    if (!contact?.telefone) return;
    if (selected?.telefone === contact.telefone) {
      desk.classList.add("has-thread");
      void loadHistory();
      return;
    }
    selected = {telefone:contact.telefone,nome:String(contact.nome || contact.telefone)};
    desk.classList.add("has-thread");
    chat = [];
    canReply = false;
    older.hidden = true;
    note.textContent = "";
    input.value = drafts.get(selected.telefone)?.text ?? "";
    $("bussiDeskContact").textContent = selected.nome;
    $("bussiDeskPhone").textContent = selected.telefone;
    renderContacts();
    renderMessages(true);
    setComposer();
    void loadHistory();
  }

  search.addEventListener("input",() => {
    clearTimeout(debounce);
    ++listSeq;
    debounce = setTimeout(() => void loadContacts(),250);
  });
  more.onclick = () => void loadContacts(true);
  older.onclick = () => { if (chat.length) void loadHistory(Math.min(...chat.map(item => item.id))); };
  $("bussiDeskRefresh").onclick = () => {void loadContacts(); void loadHistory();};
  $("bussiDeskBack").onclick = () => {desk.classList.remove("has-thread"); search.focus();};
  nav.addEventListener("click",() => {void loadContacts(); void loadHistory();});
  pane.querySelectorAll("[data-desk-view]").forEach(button => {
    button.addEventListener("click",() => {
      const destination = [...document.querySelectorAll(".nav button[data-view]")]
        .find(item => item.dataset.view === button.dataset.deskView);
      destination?.click();
    });
  });
  input.addEventListener("input",() => {
    if (selected) drafts.set(selected.telefone,{text:input.value,pedido:crypto.randomUUID()});
    setComposer();
  });
  input.addEventListener("keydown",event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !send.disabled) {
      event.preventDefault();
      $("bussiDeskComposer").requestSubmit();
    }
  });
  $("bussiDeskComposer").addEventListener("submit",async event => {
    event.preventDefault();
    if (!selected || !canReply || sending || !api) return;
    const phone = selected.telefone;
    const draft = drafts.get(phone) || {text:input.value,pedido:crypto.randomUUID()};
    if (!draft.text.trim()) return;
    drafts.set(phone,draft);
    sending = true;
    note.textContent = "Enviando resposta…";
    setComposer();
    try {
      const {status} = await api({action:"atendimento_enviar",telefone:phone,texto:draft.text,pedido:draft.pedido});
      if (["aceito","ja_registrado","recusado","incerto"].includes(status) && drafts.get(phone) === draft) {
        drafts.delete(phone);
        if (selected?.telefone === phone) input.value = "";
      }
      if (selected?.telefone === phone) note.textContent = ({aceito:"Resposta aceita pela Meta.",ja_registrado:"Resposta já registrada.",
        recusado:"A Meta recusou a resposta. Confira o histórico.",incerto:"Resultado indeterminado. Confira o histórico."})[status] || "";
      void loadContacts();
      if (selected?.telefone === phone) await loadHistory();
    } catch (error) {
      if (selected?.telefone === phone) note.textContent = error.message;
    } finally {
      sending = false;
      setComposer();
    }
  });
  window.BussiDesk = {setConnection(value){api=value},open(contact){nav.click(); choose(contact);}};
  window.setInterval(() => {
    if (!document.hidden && pane.classList.contains("active")) {
      void loadContacts();
      void loadHistory();
    }
  },10000);
})();
