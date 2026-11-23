const env = (key: string) => Deno.env.get(key) || "";
const origin = "https://consigbeneficios.github.io";
const campaign = "blackfriday-2026";
const table = "/rest/v1/bussi_whatsapp_entregas";
const campaignReply = "BUSSI_BLACKFRIDAY_EU_QUERO";
const handoffReply = "BUSSI_FATURA_ATENDENTE";
const language = {code: "pt_BR"};
const invoiceTemplate = "fatura_bussi";
const paymentTemplate = "pagamento_recebido_bussi";
const invoiceButtonUrl = origin + "/bussi/fatura-whatsapp.html#{{1}}";

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

async function sendMessage(to: string, message: Record<string, unknown>) {
  try {
    const response = await graph(env("META_PHONE_NUMBER_ID") + "/messages", {
      messaging_product: "whatsapp", to, ...message,
    });
    const data = await response.json().catch(() => null);
    const id = data?.messages?.[0]?.id;
    if (response.ok && typeof id === "string") return {state: "aceito", id};
    return {state: response.status >= 400 && response.status < 500 ? "recusado" : "incerto", id: null};
  } catch {
    return {state: "incerto", id: null};
  }
}

function sendTemplate(to: string, name: string, components: unknown[]) {
  return sendMessage(to, {type: "template", template: {name, language, ...(components.length ? {components} : {})}});
}

function money(value: number) {
  return (value / 100).toLocaleString("pt-BR", {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

async function approvedTemplates() {
  const result = await Promise.all(["blackfriday", invoiceTemplate, paymentTemplate].map(async (name) => {
    const query = new URLSearchParams({name, fields: "name,status,language,components"});
    const account = env("META_MESSAGING_ACCOUNT_ID") || env("META_WABA_ID");
    const response = await graph(account + "/message_templates?" + query);
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = data?.error?.code;
      const subcode = data?.error?.error_subcode;
      const ref = [code, subcode].filter(Number.isInteger).join("/");
      throw new Error("Não foi possível consultar os modelos na Meta (HTTP " + response.status + (ref ? ", código " + ref : "") + ").");
    }
    return data?.data?.find((item: {language: string; status: string}) =>
      item.language === language.code && item.status === "APPROVED");
  }));
  if (!result[0] || !result[1] || !result[2]) throw new Error("Os modelos blackfriday, fatura_bussi e pagamento_recebido_bussi precisam estar aprovados em português do Brasil.");
  const invoiceButton = result[1].components?.find((component: {type: string}) => component.type === "BUTTONS")
    ?.buttons?.findIndex((button: {type: string; url: string}) =>
      button.type === "URL" && button.url === invoiceButtonUrl) ?? -1;
  if (invoiceButton < 0) throw new Error("O modelo fatura_bussi precisa do botão de URL do BUSSI.");
  const offerButton = result[0].components?.find((component: {type: string}) => component.type === "BUTTONS")
    ?.buttons?.findIndex((button: {type: string; text: string}) =>
      button.type === "QUICK_REPLY" && button.text.trim().toUpperCase() === "EU QUERO") ?? -1;
  const handoffButton = result[1].components?.find((component: {type: string}) => component.type === "BUTTONS")
    ?.buttons?.findIndex((button: {type: string; text: string}) =>
      button.type === "QUICK_REPLY" && button.text.trim().toLowerCase() === "falar com atendente") ?? -1;
  if (handoffButton < 0) throw new Error("O modelo fatura_bussi precisa do botão Falar com atendente.");
  const offerComponents = result[0].components ?? [];
  const offerImage = offerComponents.some((part: {type: string; format?: string}) => part.type === "HEADER" && part.format === "IMAGE");
  const offerText = offerComponents.find((part: {type: string}) => part.type === "BODY")?.text ?? "";
  return {offerButton, invoiceButton, handoffButton, offerImage, offerText};
}

async function handleHandoff(message: Record<string, any>) {
  if (typeof message.context?.id !== "string" || typeof message.id !== "string" ||
      typeof message.from !== "string" || !/^55\d{10,11}$/.test(message.from)) return;
  const query = new URLSearchParams({
    campanha: "eq." + campaign, telefone: "eq." + message.from,
    fatura_mensagem: "eq." + message.context.id, atendente_em: "is.null", encerramento_status: "is.null",
  });
  const [claimed] = await db("?" + query, "PATCH", {
    atendente_em: new Date().toISOString(), atendente_resposta_id: message.id,
    atendente_aviso_status: "reservado",
  }, "return=representation");
  if (!claimed) return;
  const result = await sendMessage(message.from, {
    type: "text", text: {body: "Estamos transferindo para um de nossos atendentes. Aguarde, por favor."},
  });
  query.delete("atendente_em");
  query.set("atendente_resposta_id", "eq." + message.id);
  await db("?" + query, "PATCH", {atendente_aviso_status: result.state});
}

async function handleReply(message: Record<string, any>) {
  if (message.type === "button" && message.button?.payload === handoffReply) {
    return handleHandoff(message);
  }
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
  if (!row || row.resposta_id || !row.pagador) return;
  const {invoiceButton, handoffButton} = await approvedTemplates();
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  query.set("resposta_id", "is.null");
  const [claimed] = await db("?" + query, "PATCH", {
    resposta_id: message.id, resposta_em: new Date().toISOString(), fatura_status: "reservado", fatura_acesso_hash: await hashToken(token),
    fatura_expira_em: new Date(Date.now() + 24 * 3600000).toISOString(),
  }, "return=representation");
  if (!claimed) return;

  const fields = {
    customer_name: row.nome, tel: row.telefone, valor: money(row.original), desconto: money(row.desconto),
  };
  const result = await sendTemplate(row.telefone, invoiceTemplate, [{
    type: "body", parameters: Object.entries(fields).map(([parameter_name, text]) => ({type: "text", parameter_name, text})),
  }, {
    type: "button", sub_type: "url", index: String(invoiceButton), parameters: [{type: "text", text: token}],
  }, {
    type: "button", sub_type: "quick_reply", index: String(handoffButton), parameters: [{type: "payload", payload: handoffReply}],
  }]);
  query.set("resposta_id", "eq." + message.id);
  await db("?" + query, "PATCH", {fatura_status: result.state, fatura_mensagem: result.id});
}

async function recordStatus(value: Record<string, unknown>) {
  const {id, status, timestamp} = value;
  if (typeof id !== "string" || !/^[A-Za-z0-9_.=+/-]{1,256}$/.test(id) ||
      typeof status !== "string" || !["sent", "delivered", "read", "failed"].includes(status) ||
      typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp)) return;
  const response = await api("/rest/v1/bussi_whatsapp_eventos?on_conflict=mensagem,estado",
    env("SUPABASE_SERVICE_ROLE_KEY"), "POST", {
      mensagem: id, estado: status, ocorrido_em: new Date(Number(timestamp) * 1000).toISOString(),
    }, "resolution=ignore-duplicates");
  if (!response.ok) throw Error("Não foi possível registrar o estado do WhatsApp.");
}

async function hashToken(token: string) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function payerFor(body: Record<string, unknown>, nome: string, telefone: string) {
  const contract = typeof body.contrato === "string" ? body.contrato.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const document = typeof body.documento === "string" ? body.documento.replace(/\D/g, "") : "";
  if (contract.length < 3 || contract.length > 80 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^(\d{11}|\d{14})$/.test(document) || nome.length < 5 || !nome.includes(" ")) return null;
  return {name: nome, contract, email, document, phone: telefone.slice(2)};
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
        if (![env("META_WABA_ID"), env("META_MESSAGING_ACCOUNT_ID")].filter(Boolean).includes(entry.id)) continue;
        for (const change of entry.changes ?? []) {
          if (change.field !== "messages" || change.value?.metadata?.phone_number_id !== env("META_PHONE_NUMBER_ID")) continue;
          for (const status of change.value.statuses ?? []) await recordStatus(status);
          for (const message of change.value.messages ?? []) await handleReply(message);
        }
      }
      return json(200, {});
    }

    if (!request.headers.has("Origin") && env("SUPABASE_SERVICE_ROLE_KEY") &&
        request.headers.get("Authorization") === "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY")) {
      const event = JSON.parse(new TextDecoder().decode(raw));
      if (event.action !== "pagamento_verificado" || !Number.isSafeInteger(event.numero) || event.numero < 1) return json(400, {});
      const service = env("SUPABASE_SERVICE_ROLE_KEY");
      const reserved = await api("/rest/v1/rpc/bussi_whatsapp_reservar_encerramento", service, "POST", {p_numero: event.numero});
      if (!reserved.ok) return json(503, {});
      const recipient = await reserved.json();
      if (!recipient) return json(200, {status: "sem_envio"});
      const result = await sendTemplate(recipient, paymentTemplate, []);
      const recorded = await api("/rest/v1/rpc/bussi_whatsapp_registrar_encerramento", service, "POST",
        {p_numero: event.numero, p_status: result.state});
      return json(recorded.ok ? 200 : 503, {status: result.state});
    }
    if (request.headers.get("Origin") !== origin) return json(403, {});
    const body = JSON.parse(new TextDecoder().decode(raw));
    if (body.action === "abrir_fatura") {
      if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) return json(404, {});
      const response = await api("/rest/v1/rpc/bussi_whatsapp_abrir_fatura", env("SUPABASE_SERVICE_ROLE_KEY"),
        "POST", {p_hash: await hashToken(body.token)});
      if (!response.ok) return json(503, {erro: "Fatura indisponível."});
      const invoice = await response.json();
      return invoice ? json(200, invoice) : json(404, {});
    }
    const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return json(401, {});
    const access = await api("/rest/v1/rpc/bussi_operador_ativo", token, "POST", {});
    if (!access.ok || await access.json() !== true) return json(403, {erro: "Entre com a sessão administrativa do BUSSI."});
    if (body.action === "etapas_clientes") {
      const response = await api("/rest/v1/rpc/bussi_clientes_etapas", env("SUPABASE_SERVICE_ROLE_KEY"), "POST", {});
      if (!response.ok) return json(503, {erro: "Não foi possível carregar as etapas dos clientes."});
      return json(200, {etapas: await response.json()});
    }
    if (body.action === "fluxo") {
      const offset = body.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return json(400, {});
      const response = await api("/rest/v1/rpc/bussi_whatsapp_fluxo", env("SUPABASE_SERVICE_ROLE_KEY"),
        "POST", {p_offset: offset});
      if (!response.ok) return json(503, {erro: "Não foi possível carregar o acompanhamento."});
      return json(200, {entregas: await response.json()});
    }
    if (!["META_GRAPH_VERSION", "META_WABA_ID", "META_PHONE_NUMBER_ID", "META_WHATSAPP_TOKEN", "META_APP_SECRET",
      "META_WEBHOOK_VERIFY_TOKEN"].every((key) => env(key))) return json(503, {erro: "Conexão do WhatsApp ainda não configurada no servidor."});

    if (body.action === "status") {
      await approvedTemplates();
      return json(200, {status: "pronto"});
    }
    if (body.action === "enviar" && env("BUSSI_BLACKFRIDAY_SENDING_ENABLED") !== "true") {
      return json(409, {erro: "Envio Black Friday pausado até a revisão do modelo."});
    }
    if (body.action !== "enviar" || body.consentimento !== true) return json(400, {});
    const {telefone, nome, original, desconto} = body;
    if (typeof telefone !== "string" || !/^55\d{10,11}$/.test(telefone) ||
        typeof nome !== "string" || !/^[^\r\n\t]{2,120}$/.test(nome) ||
        !Number.isInteger(original) || original < 200 || original > 999999999 ||
        !Number.isInteger(desconto) || desconto <= 0 || desconto !== Math.ceil(original / 2)) return json(422, {erro: "Cadastro ou valores inválidos."});
    const pagador = payerFor(body, nome, telefone);
    if (!pagador) return json(422, {erro: "Complemente o cadastro do pagador no CRM."});
    const {offerButton: button, offerImage, offerText} = await approvedTemplates();
    const normalized = offerText.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
    if (/SUA\s+CONTA\s+SERA\s+BLOQUEADA/.test(normalized)) {
      return json(409, {erro: "Revise a abertura do modelo Black Friday antes do disparo."});
    }
    const mediaId = env("META_BLACKFRIDAY_IMAGE_ID");
    if (offerImage && !/^\d+$/.test(mediaId)) return json(409, {erro: "Cadastre a imagem original do modelo antes do disparo."});
    const [reserved] = await db("?on_conflict=campanha,telefone", "POST",
      {campanha: campaign, telefone, nome, original, desconto, pagador}, "resolution=ignore-duplicates,return=representation");
    if (!reserved) return json(200, {status: "ja_registrado"});

    const components: unknown[] = [{type: "body", parameters: [nome, money(original), money(desconto)]
      .map((text) => ({type: "text", text}))}];
    if (offerImage) components.unshift({type: "header", parameters: [{type: "image", image: {id: mediaId}}]});
    if (button >= 0) components.push({type: "button", sub_type: "quick_reply", index: String(button),
      parameters: [{type: "payload", payload: campaignReply}]});
    const result = await sendTemplate(telefone, "blackfriday", components);
    const filter = new URLSearchParams({campanha: "eq." + campaign, telefone: "eq." + telefone});
    await db("?" + filter, "PATCH", {oferta_status: result.state, mensagem: result.id});
    return json(200, {status: result.state});
  } catch (error) {
    return json(503, {erro: error instanceof Error && /modelos/.test(error.message) ? error.message : "Integração indisponível. Confira o histórico antes de repetir."});
  }
}

if (import.meta.main) Deno.serve(handle);
