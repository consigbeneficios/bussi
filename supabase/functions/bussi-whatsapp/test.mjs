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
let verifiedReceipt = false, paymentReserved = false;
const recordedStatuses = [];
const sent = [];
globalThis.fetch = async (url, options) => {
  const endpoint = new URL(url);
  const body = options.body ? JSON.parse(options.body) : undefined;
  if (endpoint.pathname.endsWith("/bussi_operador_ativo")) return Response.json(admin);
  if (endpoint.pathname.endsWith("/bussi_whatsapp_abrir_fatura")) return Response.json(body.p_hash === delivery.fatura_acesso_hash ? {numero: 42, token: "a".repeat(64)} : null);
  if (endpoint.pathname.endsWith("/bussi_whatsapp_reservar_encerramento")) {
    if (!verifiedReceipt || paymentReserved) return Response.json(null);
    paymentReserved = true;
    return Response.json(delivery.telefone);
  }
  if (endpoint.pathname.endsWith("/bussi_whatsapp_registrar_encerramento")) return new Response(null, {status: 204});
  if (endpoint.pathname.endsWith("/bussi_whatsapp_eventos")) {
    recordedStatuses.push(body);
    return new Response(null, {status: 204});
  }
  if (endpoint.pathname.endsWith("/bussi_testes_campanha")) return Response.json([]);
  if (endpoint.pathname.endsWith("/message_templates")) {
    return Response.json({data: [{status: "APPROVED", language: "pt_BR", components: [
      {type: "BUTTONS", buttons: endpoint.searchParams.get("name") === "fatura_bussi"
        ? [{type: "URL", url: "https://consigbeneficios.github.io/bussi/fatura-whatsapp.html#{{1}}"}, {type:"QUICK_REPLY", text:"Falar com atendente"}]
        : [{type: "QUICK_REPLY", text: "EU QUERO"}]},
    ]}]});
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
admin = true;
env.BUSSI_BLACKFRIDAY_SENDING_ENABLED = "";
assert.equal((await handle(request(launch))).status, 409);
assert.equal(sent.length, 0);
env.BUSSI_BLACKFRIDAY_SENDING_ENABLED = "true";
assert.equal((await handle(request({...launch, consentimento: false}))).status, 400);
assert.equal((await handle(request({...launch, desconto: 4999}))).status, 422);
assert.equal((await (await handle(request(launch))).json()).status, "aceito");
assert.equal((await (await handle(request(launch))).json()).status, "ja_registrado");
assert.equal(sent.length, 1);
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
assert.equal(sent[1].template.name, "fatura_bussi");
assert.deepEqual(sent[1].template.components[0].parameters.map(({parameter_name, text}) =>
  [parameter_name, text]), [["customer_name", row.nome], ["tel", row.telefone], ["valor", "100,00"], ["desconto", "50,00"]]);
console.log("Autorização, consentimento, duplicidade, assinatura e dados da fatura verificados.");
const grant = sent[1].template.components[1].parameters[0].text;
assert.match(grant, /^[a-f0-9]{64}$/);
assert.notEqual(grant, delivery.fatura_acesso_hash);
assert.equal((await handle(request({action:"abrir_fatura", token:"b".repeat(64)}))).status, 404);
for (let attempt=0; attempt<2; attempt++) {
  const result=await handle(request({action:"abrir_fatura", token:grant}));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {numero:42, token:"a".repeat(64)});
}
console.log("Botão de URL, token protegido e abertura da mesma fatura verificados.");
const handoff = "BUSSI_FATURA_ATENDENTE";
await handle(message(row.telefone,"app","wamid.0",handoff));
assert.equal(sent.length,2);
await handle(message(row.telefone,"app","wamid.2",handoff));
await handle(message(row.telefone,"app","wamid.2",handoff));
assert.equal(sent.length,3);
assert.equal(sent[2].text.body,"Estamos transferindo para um de nossos atendentes. Aguarde, por favor.");
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
await handle(notify("service"));
assert.equal(sent.length,3);
verifiedReceipt=true;
await handle(notify("service"));
await handle(notify("service"));
assert.equal(sent.length,4);
assert.equal(sent[3].template.name,"pagamento_recebido_bussi");
console.log("Atendimento manual, eventos de entrega e encerramento após comprovante verificados.");