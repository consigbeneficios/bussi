import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {handle} from "./index.ts";

const env = {
  SUPABASE_URL:"https://db.example", SUPABASE_SERVICE_ROLE_KEY:"service", SUPABASE_ANON_KEY:"anon",
  META_WABA_ID:"123", META_PHONE_NUMBER_ID:"456", META_APP_SECRET:"app", META_WHATSAPP_TOKEN:"meta",
  META_GRAPH_VERSION:"v27.0",
};
globalThis.Deno = {env:{get:name => env[name]}};
const rows = [];
let admin=false, recent=false, sent=0;
const phone="5511999990000";
globalThis.fetch = async (url, options) => {
  const route = new URL(url);
  const body = options.body ? JSON.parse(options.body) : undefined;
  if (route.pathname.endsWith("/bussi_operador_ativo")) return Response.json(admin);
  if (route.pathname.endsWith("/bussi_atendimento_conversas")) return Response.json([]);
  if (route.pathname.endsWith("/bussi_atendimento_historico")) return Response.json(rows);
  if (route.hostname === "graph.facebook.com") {
    assert.equal(body.to,phone);
    assert.equal(body.text.body,"Oi, posso ajudar.");
    sent++;
    return Response.json({messages:[{id:"wamid.outbound"}]});
  }
  if (route.pathname.endsWith("/bussi_atendimento_mensagens")) {
    if (options.method === "GET") return Response.json(recent ? [{ocorrido_em:new Date().toISOString()}] : []);
    if (options.method === "PATCH") return new Response(null,{status:204});
    const duplicate = rows.some(row => body.meta_id && body.meta_id === row.meta_id || body.pedido && body.pedido === row.pedido);
    if (!duplicate) rows.push(body);
    return options.headers.get("Prefer")?.includes("return=representation") ? Response.json(duplicate ? [] : [body]) :
      new Response(null,{status:204});
  }
  throw Error("Endpoint de teste inesperado.");
};

const web = body => new Request("https://db.example/functions/v1/bussi-whatsapp",{method:"POST",
  headers:{Origin:"https://consigbeneficios.github.io",Authorization:"Bearer user"},body:JSON.stringify(body)});
const event = JSON.stringify({object:"whatsapp_business_account",entry:[{id:"123",changes:[{field:"messages",value:{
  metadata:{phone_number_id:"456"},contacts:[{wa_id:phone,profile:{name:"Pessoa Teste"}}],
  messages:[{from:phone,id:"wamid.inbound",type:"text",text:{body:"Olá"},timestamp:String(Math.floor(Date.now()/1000))}],
}}]}]});
const webhook = key => new Request("https://db.example/functions/v1/bussi-whatsapp",{method:"POST",
  headers:{"x-hub-signature-256":"sha256="+createHmac("sha256",key).update(event).digest("hex")},body:event});
const reply = {action:"atendimento_enviar",telefone:phone,texto:"Oi, posso ajudar.",pedido:"c5d8c88b-2b95-4b0d-b337-f822d727af83"};
assert.equal((await handle(web({action:"atendimento_lista"}))).status,403);
assert.equal((await handle(webhook("bad"))).status,403);
assert.equal((await handle(webhook("app"))).status,200);
assert.equal((await handle(webhook("app"))).status,200);
assert.equal(rows.length,1);
assert.equal(rows[0].texto,"Olá");

admin=true;
assert.equal((await handle(web(reply))).status,409);
recent=true;
assert.equal((await (await handle(web({action:"atendimento_historico",telefone:phone}))).json()).pode_responder,true);
assert.equal((await (await handle(web(reply))).json()).status,"aceito");
assert.equal((await (await handle(web(reply))).json()).status,"ja_registrado");
assert.equal(sent,1);
console.log("Autorização, webhook, conversa, janela de 24 horas e resposta sem duplicação verificados.");
