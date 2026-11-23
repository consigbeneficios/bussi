"use strict";
(() => {
  const crm = document.getElementById("crm");
  if (!crm) return;
  const $ = id => document.getElementById(id);
  const tabs = [...crm.querySelectorAll("[data-crm-stage]")];
  const storage = "bussi.crm.test-clients.v1";
  const testPhone = "11959322028";
  const labels = {em_acao:"Clientes em ação",fatura:"Fatura gerada",pago:"Pagamento confirmado",finalizado:"Finalizados"};
  const date = new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"});
  const money = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
  let current = "reais", byPhone = new Map(), loader, fixturesLoader, busy = false, stageError = "", editing = "";
  let fixtures = [];
  let records = [];
  try {
    const saved = JSON.parse(localStorage.getItem(storage) || "[]");
    if (Array.isArray(saved)) records = saved.filter(row => typeof row?.id === "string" &&
      typeof row.nome === "string" && typeof row.telefone === "string" &&
      Number.isSafeInteger(row.original) && Number.isSafeInteger(row.desconto));
  } catch { /* Test storage can be unavailable in a private session. */ }

  function phoneOf(value) {
    const digits = String(value ?? "").replace(/\D/g,"");
    return /^\d{10,11}$/.test(digits) ? "55" + digits : /^55\d{10,11}$/.test(digits) ? digits : "";
  }

  function cents(value) {
    const raw = String(value).trim().replace(/\s/g,"").replace(/^R\$/,"");
    const normalized = raw.includes(",") ? raw.replace(/\./g,"").replace(",",".") : raw;
    return /^\d{1,7}(?:\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized)*100) : null;
  }

  function cells(body, values) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value;
    return row;
  }

  function button(label,action) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "btn sm ghost";
    el.textContent = label;
    el.addEventListener("click",action);
    return el;
  }

  function openCampaign(record, test = false) {
    if (!test && window.BussiDesk) {
      window.BussiDesk.open(record);
      return;
    }
    document.querySelector('button[data-view="campaigns"]')?.click();
    document.dispatchEvent(new CustomEvent(test ? "bussi:open-test-client" : "bussi:open-real-client", {detail:record}));
    document.querySelector(".bussi-inbox")?.scrollIntoView({block:"start"});
  }

  function renderRows() {
    for (const row of crm.querySelectorAll("[data-crm-phone]")) {
      const stage = byPhone.get(phoneOf(row.dataset.crmPhone));
      row.classList.toggle("bussi-crm-sent",stage?.disparado === true);
      row.querySelector("[data-crm-stage-cell]").textContent = stage ? labels[stage.etapa] : "Na base";
    }
  }

  function renderStages() {
    renderRows();
    if (!labels[current]) return;
    const body = $("bussiCrmStageRows");
    body.replaceChildren();
    $("bussiCrmStageTitle").textContent = labels[current];
    const rows = [...byPhone.values()].filter(row => row.etapa === current)
      .sort((a,b) => Date.parse(b.atualizado_em) - Date.parse(a.atualizado_em));
    for (const item of rows) {
      const when = item.atualizado_em ? date.format(new Date(item.atualizado_em)) : "—";
      cells(body,[item.nome,item.telefone,labels[item.etapa],when]).insertCell()
        .append(button("Abrir conversa",() => openCampaign(item)));
    }
    $("bussiCrmStageStatus").textContent = stageError || (busy ? "Atualizando etapas…" :
      rows.length ? rows.length + " nesta etapa." : "Nenhum cliente nesta etapa.");
  }

  async function refreshStages() {
    if (!loader || busy) return;
    busy = true;
    stageError = "";
    $("bussiCrmRefresh").disabled = true;
    renderStages();
    try {
      const {etapas} = await loader();
      byPhone = new Map(etapas.filter(row => labels[row.etapa] && phoneOf(row.telefone) && !isTestStage(row)).map(row => [row.telefone,row]));
    } catch (error) {
      stageError = error.message;
    } finally {
      busy = false;
      $("bussiCrmRefresh").disabled = false;
      renderStages();
    }
  }

  function allTests() { return [...fixtures,...records]; }

  function isTestRecord(row) {
    const contract = String(row?.contract ?? "").trim().toUpperCase();
    return !!contract && fixtures.some(item => item.contrato === contract);
  }

  function isTestStage(row) {
    return fixtures.some(item => phoneOf(item.telefone) === row.telefone &&
      item.nome.normalize("NFC").toLowerCase() === String(row.nome).normalize("NFC").toLowerCase());
  }

  function renderTests() {
    const body = $("bussiTestRows");
    body.replaceChildren();
    if (!allTests().length) {
      cells(body,["Nenhum cliente de teste. Adicione um cadastro para simular."]).cells[0].colSpan = 5;
      return;
    }
    for (const record of allTests()) {
      const actions = cells(body,[record.nome,record.telefone,money.format(record.original/100),money.format(record.desconto/100)]).insertCell();
      actions.className = "bussi-crm-row-actions";
      actions.append(button("Simular", () => openCampaign(record,true)));
      if (record.contrato) continue;
      actions.append(button("Editar", () => editTest(record)),
        button("Remover", () => {
          if (!window.confirm("Remover o cadastro de teste de " + record.nome + "?")) return;
          if (saveTests(records.filter(item => item.id !== record.id)) && editing === record.id) resetTest();
        }));
    }
  }

  function saveTests(next) {
    try { localStorage.setItem(storage,JSON.stringify(next)); }
    catch {
      $("bussiTestStatus").textContent = "Não foi possível salvar o cadastro de teste.";
      return false;
    }
    records = next;
    renderTests();
    document.dispatchEvent(new CustomEvent("bussi:campaign-examples",{detail:allTests()}));
    $("bussiTestStatus").textContent = "Base de teste salva neste navegador.";
    return true;
  }

  function editTest(record) {
    editing = record.id;
    $("bussiTestName").value = record.nome;
    $("bussiTestPhone").value = record.telefone;
    $("bussiTestOriginal").value = (record.original/100).toFixed(2).replace(".",",");
    $("bussiTestDiscount").value = (record.desconto/100).toFixed(2).replace(".",",");
    $("bussiTestSave").textContent = "Salvar teste";
    $("bussiTestClear").hidden = false;
    $("bussiTestName").focus();
  }

  function resetTest() {
    editing = "";
    $("bussiTestForm").reset();
    $("bussiTestPhone").value = testPhone;
    $("bussiTestSave").textContent = "Adicionar teste";
    $("bussiTestClear").hidden = true;
  }

  $("bussiTestClear").onclick = resetTest;
  $("bussiTestForm").addEventListener("submit",event => {
    event.preventDefault();
    const row = {
      id:editing || crypto.randomUUID(),nome:$("bussiTestName").value.trim(),
      telefone:phoneOf($("bussiTestPhone").value),original:cents($("bussiTestOriginal").value),
      desconto:cents($("bussiTestDiscount").value),
    };
    if (!row.nome || !row.telefone || !row.original || !row.desconto || row.desconto > row.original) {
      $("bussiTestStatus").textContent = "Confira nome, telefone e valores da parcela.";
      return;
    }
    if (saveTests(editing ? records.map(item => item.id === editing ? row : item) : [...records,row])) resetTest();
  });

  function activate(tab) {
    for (const item of tabs) {
      item.tabIndex = item === tab ? 0 : -1;
      item.setAttribute("aria-selected",String(item === tab));
    }
    current = tab.dataset.crmStage;
    $("bussiCrmReal").hidden = current !== "reais";
    $("bussiCrmTests").hidden = current !== "teste";
    $("bussiCrmStages").hidden = !labels[current];
    if (!labels[current]) return;
    $("bussiCrmStages").setAttribute("aria-labelledby",tab.id);
    renderStages();
    void refreshStages();
  }

  tabs.forEach((tab,index) => {
    tab.addEventListener("click",() => activate(tab));
    tab.addEventListener("keydown",event => {
      const target = ({ArrowLeft:(index-1+tabs.length)%tabs.length,ArrowRight:(index+1)%tabs.length,Home:0,End:tabs.length-1})[event.key];
      if (target === undefined) return;
      event.preventDefault();
      tabs[target].focus();
      activate(tabs[target]);
    });
  });

  $("bussiCrmRefresh").onclick = () => void refreshStages();
  crm.addEventListener("click",event => {
    const target = event.target.closest("[data-crm-conversation]");
    if (!target) return;
    const telefone = phoneOf(target.dataset.crmConversation);
    if (telefone) openCampaign(byPhone.get(telefone) || {nome:target.closest("tr").cells[0].textContent.trim(),telefone});
  });
  document.querySelector('button[data-view="crm"]')?.addEventListener("click",() => void refreshStages());
  async function refreshFixtures() {
    if (!fixturesLoader) return;
    try {
      const {clientes} = await fixturesLoader();
      fixtures = clientes;
      renderTests();
      renderAll();
      document.dispatchEvent(new CustomEvent("bussi:campaign-examples",{detail:allTests()}));
    } catch {
      $("bussiTestStatus").textContent = "Não foi possível carregar a base de testes compartilhada.";
    }
  }
  window.BussiClientStages = {setLoader(value){loader=value},setFixturesLoader(value){fixturesLoader=value},
    refreshRows:renderRows,refreshStages,refreshFixtures,isTestRecord,getTests:allTests};
  renderTests();
  window.setInterval(() => {
    if (!document.hidden && crm.classList.contains("active")) void refreshStages();
  }, 30000);
})();
