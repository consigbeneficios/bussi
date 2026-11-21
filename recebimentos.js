"use strict";
const base = "https://yzhjtqwpmxhigrijiuze.supabase.co";
const key = "sb_publishable_fimYRn4YWFbiwYiADnrQvg_mACDleaU";
const el = id => document.getElementById(id);
const brl = new Intl.NumberFormat("pt-BR", {style:"currency", currency:"BRL"});
let session, factor, working = false;

async function api(path, body, method = "POST") {
  const headers = {apikey:key, "Content-Type":"application/json"};
  if (session) headers.Authorization = "Bearer " + session;
  const response = await fetch(base + path, {method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache:"no-store", redirect:"error", signal:AbortSignal.timeout(35000)});
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.erro || (
    response.status === 401 || response.status === 403 ? "Acesso recusado. Verifique suas credenciais e o segundo fator." : "Não foi possível concluir a solicitação.")), {status:response.status});
  return data;
}
function reset() {
  session = factor = null;
  clearTimeout(archiveTimer);lastArchive=null;
  el("versions").replaceChildren();
  el("invoices").replaceChildren(); el("created").replaceChildren();el("issue").reset();el("preview").textContent="";lastNumber=null;draftRequest=null;
  for (const id of ["email", "password", "code", "transaction"]) el(id).value = "";
  for (const id of ["summary", "result", "message"]) el(id).textContent = "";
  for (const id of ["verify","finance","exit"]) el(id).hidden = true;
  el("access").hidden = el("login").hidden = false;
}
async function endSession() {
  try { if (session) await api("/auth/v1/logout?scope=local", {}); }
  finally { reset(); }
}
function action(id, event, task) {
  el(id).addEventListener(event, async e => {
    e.preventDefault();
    if (working) return;
    working = true;
    document.querySelectorAll("button").forEach(b => b.disabled = true);
    el("message").textContent = "";
    try { await task(); } catch (error) { el("message").textContent = error.message; }
    finally { working = false; document.querySelectorAll("button").forEach(b => b.disabled = false); }
  });
}
async function refresh() {
  el("summary").textContent = "";
  const data = await api("/rest/v1/rpc/bussi_resumo_recebimentos", {});
  if (!data || !Number.isSafeInteger(data.quantidade) || !/^\d+$/.test(data.total_centavos)) throw Error("Resumo indisponível.");
  el("summary").textContent = data.quantidade + " pagamento(s) · " + brl.format(Number(data.total_centavos)/100);
}
action("login", "submit", async () => {
  if (!window.isSecureContext) throw Error("Abra o portal por HTTPS.");
  try {
    const data = await api("/auth/v1/token?grant_type=password", {email:el("email").value.trim(), password:el("password").value});
    session = data.access_token;
    const user = await api("/auth/v1/user", undefined, "GET");
    factor = user.factors?.find(f => f.factor_type === "totp" && f.status === "verified")?.id;
    if (!factor) { await endSession(); throw Error("A conta precisa de um autenticador verificado."); }
    el("login").hidden = true;
    el("verify").hidden = el("exit").hidden = false;
    el("code").focus();
  } finally { el("password").value = ""; }
});
action("verify", "submit", async () => {
  const path = "/auth/v1/factors/" + encodeURIComponent(factor);
  try {
    const challenge = await api(path + "/challenge", {});
    const data = await api(path + "/verify", {challenge_id:challenge.id, code:el("code").value});
    session = data.access_token;
    await refresh();
    await listVersions();
    await historyPage();
    el("access").hidden = true;
    el("finance").hidden = false;
    if (location.hash === "#teste-pix-7") prepararTestePix();
    scheduleArchive();
  } finally { el("code").value = ""; }
});
action("lookup", "submit", async () => {
  el("result").textContent = "";
  const data = await api("/functions/v1/nitro-consulta", {id:el("transaction").value.trim()});
  el("result").textContent = data.situacao + " · " + brl.format(Number(data.valor));
});
action("refresh", "click", refresh);
action("exit", "click", endSession);
window.addEventListener("pageshow", e => { if (e.persisted) reset(); });
const archive = "/rest/v1/bussi_portal_arquivos";
const records = {clients:"bussi.clients.v1", campaigns:"bussi.campaigns.v1", charges:"bussi.charges.v1",
  settings:"bussi.settings.v1", events:"bussi.events.v1", daily:"bussi.events.daily.v1",
  activity:"bussi.events.activity.v1", invoiceNext:"bussi.invoice.next.v1", chargeDraft:"bussi.charge.draft.v1"};
async function listVersions() {
  const versions = await api(archive + "?select=id,criado_em&order=criado_em.desc&limit=100", undefined, "GET");
  el("versions").replaceChildren(...versions.map(v => new Option(new Date(v.criado_em).toLocaleString("pt-BR"), v.id)));
}
async function saveArchive(automatic = false) {
  const data = {version:4, clients:[], campaigns:[], charges:[], settings:{}};
  let found = false;
  for (const [field, key] of Object.entries(records)) {
    const raw = localStorage.getItem(key);
    if (raw !== null) { data[field] = JSON.parse(raw); found = true; }
  }
  if (!found && automatic) return;
  if (!found) throw Error("Nenhum registro local neste navegador.");
  const serialized = JSON.stringify(data);
  if (serialized === lastArchive && automatic) return;
  try { await api(archive, {conteudo:data}); }
  catch (error) { if (error.status !== 409) throw error; }
  lastArchive=serialized;
  await listVersions();
  el("message").textContent = "Cópia salva no Supabase às "+new Date().toLocaleTimeString("pt-BR")+".";
}
action("backup","click",()=>saveArchive());
action("download","click", async () => {
  const id = el("versions").value;
  if (!id) throw Error("Selecione uma cópia salva.");
  const rows = await api(archive + "?select=conteudo&id=eq." + encodeURIComponent(id), undefined, "GET");
  if (!rows?.[0]?.conteudo) throw Error("Cópia indisponível.");
  const url = URL.createObjectURL(new Blob([JSON.stringify(rows[0].conteudo)], {type:"application/json"}));
  const link = document.createElement("a");
  link.href = url; link.download = "BUSSI_BACKUP_" + id + ".json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let lastNumber=null, draftRequest=null;
function amountInCents() {
  const s=el("amount").value.trim();
  if(!/^\d{1,7}([.,]\d{1,2})?$/.test(s))return null;
  const [whole,decimal=""]=s.replace(",",".").split(".");
  const cents=Number(whole)*100+Number(decimal.padEnd(2,"0"));
  return cents>=2 && cents<=999999999 ? cents : null;
}
el("issue").addEventListener("input",()=>{
  draftRequest=null;el("created").replaceChildren();
  const cents=amountInCents();
  el("preview").textContent=cents?"Com 50% de desconto, o cliente paga "+brl.format(Math.ceil(cents/2)/100)+".":"";
});
function prepararTestePix() {
  el("item").value = "Teste interno de pagamento Pix do BUSSI";
  el("amount").value = "14,00";
  el("issue").dispatchEvent(new Event("input"));
}
el("prepareTest").addEventListener("click", prepararTestePix);
function invoiceLink(row) {
  const url=new URL("https://pay.consigbeneficio.com.br/");
  url.pathname="/fatura"+String(row.numero).padStart(4,"0");url.hash=row.token;
  const a=document.createElement("a");a.href=url.href;a.target="_blank";a.rel="noopener noreferrer";
  a.textContent="Abrir fatura "+String(row.numero).padStart(4,"0");
  return a;
}
async function historyPage(before=null) {
  const rows=await api("/rest/v1/rpc/bussi_historico_faturas",{p_antes:before});
  if(!before)el("invoices").replaceChildren();
  for(const row of rows){
    const li=document.createElement("li");
    li.append(invoiceLink(row),document.createTextNode(" · "+brl.format(row.valor_centavos/100)+" · "+row.situacao));
    el("invoices").append(li);
  }
  lastNumber=rows.at(-1)?.numero??null;el("more").hidden=rows.length!==50;
  if(!before && !rows.length)el("invoices").textContent="Nenhuma fatura emitida.";
}
action("more","click",()=>historyPage(lastNumber));
action("issue","submit",async()=>{
  const cents=amountInCents(), item=el("item").value.trim();
  if(!cents || item.length<8)throw Error("Informe a descrição do serviço do cartão e o valor original.");
  draftRequest??=crypto.randomUUID();
  const row=await api("/rest/v1/rpc/bussi_emitir_link",{p_descricao:item,p_original:cents,p_pedido:draftRequest});
  el("created").replaceChildren(invoiceLink(row));el("issue").reset();el("preview").textContent="";
  draftRequest=null;await historyPage();
});

let archiveTimer, lastArchive=null;
function scheduleArchive() {
  clearTimeout(archiveTimer);
  if (!session || el("finance").hidden) return;
  archiveTimer=setTimeout(async()=>{
    if (!session || el("finance").hidden) return;
    if (working) {scheduleArchive();return;}
    try {await saveArchive(true);}
    catch {el("message").textContent="A cópia automática está pendente. Use Salvar cópia no Supabase para tentar novamente.";}
  },1200);
}
window.addEventListener("storage",event=>{
  if (!event.key || Object.values(records).includes(event.key)) scheduleArchive();
});
