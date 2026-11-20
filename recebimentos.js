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
  el("versions").replaceChildren();
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
    el("access").hidden = true;
    el("finance").hidden = false;
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
action("backup","click", async () => {
  const data = {version:4, clients:[], campaigns:[], charges:[], settings:{}};
  let found = false;
  for (const [field, key] of Object.entries(records)) {
    const raw = localStorage.getItem(key);
    if (raw !== null) { data[field] = JSON.parse(raw); found = true; }
  }
  if (!found) throw Error("Nenhum registro local neste navegador.");
  try { await api(archive, {conteudo:data}); }
  catch (error) { if (error.status !== 409) throw error; }
  await listVersions();
  el("message").textContent = "Cópia disponível no Supabase.";
});
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
