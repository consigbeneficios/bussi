const env = (key: string) => Deno.env.get(key) || "";
const origin = "https://consigbeneficios.github.io";
const campaign = "blackfriday-2026";
const table = "/rest/v1/bussi_whatsapp_entregas";
const campaignReply = "BUSSI_BLACKFRIDAY_EU_QUERO";
const language = {code: "pt_BR"};

function api(path: string, token: string, method = "GET", body?: unknown, prefer?: string) {
  const headers = new Headers({
    apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  });
  // User RPCs use the project's public key and the user's session token.
  if (token !== env("SUPABASE_SERVICE_ROLE_KEY")) headers.set("apikey", env("SUPABASE_ANON_KEY"));
  if (prefer) headers.set("Prefer", prefer);
  return fetch(env("SUPABASE_URL") + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error", signal: AbortSignal.timeout(8000),
  });
}

async function db(query: string, method = "GET", body?: unknown, prefer?: string) {
  const response = await api(table + query, env("SUPABASE_SERVICE_ROLE_KEY"), method, body, prefer);
  if (!response.ok) throw new Error("Falha ao registrar o envio no BUSSI.");
  return response.status === 204 ? null : await response.json();
}

function graph(path: string, body?: unknown) {
  return fetch("https://graph.facebook.com/" + env("META_GRAPH_VERSION") + "/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {Authorization: "Bearer " + env("META_WHATSAPP_TOKEN"), "Content-Type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error", signal: AbortSignal.timeout(8000),
  });
}

async function send(to: string, name: string, components: unknown[]) {
  try {
    const response = await graph(env("META_PHONE_NUMBER_ID") + "/messages", {
      messaging_product: "whatsapp", to, type: "template", template: {name, language, components},
    });
    const data = await response.json().catch(() => null);
    const id = data?.messages?.[0]?.id;
    if (response.ok && typeof id === "string") return {state: "aceito", id};
    return {state: response.status >= 400 && response.status < 500 ? "recusado" : "incerto", id: null};
  } catch {
    return {state: "incerto", id: null};
  }
}

function money(value: number) {
  return (value / 100).toLocaleString("pt-BR", {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

async function approvedTemplates() {
  const result = await Promise.all(["blackfriday", "fatura"].map(async (name) => {
    const query = new URLSearchParams({name, fields: "name,status,language,components"});
    const response = await graph(env("META_WABA_ID") + "/message_templates?" + query);
    if (!response.ok) throw new Error("Não foi possível consultar os modelos na Meta.");
    const data = await response.json();
    return data.data?.find((item: {language: string; status: string}) =>
      item.language === language.code && item.status === "APPROVED");
  }));
  if (!result[0] || !result[1]) throw new Error("Os modelos blackfriday e fatura precisam estar aprovados em português do Brasil.");
  return result[0].components?.find((component: {type: string}) => component.type === "BUTTONS")
    ?.buttons?.findIndex((button: {type: string; text: string}) =>
      button.type === "QUICK_REPLY" && button.text.trim().toUpperCase() === "EU QUERO") ?? -1;
}

async function handleReply(message: Record<string, any>) {
  const type = message.type;
  const reply = type === "button" ? message.button : message.text;
  if (type === "button" ? reply?.payload !== campaignReply :
      (type !== "text" || reply?.body?.trim().toUpperCase() !== "EU QUERO")) return;
  if (typeof message.from !== "string" || !/^55\d{10,11}$/.test(message.from) ||
      typeof message.id !== "string" || !message.id) return;

  const query = new URLSearchParams({
    campanha: "eq." + campaign, telefone: "eq." + message.from, oferta_status: "eq.aceito",
    criada_em: "gte." + new Date(Date.now() - 14 * 86400000).toISOString(),
  });
  if (type === "button" || message.context?.id) {
    if (typeof message.context?.id !== "string") return;
    query.set("mensagem", "eq." + message.context.id);
  }
  const [row] = await db("?" + query);
  if (!row || row.resposta_id) return;
  query.set("resposta_id", "is.null");
  const [claimed] = await db("?" + query, "PATCH",
    {resposta_id: message.id, fatura_status: "reservado"}, "return=representation");
  if (!claimed) return;

  const fields = {
    customer_name: row.nome, tel: row.telefone, valor: money(row.original), desconto: money(row.desconto),
  };
  const result = await send(row.telefone, "fatura", [{
    type: "body", parameters: Object.entries(fields).map(([parameter_name, text]) => ({type: "text", parameter_name, text})),
  }]);
  query.set("resposta_id", "eq." + message.id);
  await db("?" + query, "PATCH", {fatura_status: result.state});
}

async function validSignature(raw: ArrayBuffer, signature: string | null) {
  if (!signature || !/^sha256=[0-9a-f]{64}$/.test(signature) || !env("META_APP_SECRET")) return false;
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (value) => parseInt(value, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("META_APP_SECRET")),
    {name: "HMAC", hash: "SHA-256"}, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, bytes, raw);
}

export async function handle(request: Request) {
  const url = new URL(request.url);
  const headers = {
    "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store",
  };
  const json = (status: number, body: object) => new Response(JSON.stringify(body), {status, headers});
  if (request.method === "OPTIONS") return new Response(null, {status: 204, headers});
  if (request.method === "GET") {
    const token = env("META_WEBHOOK_VERIFY_TOKEN");
    const challenge = url.searchParams.get("hub.challenge");
    return token && challenge && url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === token ? new Response(challenge) : json(403, {});
  }
  if (request.method !== "POST") return json(405, {});
  try {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 262144) return json(413, {});
    if (request.headers.has("x-hub-signature-256")) {
      if (!await validSignature(raw, request.headers.get("x-hub-signature-256"))) return json(403, {});
      const event = JSON.parse(new TextDecoder().decode(raw));
      if (event.object !== "whatsapp_business_account") return json(200, {});
      for (const entry of event.entry ?? []) {
        if (entry.id !== env("META_WABA_ID")) continue;
        for (const change of entry.changes ?? []) {
          if (change.field !== "messages" || change.value?.metadata?.phone_number_id !== env("META_PHONE_NUMBER_ID")) continue;
          for (const message of change.value.messages ?? []) await handleReply(message);
        }
      }
      return json(200, {});
    }

    if (request.headers.get("Origin") !== origin) return json(403, {});
    const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return json(401, {});
    const access = await api("/rest/v1/rpc/bussi_operador_ativo", token, "POST", {});
    if (!access.ok || await access.json() !== true) return json(403, {erro: "Entre com a sessão administrativa do BUSSI."});
    const body = JSON.parse(new TextDecoder().decode(raw));
    if (!["META_GRAPH_VERSION", "META_WABA_ID", "META_PHONE_NUMBER_ID", "META_WHATSAPP_TOKEN", "META_APP_SECRET",
      "META_WEBHOOK_VERIFY_TOKEN"].every((key) => env(key))) return json(503, {erro: "Conexão do WhatsApp ainda não configurada no servidor."});

    if (body.action === "status") {
      await approvedTemplates();
      return json(200, {status: "pronto"});
    }
    if (body.action !== "enviar" || body.consentimento !== true) return json(400, {});
    const {telefone, nome, original, desconto} = body;
    if (typeof telefone !== "string" || !/^55\d{10,11}$/.test(telefone) ||
        typeof nome !== "string" || !/^[^\r\n\t]{2,120}$/.test(nome) ||
        !Number.isInteger(original) || original <= 0 || original > 999999999 ||
        !Number.isInteger(desconto) || desconto <= 0 || desconto !== Math.ceil(original / 2)) return json(422, {erro: "Cadastro ou valores inválidos."});
    const button = await approvedTemplates();
    const [reserved] = await db("?on_conflict=campanha,telefone", "POST",
      {campanha: campaign, telefone, nome, original, desconto}, "resolution=ignore-duplicates,return=representation");
    if (!reserved) return json(200, {status: "ja_registrado"});

    const components: unknown[] = [{type: "body", parameters: [nome, money(original), money(desconto)]
      .map((text) => ({type: "text", text}))}];
    if (button >= 0) components.push({type: "button", sub_type: "quick_reply", index: String(button),
      parameters: [{type: "payload", payload: campaignReply}]});
    const result = await send(telefone, "blackfriday", components);
    const filter = new URLSearchParams({campanha: "eq." + campaign, telefone: "eq." + telefone});
    await db("?" + filter, "PATCH", {oferta_status: result.state, mensagem: result.id});
    return json(200, {status: result.state});
  } catch (error) {
    return json(503, {erro: error instanceof Error && /modelos/.test(error.message) ? error.message : "Integração indisponível. Confira o histórico antes de repetir."});
  }
}

if (import.meta.main) Deno.serve(handle);
