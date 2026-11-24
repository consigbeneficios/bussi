import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {handle} from "./index.ts";

const env = {
  SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "service", SUPABASE_ANON_KEY: "public",
  BUSSI_BLACKFRIDAY_SENDING_ENABLED: "true", META_GRAPH_VERSION: "v27.0", META_WABA_ID: "123", META_PHONE_NUMBER_ID: "456",
  META_WHATSAPP_TOKEN: "meta", META_APP_SECRET: "app", META_WEBHOOK_VERIFY_TOKEN: "verify",
};
globalThis.Deno = {env: {get: (name) => env[name]}};
const row = {telefone: "5511999990000", nome: "Cliente de teste", original: 10000, desconto: 5000, contrato: "A123", email: "cliente@example.com", documento: "12345678909"};
let delivery;
let admin = false;
let novusStatus = 200;
const novusId = "3c90c3cc-0d44-4b50-8888-8dd25736052a";

const recordedStatuses = [];
const sent = [];
globalThis.fetch = async (url, options) => {
  const endpoint = new URL(url);
  const body = options.body ? JSON.parse(options.body) : undefined;
  if (endpoint.hostname === "api.novuscrm.com.br") {

    assert.equal(options.headers["X-Ambiente"], "12345");
    assert.equal(options.headers["X-Authorization"], "X-Chave-Api ficticia");
    if (endpoint.pathname === "/v1/atendimento") {
      assert.equal(endpoint.searchParams.get("page"), "2");
      assert.equal(endpoint.searchParams.get("search"), "Cliente");
      return Response.json({Items:[{Id:novusId, NomeContato:"Cliente Novus",
        DataDaCriacao:new Date().toISOString(), MensagensNaoLidas:1}],HasNext:true});
    }
    if (endpoint.pathname === "/v1/atendimento/" + novusId + "/mensagens") {
      assert.equal(options.method ?? "GET", "GET");
      return Response.json({Items:[{Id:"entrada", Corpo:"Olá", FromMe:false, Status:2,
        DataDaCriacao:new Date().toISOString()}]});
    }
    assert.equal(endpoint.pathname, "/v1/etiquetas");
    return new Response(null, {status:novusStatus});
  }
  if (endpoint.pathname.endsWith("/bussi_operador_ativo")) return Response.json(admin);
  if (endpoint.pathname.endsWith("/bussi_whatsapp_abrir_fatura")) return Response.json(body.p_hash === delivery.fatura_acesso_hash ? {numero: 42, token: "a".repeat(64)} : null);
  if (endpoint.pathname.endsWith("/bussi_whatsapp_eventos")) {
    recordedStatuses.push(body);
    return new Response(null, {status: 204});
  }
  if (endpoint.pathname.endsWith("/bussi_testes_campanha")) return Response.json([]);
  if (endpoint.pathname.endsWith("/message_templates")) {
    const components = {
      blackconsig: [
        {type:"BODY", text:"Olá {{1}}. Parcela original {{2}}. Parcela com desconto {{3}}."},
        {type:"BUTTONS", buttons:[{type:"QUICK_REPLY", text:"EU QUERO"}]},
      ],
      blackconsigconfe: [
        {type:"BODY", text:"{{customer_name}} {{tel}} {{valor}} {{desconto}}"},
        {type:"BUTTONS", buttons:[{type:"QUICK_REPLY", text:"Gerar fatura"}, {type:"QUICK_REPLY", text:"Falar com atendente"}]},
      ],
      blackdireatendente: [],
    }[endpoint.searchParams.get("name")];
    assert.ok(components);
    return Response.json({data: [{status:"APPROVED", language:"pt_BR", components}]});
  }
  if (endpoint.hostname === "graph.facebook.com") {
    sent.push(body);
    return Response.json({messages: [{id: "wamid." + sent.length}]});
  }
  if (options.method === "POST") {
    if (delivery) return Response.json([]);
    delivery = {...body};
    return Response.json([delivery]);
  }
  if (options.method === "GET") {
    if (endpoint.searchParams.get("telefone") !== "eq." + delivery.telefone ||
        endpoint.searchParams.has("mensagem") && endpoint.searchParams.get("mensagem") !== "eq." + delivery.mensagem) {
      return Response.json([]);
    }
    return Response.json([delivery]);
  }
  if (body.atendente_em && (delivery.atendente_em || !endpoint.searchParams.get("or")?.includes("fatura_mensagem.eq." + delivery.fatura_mensagem) && !endpoint.searchParams.get("or")?.includes(",mensagem.eq." + delivery.mensagem))) return Response.json([]);
  for (const key of ["telefone", "fatura_mensagem", "fatura_status", "fatura_acesso_hash", "atendente_em"]) {
    const filter = endpoint.searchParams.get(key);
    if (filter === "is.null" && delivery[key] != null ||
        filter?.startsWith("eq.") && filter !== "eq." + delivery[key]) return Response.json([]);
  }
  Object.assign(delivery, body);
  return options.headers.get("Prefer") ? Response.json([delivery]) : new Response(null, {status: 204});
};

const endpoint = "https://db.example/functions/v1/bussi-whatsapp";
const request = (body) => new Request(endpoint, {
  method: "POST", headers: {Origin: "https://consigbeneficios.github.io", Authorization: "Bearer user"},
  body: JSON.stringify(body),
});
const launch = {action: "enviar", consentimento: true, ...row};
assert.equal((await handle(request(launch))).status, 403);
assert.equal((await handle(request({action:"novus_status"}))).status, 403);
admin = true;
assert.equal((await handle(request({action:"novus_status"}))).status, 503);
env.NOVUS_ACCOUNT_ID = "12345";
env.NOVUS_API_KEY = "ficticia";
assert.deepEqual(await (await handle(request({action:"novus_status"}))).json(), {status:"conectado"});
const deskList = await (await handle(request({action:"novus_lista",busca:"Cliente",offset:50}))).json();
assert.equal(deskList.conversas[0].id, novusId);
assert.equal(deskList.conversas[0].nao_lidas, 1);
assert.equal(deskList.mais, true);
const chat = await (await handle(request({action:"novus_historico",id:novusId}))).json();
assert.equal(chat.pode_responder, false);
assert.equal(chat.mensagens[0].texto, "Olá");
assert.equal((await handle(request({action:"novus_enviar",id:novusId,texto:"Retorno de teste"}))).status, 400);
novusStatus = 401;
assert.equal((await handle(request({action:"novus_status"}))).status, 503);
env.BUSSI_BLACKFRIDAY_SENDING_ENABLED = "";
assert.equal((await handle(request(launch))).status, 409);
assert.equal(sent.length, 0);
env.BUSSI_BLACKFRIDAY_SENDING_ENABLED = "true";
assert.equal((await handle(request({...launch, consentimento: false}))).status, 400);
assert.equal((await handle(request({...launch, desconto: 4999}))).status, 422);
assert.equal((await (await handle(request(launch))).json()).status, "aceito");
assert.equal((await (await handle(request(launch))).json()).status, "ja_registrado");
assert.equal(sent.length, 1);
assert.equal(sent[0].template.name, "blackconsig");
assert.deepEqual(sent[0].template.components[0].parameters,
  [row.nome, "100,00", "50,00"].map(text => ({type:"text", text})));
assert.equal(sent[0].template.components[1].parameters[0].payload, "BUSSI_BLACKFRIDAY_EU_QUERO");

function message(from, signature, original = "wamid.1", payload = "BUSSI_BLACKFRIDAY_EU_QUERO") {
  const body = JSON.stringify({object: "whatsapp_business_account", entry: [{id: "123", changes: [
    {field: "messages", value: {metadata: {phone_number_id: "456"}, messages: [
      {type: "button", id: payload, from, context: {id: original}, button: {payload}},
    ]}},
  ]}]});
  const hash = createHmac("sha256", signature).update(body).digest("hex");
  return new Request(endpoint, {method: "POST", headers: {"x-hub-signature-256": "sha256=" + hash}, body});
}

assert.equal((await handle(message(row.telefone, "wrong"))).status, 403);
assert.equal((await handle(message("5511999990001", "app"))).status, 200);
assert.equal((await handle(message(row.telefone, "app", "wamid.other"))).status, 200);
assert.equal(sent.length, 1);
assert.equal((await handle(message(row.telefone, "app"))).status, 200);
assert.equal((await handle(message(row.telefone, "app"))).status, 200);
assert.equal(sent.length, 2);
assert.equal(sent[1].to, row.telefone);
assert.equal(sent[1].template.name, "blackconsigconfe");
assert.deepEqual(sent[1].template.components[0].parameters.map(({parameter_name, text}) =>
  [parameter_name, text]), [["customer_name", row.nome], ["tel", row.telefone], ["valor", "100,00"], ["desconto", "50,00"]]);
console.log("Autorização, consentimento, duplicidade, assinatura e dados da fatura verificados.");
const invoice = "BUSSI_GERAR_FATURA";
assert.equal(sent[1].template.components[1].parameters[0].payload, invoice);
assert.equal(delivery.fatura_acesso_hash, undefined);
await handle(message(row.telefone, "app", "wamid.1", invoice));
await handle(message("5511999990001", "app", "wamid.2", invoice));
assert.equal(sent.length, 2);
await handle(message(row.telefone, "app", "wamid.2", invoice));
await handle(message(row.telefone, "app", "wamid.2", invoice));
assert.equal(sent.length, 3);
assert.equal(sent[2].type, "text");
const prefix = "Sua fatura BUSSI: https://consigbeneficios.github.io/bussi/fatura-whatsapp.html#";
assert.ok(sent[2].text.body.startsWith(prefix));
const grant = sent[2].text.body.slice(prefix.length);
assert.match(grant, /^[a-f0-9]{64}$/);
assert.notEqual(grant, delivery.fatura_acesso_hash);
assert.equal((await handle(request({action:"abrir_fatura", token:"b".repeat(64)}))).status, 404);
for (let attempt=0; attempt<2; attempt++) {
  const result=await handle(request({action:"abrir_fatura", token:grant}));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {numero:42, token:"a".repeat(64)});
}
console.log("Resposta rápida, link com token protegido e abertura da mesma fatura verificados.");
const handoff = "BUSSI_FATURA_ATENDENTE";
await handle(message(row.telefone,"app","wamid.0",handoff));
assert.equal(sent.length,3);
await handle(message(row.telefone,"app","wamid.2",handoff));
await handle(message(row.telefone,"app","wamid.2",handoff));
assert.equal(sent.length,4);
assert.equal(sent[3].template.name,"blackdireatendente");
assert.equal(delivery.atendente_aviso_status,"aceito");

const statusPayload = JSON.stringify({object:"whatsapp_business_account",entry:[{id:"123",changes:[{
  field:"messages",value:{metadata:{phone_number_id:"456"},statuses:[{id:"wamid.1",status:"delivered",timestamp:"1795430000"}]},
}]}]});
const signature = createHmac("sha256","app").update(statusPayload).digest("hex");
assert.equal((await handle(new Request(endpoint,{method:"POST",headers:{"x-hub-signature-256":"sha256="+signature},body:statusPayload}))).status,200);
assert.deepEqual(recordedStatuses.map(({mensagem,estado})=>[mensagem,estado]),[["wamid.1","delivered"]]);

const notify = (key) => new Request(endpoint,{method:"POST",headers:{Authorization:"Bearer "+key},
  body:JSON.stringify({action:"pagamento_verificado",numero:42})});
assert.equal((await handle(notify("wrong"))).status,403);
const payment = await handle(notify("service"));
assert.equal(payment.status, 200);
assert.deepEqual(await payment.json(), {status:"confirmacao_whatsapp_manual"});
assert.equal(sent.length, 4);
console.log("Atendimento, eventos de entrega e retenção do aviso final verificados.");
