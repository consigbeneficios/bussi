const env = (key: string) => Deno.env.get(key) || "";
const origin = "https://consigbeneficios.github.io";
const campaign = "blackfriday-2026";
const offerTemplate = "blackconsig";
const table = "/rest/v1/bussi_whatsapp_entregas";
const campaignReply = "BUSSI_BLACKFRIDAY_EU_QUERO";
const handoffReply = "BUSSI_FATURA_ATENDENTE";
const language = {code: "pt_BR"};
const invoiceTemplate = "blackconsigconfe";
const invoiceButtonUrl = origin + "/bussi/fatura-whatsapp.html#";
const invoiceReply = "BUSSI_GERAR_FATURA";
const handoffTemplate = "blackdireatendente";
function bodyParameters(template: any, values: string[]) {
  const text = template.components?.find((part: any) => part.type === "BODY")?.text ?? "";
  const names: string[] = [...new Set<string>(Array.from(text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g), (m: any) => m[1]))];
  if (names.length !== values.length || (names.some(name => /^\d+$/.test(name)) &&
      names.some((name, i) => name !== String(i+1)))) throw Error("Confira as variáveis dos modelos na Meta.");
  return names.map((name, i) => ({type:"text", text:values[i], ...(/^\d+$/.test(name) ? {} : {parameter_name:name})}));
}

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
  const result = await Promise.all([offerTemplate, invoiceTemplate, handoffTemplate].map(async (name) => {
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
  if (result.some(item => !item)) throw Error("Os modelos exigidos precisam estar aprovados em português do Brasil.");
  const invoiceButton = result[1].components?.find((part: any) => part.type === "BUTTONS")
    ?.buttons?.findIndex((button: any) => button.type === "QUICK_REPLY" && button.text.trim().toUpperCase() === "GERAR FATURA") ?? -1;
  if (invoiceButton < 0) throw Error("Confira o botão GERAR FATURA nos modelos da Meta.");
  const offerButton = result[0].components?.find((component: {type: string}) => component.type === "BUTTONS")
    ?.buttons?.findIndex((button: {type: string; text: string}) =>
      button.type === "QUICK_REPLY" && button.text.trim().toUpperCase() === "EU QUERO") ?? -1;
  const handoffButton = result[1].components?.find((component: {type: string}) => component.type === "BUTTONS")
    ?.buttons?.findIndex((button: {type: string; text: string}) =>
      button.type === "QUICK_REPLY" && button.text.trim().toLowerCase() === "falar com atendente") ?? -1;
  if (handoffButton < 0) throw new Error("O modelo fatura_bussi precisa do botão Falar com atendente.");
  const offerComponents = result[0].components ?? [];
  const offerHandoff = offerComponents.find((part: {type: string}) => part.type === "BUTTONS")
    ?.buttons?.findIndex((button: {type: string; text: string}) =>
      button.type === "QUICK_REPLY" && button.text.trim().toLowerCase() === "falar com atendente") ?? -1;
  const offerImage = offerComponents.some((part: {type: string; format?: string}) => part.type === "HEADER" && part.format === "IMAGE");
  const offerText = offerComponents.find((part: {type: string}) => part.type === "BODY")?.text ?? "";
  if (offerButton < 0) throw Error("Confira o botão EU QUERO nos modelos da Meta.");
  return {offerButton, invoiceButton, handoffButton, offerImage, offerText, offerHandoff, offer: result[0], confirmation: result[1]};
}

async function handleHandoff(message: Record<string, any>) {
  if (!deskId(message.context?.id) || !deskId(message.id) ||
      typeof message.from !== "string" || !/^55\d{10,11}$/.test(message.from)) return;
  const query = new URLSearchParams({
    campanha: "eq." + campaign, telefone: "eq." + message.from,
    or: "(fatura_mensagem.eq." + message.context.id + ",mensagem.eq." + message.context.id + ")",
    atendente_em: "is.null", encerramento_status: "is.null",
  });
  const [claimed] = await db("?" + query, "PATCH", {
    atendente_em: new Date().toISOString(), atendente_resposta_id: message.id,
    atendente_aviso_status: "reservado",
  }, "return=representation");
  if (!claimed) return;
  const result = await sendTemplate(message.from, handoffTemplate, []);
  query.delete("atendente_em");
  query.set("atendente_resposta_id", "eq." + message.id);
  await db("?" + query, "PATCH", {atendente_aviso_status: result.state});
}

async function sendInvoiceLink(message: Record<string, any>) {
  if (!deskId(message.context?.id) || !deskId(message.id) || !deskPhone(message.from)) return;
  const query = new URLSearchParams({campanha:"eq."+campaign, telefone:"eq."+message.from,
    fatura_mensagem:"eq."+message.context.id, fatura_status:"eq.aceito",
    fatura_acesso_hash:"is.null", atendente_em:"is.null"});
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const hash = await hashToken(token);
  const [claimed] = await db("?"+query,"PATCH",{fatura_acesso_hash:hash,
    fatura_expira_em:new Date(Date.now()+24*3600000).toISOString()},"return=representation");
  if (!claimed) return;
  const result = await sendMessage(message.from,{type:"text",text:{body:"Sua fatura BUSSI: "+invoiceButtonUrl+token,preview_url:false}});
  if (result.state === "recusado") {
    query.set("fatura_acesso_hash","eq."+hash);
    await db("?"+query,"PATCH",{fatura_acesso_hash:null,fatura_expira_em:null});
  }
}

async function handleReply(message: Record<string, any>) {
  if (message.type === "button" && message.button?.payload === handoffReply) {
    return handleHandoff(message);
  }
  if (message.type === "button" && message.button?.payload === invoiceReply) return sendInvoiceLink(message);
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
  if (!row || row.resposta_id || row.atendente_em || !row.pagador) return;
  const {invoiceButton, handoffButton, confirmation} = await approvedTemplates();
  const parameters = bodyParameters(confirmation, [row.nome, row.telefone, money(row.original), money(row.desconto)]);
  query.set("resposta_id", "is.null");
  query.set("atendente_em", "is.null");
  const [claimed] = await db("?" + query, "PATCH", {
    resposta_id: message.id, resposta_em: new Date().toISOString(), fatura_status: "reservado",
  }, "return=representation");
  if (!claimed) return;
  const result = await sendTemplate(row.telefone, invoiceTemplate, [
    {type:"body",parameters},
    {type:"button",sub_type:"quick_reply",index:String(invoiceButton),parameters:[{type:"payload",payload:invoiceReply}]},
    {type:"button",sub_type:"quick_reply",index:String(handoffButton),parameters:[{type:"payload",payload:handoffReply}]},
  ]);
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


const deskTable = "/rest/v1/bussi_atendimento_mensagens";
const deskPhone = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{7,14}$/.test(value);
const deskId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.=+/-]{1,256}$/.test(value);
const deskText = (value: unknown, limit = 4096) => typeof value === "string"
  ? Array.from(value.replaceAll("\u0000","").trim()).slice(0,limit).join("") : "";

async function recordIncoming(message: Record<string, any>, contacts: Array<Record<string, any>>) {
  if (!deskPhone(message.from) || !deskId(message.id) || typeof message.timestamp !== "string" ||
      !/^\d{10}$/.test(message.timestamp)) return;
  const time = Number(message.timestamp) * 1000;
  if (time > Date.now() + 60000) return;
  const kinds: Record<string,string> = {
    image:"Imagem", audio:"Áudio", video:"Vídeo", document:"Documento", sticker:"Figurinha",
    location:"Localização", contacts:"Contato", reaction:"Reação",
  };
  const type = typeof message.type === "string" ? message.type : "outro";
  const text = type === "text" ? deskText(message.text?.body) :
    type === "button" ? deskText(message.button?.text) :
    type === "interactive" ? deskText(message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title) :
    Object.hasOwn(kinds,type) ? deskText(message[type]?.caption) || kinds[type] : "";
  if (!text || type === "reaction") return;
  const contact = contacts.find(item => item.wa_id === message.from)?.profile?.name;
  const response = await api(deskTable + "?on_conflict=meta_id", env("SUPABASE_SERVICE_ROLE_KEY"), "POST", {
    telefone:message.from, contato:deskText(contact,120) || null, direcao:"entrada",
    tipo:type, texto:text, meta_id:message.id, estado:"recebido", ocorrido_em:new Date(time).toISOString(),
  }, "resolution=ignore-duplicates");
  if (!response.ok) throw Error("Não foi possível registrar a mensagem recebida.");
}

async function deskRequest(body: Record<string, any>, json: (status:number, body:object) => Response) {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  if (body.action === "atendimento_lista") {
    const offset = body.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return json(400,{erro:"Página inválida."});
    const response = await api("/rest/v1/rpc/bussi_atendimento_conversas",service,"POST",
      {p_busca:deskText(body.busca,120),p_offset:offset});
    if (!response.ok) return json(503,{erro:"Não foi possível carregar suas conversas."});
    const rows = await response.json();
    return json(200,{conversas:rows.slice(0,50),mais:rows.length>50});
  }

  if (!deskPhone(body.telefone)) return json(400,{erro:"Selecione um contato válido."});
  const telefone = body.telefone;
  const incoming = new URLSearchParams({telefone:"eq."+telefone,direcao:"eq.entrada",
    select:"ocorrido_em",order:"ocorrido_em.desc",limit:"1"});
  const inbound = await api(deskTable+"?"+incoming,service);
  if (!inbound.ok) return json(503,{erro:"Não foi possível conferir a janela de atendimento."});
  const [last] = await inbound.json();
  const canReply = !!last && Date.parse(last.ocorrido_em) > Date.now()-24*60*60*1000;
  if (body.action === "atendimento_historico") {
    const before = body.antes ?? null;
    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) return json(400,{erro:"Histórico inválido."});
    const response = await api("/rest/v1/rpc/bussi_atendimento_historico",service,"POST",{p_tel:telefone,p_antes:before});
    if (!response.ok) return json(503,{erro:"Não foi possível carregar o histórico."});
    const rows = await response.json();
    return json(200,{mensagens:rows.slice(0,60),mais:rows.length>60,pode_responder:canReply});
  }

  const message = deskText(body.texto);
  const requestId = body.pedido;
  if (!message || typeof requestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    return json(400,{erro:"Escreva uma mensagem válida."});
  }
  if (!canReply) return json(409,{erro:"A janela de 24 horas está fechada. Aguarde uma nova mensagem do cliente."});
  if (!env("META_WHATSAPP_TOKEN") || !env("META_PHONE_NUMBER_ID")) {
    return json(503,{erro:"A conexão com o WhatsApp ainda não está disponível."});
  }
  const reserve = await api(deskTable+"?on_conflict=pedido",service,"POST",{
    telefone,direcao:"saida",tipo:"text",texto:message,estado:"reservado",pedido:requestId,
  },"resolution=ignore-duplicates,return=representation");
  if (!reserve.ok) return json(503,{erro:"Não foi possível registrar a resposta."});
  const [claimed] = await reserve.json();
  if (!claimed) return json(200,{status:"ja_registrado"});

  const result = await sendMessage(telefone,{type:"text",text:{body:message}});
  const saved = await api(deskTable+"?pedido=eq."+requestId,service,"PATCH",{estado:result.state,meta_id:result.id});
  if (!saved.ok) return json(503,{erro:"Resultado indeterminado. Atualize o histórico antes de tentar novamente."});
  return json(200,{status:result.state});
}

async function offerArtwork() {
  try {
    const source = await fetch(origin + "/bussi/blackfriday-consig.svg", {
      redirect:"error",signal:AbortSignal.timeout(5000),
    });
    if (!source.ok) return new Response(null,{status:404});
    const svg = await source.text();
    if (svg.length > 500000) return new Response(null,{status:502});
    const encoded = svg.match(/href="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/)?.[1];
    if (!encoded) return new Response(null,{status:502});
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length-2] !== 255 || bytes[bytes.length-1] !== 217) {
      return new Response(null,{status:502});
    }
    return new Response(bytes,{headers:{"Content-Type":"image/jpeg","Cache-Control":"public, max-age=3600",
      "X-Content-Type-Options":"nosniff"}});
  } catch {
    return new Response(null,{status:502});
  }
}

async function novusRequest(path: string, payload?: object, method = payload ? "POST" : "GET") {
  const account = env("NOVUS_ACCOUNT_ID");
  const key = env("NOVUS_API_KEY");
  if (!/^\d+$/.test(account) || !key) return null;
  return fetch("https://api.novuscrm.com.br/v1/" + path, {
    method,
    body: payload ? JSON.stringify(payload) : undefined,
    headers: {"X-Ambiente": account, "X-Authorization": "X-Chave-Api " + key, "Content-Type": "application/json"},
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
}

type NovusContact = Record<string, unknown> & {Id: string; Telefone: string; Nome?: string};

function novusPhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{10,11}$/.test(digits) ? "55" + digits : digits;
}

async function findNovusContact(phone: string): Promise<NovusContact | null> {
  const query = new URLSearchParams({telefone:phone, pageSize:"20"});
  const response = await novusRequest("contatodechat/filtrar?" + query);
  if (!response?.ok) throw new Error("consulta");
  const result = await response.json();
  if (!Array.isArray(result.Items)) throw new Error("consulta");
  const matches = result.Items.filter((item: NovusContact) => novusPhone(item.Telefone) === phone);
  if (matches.length > 1 || result.HasNext || (!matches.length && result.Items.length)) throw new Error("conflito");
  return matches[0] ?? null;
}

async function syncNovusContact(body: Record<string, any>, json: (status: number, body: object) => Response) {
  const phone = body.telefone;
  const previous = body.telefone_anterior ?? phone;
  const name = typeof body.nome === "string" ? body.nome.trim() : "";
  if (typeof phone !== "string" || typeof previous !== "string" || !/^55\d{10,11}$/.test(phone) ||
      !/^55\d{10,11}$/.test(previous) || !/^[^\r\n\t]{2,120}$/.test(name)) {
    return json(400, {erro:"Nome ou telefone inválido."});
  }

  try {
    const current = await findNovusContact(phone);
    const old = previous === phone ? current : await findNovusContact(previous);
    if (previous !== phone && current && old && current.Id !== old.Id) throw new Error("conflito");
    if (previous !== phone && current && !old && current.Nome !== name) throw new Error("conflito");
    const existing = old ?? current;
    if (existing) {
      if (existing.Nome === name && novusPhone(existing.Telefone) === phone) return json(200, {status:"existente"});
      if (!/^[\da-f-]{36}$/i.test(existing.Id)) throw new Error("consulta");
      const path = "contatodechat/" + existing.Id;
      const details = await novusRequest(path);
      if (!details?.ok) throw new Error("consulta");
      const contact = await details.json();
      if (contact.Id !== existing.Id || contact.EhGrupo || ![phone,previous].includes(novusPhone(contact.Telefone))) throw new Error("conflito");
      const fields = ["TipoDeContato","NomeNaAgenda","Apelido","Email","Observacao","EhGrupo","Principal",
        "ProfilePicUrl","IdPessoa","IdCanal","IdUsuarioFidelizado","IdDepartamentoTransbordo","EnviarParaGrupoDeChatCasoUsuarioOffline"];
      const payload = Object.fromEntries(fields.filter(field => field in contact).map(field => [field,contact[field]]));
      const updated = await novusRequest(path, {...payload, Nome:name, Telefone:phone}, "PUT");
      const saved = updated?.ok ? await updated.json().catch(() => null) : null;
      if (saved?.Id !== existing.Id || saved?.Nome !== name || novusPhone(saved?.Telefone) !== phone) throw new Error("atualização");
      return json(200, {status:"atualizado"});
    }

    const created = await novusRequest("contatodechat", {Nome:name, Telefone:phone});
    const saved = created?.ok ? await created.json().catch(() => null) : null;
    if (!saved?.Id || saved.Nome !== name || novusPhone(saved.Telefone) !== phone) throw new Error("cadastro");
    return json(200, {status:"criado"});
  } catch (error) {
    if (error instanceof Error && error.message === "conflito") {
      return json(409, {erro:"Há contatos conflitantes no Novus. Confira os números antes de sincronizar."});
    }
    return json(503, {erro:"O Novus não confirmou a sincronização. Tente novamente."});
  }
}

async function novusDesk(body: Record<string, any>, json: (status: number, body: object) => Response) {
  const unavailable = () => json(503, {erro:"Não foi possível consultar o atendimento do Novus."});
  const action = body.action;
  if (action === "novus_lista") {
    const offset = body.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || offset % 50) return json(400, {});
    const query = new URLSearchParams({page:String(offset / 50 + 1),pageSize:"50",sort:"-timestamp"});
    if (typeof body.busca === "string" && body.busca.trim()) query.set("search", body.busca.trim().slice(0,120));
    const response = await novusRequest("atendimento?" + query);
    if (!response?.ok) return unavailable();
    const data = await response.json();
    const conversas = (data.Items ?? []).filter((row: any) => row.Id && Date.parse(row.DataDaUltimaMensagemEnviada || row.DataDaCriacao))
      .map((row: any) => ({
        id:row.Id, nome:row.NomeContato || row.TelefoneContato || "Contato Novus",
        telefone:row.TelefoneContato || "", texto:row.UltimaMensagem || "",
        ocorrido_em:row.DataDaUltimaMensagemEnviada || row.DataDaCriacao,
        canal:row.NomeCanal || "", departamento:row.NomeDepartamento || "",
        nao_lidas:row.MensagensNaoLidas || 0,
      }));
    return json(200, {conversas, mais:data.HasNext === true});
  }

  const id = body.id;
  if (typeof id !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return json(400, {});
  const path = "atendimento/" + id + "/mensagens";
  const baseQuery = "tipo=0&excluida=false&sort=-DataDaCriacao";
  const query = new URLSearchParams(baseQuery);
  query.set("pageSize", "50");
  if (body.antes != null) {
    if (typeof body.antes !== "string" || !Number.isFinite(Date.parse(body.antes))) return json(400, {});
    query.set("dataFinal", new Date(Date.parse(body.antes)).toISOString());
  }
  const response = await novusRequest(path + "?" + query);
  if (!response?.ok) return unavailable();
  const data = await response.json();
  const estados: Record<number, string> = {[-1]:"failed",0:"sent",1:"delivered",2:"read",3:"read"};
  const mensagens = (data.Items ?? []).filter((row: any) => row.Id && Date.parse(row.DataDaCriacao)).map((row: any) => ({
    id:row.Id, direcao:row.FromMe ? "saida" : "entrada",
    texto:row.Corpo || row.MediaName || "Mensagem com conteúdo disponível no Novus",
    ocorrido_em:row.DataDaCriacao, estado:estados[row.Status],
  }));
  return json(200, {mensagens, mais:data.HasNext === true, pode_responder:false});
}


const novusCampaign = "novus-blackfriday-2026";

function novusOfferQuery(telefone: string) {
  return new URLSearchParams({campanha:"eq." + novusCampaign, telefone:"eq." + telefone});
}

async function prepareNovusOffer(body: Record<string, any>, json: (status: number, body: object) => Response) {
  const {nome, telefone, original, desconto} = body;
  if (body.consentimento !== true || typeof telefone !== "string" || !/^55\d{10,11}$/.test(telefone) ||
      typeof nome !== "string" || !/^[^\r\n\t]{2,120}$/.test(nome) ||
      !Number.isInteger(original) || original < 200 || original > 999999999 || desconto !== Math.ceil(original / 2)) {
    return json(422, {erro:"Confira o cadastro, os valores e o consentimento."});
  }
  const pagador = payerFor(body, nome, telefone);
  if (!pagador) return json(422, {erro:"Complemente o cadastro do pagador no CRM."});
  const fixtureQuery = new URLSearchParams({contrato:"eq." + pagador.contract.toUpperCase(), select:"id", limit:"1"});
  const fixtures = await api("/rest/v1/bussi_testes_campanha?" + fixtureQuery, env("SUPABASE_SERVICE_ROLE_KEY"));
  if (!fixtures.ok) return json(503, {erro:"Não foi possível conferir o cadastro."});
  if ((await fixtures.json()).length) return json(409, {erro:"Use este cadastro somente na simulação."});
  const [created] = await db("?on_conflict=campanha,telefone", "POST", {
    campanha:novusCampaign, telefone, nome, original, desconto, pagador,
  }, "resolution=ignore-duplicates,return=representation");
  return json(200, {status:created ? "preparada" : "ja_preparada"});
}

async function novusFlow(request: Request, raw: ArrayBuffer, json: (status: number, body: object) => Response) {
  const encode = (value: string) => new TextEncoder().encode(value);
  const secret = env("BUSSI_NOVUS_FLOW_TOKEN");
  if (secret.length < 32) return json(503, {erro:"Integração Novus ainda não configurada."});
  const key = await crypto.subtle.importKey("raw", encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign","verify"]);
  const expected = await crypto.subtle.sign("HMAC", key, encode("bussi-novus-auth"));
  const provided = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const candidate = await crypto.subtle.importKey("raw", encode(provided || "-"), {name:"HMAC", hash:"SHA-256"}, false, ["verify"]);
  if (!await crypto.subtle.verify("HMAC", candidate, expected, encode("bussi-novus-auth"))) return json(403, {});
  const body = JSON.parse(new TextDecoder().decode(raw));
  const action = body?.action;
  const rawPhone = typeof body?.telefone === "string" ? body.telefone.replace(/\D/g, "") : "";
  const telefone = rawPhone.length === 10 || rawPhone.length === 11 ? "55" + rawPhone : rawPhone;
  if (!/^55\d{10,11}$/.test(telefone) || !["dados_oferta","gerar_fatura"].includes(action)) return json(400, {});
  const query = novusOfferQuery(telefone);
  query.set("select", "nome,telefone,original,desconto,fatura_pedido,fatura_acesso_hash,fatura_expira_em,atendente_em");
  const [row] = await db("?" + query);
  if (!row || row.atendente_em) return json(404, {erro:"Oferta indisponível."});
  if (action === "dados_oferta") return json(200, {
    nome:row.nome, telefone:row.telefone, original:money(row.original), desconto:money(row.desconto),
  });

  const bytes = await crypto.subtle.sign("HMAC", key, encode("bussi-novus-fatura:" + row.fatura_pedido));
  const token = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
  const hash = await hashToken(token);
  if (!row.fatura_acesso_hash) {
    query.set("fatura_acesso_hash", "is.null");
    query.set("atendente_em", "is.null");
    const [claimed] = await db("?" + query, "PATCH", {
      oferta_status:"aceito", resposta_id:"novus." + row.fatura_pedido, resposta_em:new Date().toISOString(),
      fatura_status:"aceito", fatura_acesso_hash:hash, fatura_expira_em:new Date(Date.now() + 86400000).toISOString(),
    }, "return=representation");
    query.delete("fatura_acesso_hash");
    query.delete("atendente_em");
    const active = claimed || (await db("?" + query))[0];
    if (!active || active.atendente_em || active.fatura_acesso_hash !== hash) return json(409, {erro:"Fatura indisponível."});
    row.fatura_expira_em = active.fatura_expira_em;
  } else if (row.fatura_acesso_hash !== hash) {
    return json(409, {erro:"Fatura indisponível."});
  }
  if (!(Date.parse(row.fatura_expira_em) > Date.now())) return json(410, {erro:"O link da fatura expirou."});
  const issued = await api("/rest/v1/rpc/bussi_whatsapp_abrir_fatura", env("SUPABASE_SERVICE_ROLE_KEY"),
    "POST", {p_hash:hash});
  if (!issued.ok) return json(503, {erro:"Não foi possível emitir o link da fatura."});
  const invoice = await issued.json();
  if (!Number.isSafeInteger(invoice?.numero) || invoice.numero < 1 || !/^[a-f0-9]{64}$/.test(invoice.token ?? "")) {
    return json(503, {erro:"Não foi possível emitir o link da fatura."});
  }
  const url = "https://pay.consigbeneficio.com.br/fatura" + String(invoice.numero).padStart(4, "0") + "#" + invoice.token;
  return json(200, {url});
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
    if (url.searchParams.get("imagem") === "blackfriday") return await offerArtwork();
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
          for (const message of change.value.messages ?? []) {
            await recordIncoming(message, Array.isArray(change.value.contacts) ? change.value.contacts : []);
            await handleReply(message);
          }
        }
      }
      return json(200, {});
    }

    if (url.searchParams.get("integracao") === "novus") return await novusFlow(request, raw, json);

    if (!request.headers.has("Origin") && env("SUPABASE_SERVICE_ROLE_KEY") &&
        request.headers.get("Authorization") === "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY")) {
      const event = JSON.parse(new TextDecoder().decode(raw));
      if (event.action !== "pagamento_verificado" || !Number.isSafeInteger(event.numero) || event.numero < 1) return json(400, {});
      return json(200, {status: "confirmacao_whatsapp_manual"});

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
    if (["atendimento_lista","atendimento_historico","atendimento_enviar"].includes(body.action)) {
      return await deskRequest(body,json);
    }
    if (["novus_lista","novus_historico"].includes(body.action)) return await novusDesk(body, json);
    if (body.action === "novus_preparar_oferta") return await prepareNovusOffer(body, json);
    if (body.action === "novus_sincronizar_contato") return await syncNovusContact(body, json);
    if (body.action === "novus_status") {
      const account = env("NOVUS_ACCOUNT_ID");
      const key = env("NOVUS_API_KEY");
      if (!/^\d+$/.test(account) || !key) {
        return json(503, {erro:"A conta Novus ainda precisa ser configurada no servidor BUSSI."});
      }
      const novus = await fetch("https://api.novuscrm.com.br/v1/etiquetas", {
        headers: {"X-Ambiente": account, "X-Authorization": "X-Chave-Api " + key},
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      if (novus?.status === 401 || novus?.status === 403) {
        return json(503, {erro:"O Novus recusou a autenticação. Confira a conta e a chave no servidor BUSSI."});
      }
      if (!novus?.ok) return json(503, {erro:"Não foi possível consultar o Novus agora."});
      return json(200, {status:"conectado"});
    }
    if (body.action === "clientes_teste") {
      const fixtures = await api("/rest/v1/bussi_testes_campanha?select=id,contrato,nome,telefone,original,desconto&order=nome.asc",
        env("SUPABASE_SERVICE_ROLE_KEY"));
      if (!fixtures.ok) return json(503,{erro:"Não foi possível carregar os clientes de teste."});
      return json(200,{clientes:await fixtures.json()});
    }
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
    const fixtureFilter = new URLSearchParams({contrato:"eq."+pagador.contract.toUpperCase(),select:"id",limit:"1"});
    const fixture = await api("/rest/v1/bussi_testes_campanha?"+fixtureFilter,env("SUPABASE_SERVICE_ROLE_KEY"));
    if (!fixture.ok) return json(503,{erro:"Não foi possível conferir a classificação do cliente."});
    if ((await fixture.json()).length) return json(409,{erro:"Use este cadastro somente na simulação."});
    const {offerButton: button, offerImage, offerText, offerHandoff, offer} = await approvedTemplates();
    const normalized = offerText.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
    if (/SUA\s+CONTA\s+SERA\s+BLOQUEADA/.test(normalized)) {
      return json(409, {erro: "Revise a abertura do modelo Black Friday antes do disparo."});
    }
    const mediaId = env("META_BLACKFRIDAY_IMAGE_ID");
    const image = /^\d+$/.test(mediaId) ? {id:mediaId} : {link:env("SUPABASE_URL") + "/functions/v1/bussi-whatsapp?imagem=blackfriday"};
    const parameters = bodyParameters(offer, [nome, money(original), money(desconto)]);
    const [reserved] = await db("?on_conflict=campanha,telefone", "POST",
      {campanha: campaign, telefone, nome, original, desconto, pagador}, "resolution=ignore-duplicates,return=representation");
    if (!reserved) return json(200, {status: "ja_registrado"});

    const components: unknown[] = [{type:"body", parameters}];
    if (offerImage) components.unshift({type: "header", parameters: [{type: "image", image}]});
    if (button >= 0) components.push({type: "button", sub_type: "quick_reply", index: String(button),
      parameters: [{type: "payload", payload: campaignReply}]});
    if (offerHandoff >= 0) components.push({type:"button",sub_type:"quick_reply",index:String(offerHandoff),
      parameters:[{type:"payload",payload:handoffReply}]});
    const result = await sendTemplate(telefone, offerTemplate, components);
    const filter = new URLSearchParams({campanha: "eq." + campaign, telefone: "eq." + telefone});
    await db("?" + filter, "PATCH", {oferta_status: result.state, mensagem: result.id});
    return json(200, {status: result.state});
  } catch (error) {
    return json(503, {erro: error instanceof Error && /modelos/.test(error.message) ? error.message : "Integração indisponível. Confira o histórico antes de repetir."});
  }
}

if (import.meta.main) Deno.serve(handle);
