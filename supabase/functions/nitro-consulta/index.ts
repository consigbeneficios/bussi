import {consultarTransacao} from "../_shared/nitro.ts";
// The RPC authenticates the session, enrolled operator and MFA before any vendor request.
const portal = "https://consigbeneficios.github.io";
const origins = new Set([portal, "https://consigbeneficio.com.br", "https://pay.consigbeneficio.com.br"]);
const idFormat = /^[a-zA-Z0-9_-]{1,150}$/;
const statuses = new Map([["pendente", "Pendente"], ["pago", "Pago"], ["reembolsado", "Reembolsado"], ["expirado", "Expirado"], ["cancelado","Cancelado"]]);

export async function handle(request: Request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({"Cache-Control":"no-store", "Content-Type":"application/json", "Vary":"Origin"});
  function reply(status: number, data: object) {
    return new Response(JSON.stringify(data), {status, headers});
  }
  if (origin && !origins.has(origin)) return reply(403, {erro:"Origem não autorizada."});
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (request.method === "OPTIONS") return new Response(null, {status:204, headers});
  if (request.method !== "POST") return reply(405, {erro:"Método inválido."});
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply(401, {erro:"Entre novamente."});
  try {
    const permission = await fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/rpc/bussi_resumo_recebimentos", {
      method:"POST", headers:{apikey:Deno.env.get("SUPABASE_ANON_KEY")!, Authorization:authorization, "Content-Type":"application/json"},
      body:"{}", redirect:"error", signal:AbortSignal.timeout(8000)
    });
    if (!permission.ok) {
      if (permission.status === 401 || permission.status === 403) return reply(permission.status, {erro:"Sessão administrativa com MFA necessária."});
      return reply(503, {erro:"Consulta administrativa indisponível."});
    }
    const input = await request.json().catch(() => null);
    if (typeof input?.id !== "string" || !idFormat.test(input.id)) return reply(400, {erro:"Identificador inválido."});
    const pub = Deno.env.get("NITRO_PUBLIC_KEY");
    const secret = Deno.env.get("NITRO_SECRET_KEY");
    if (!pub || !secret) return reply(503, {erro:"Credenciais da Nitro indisponíveis no servidor."});
    const response = await consultarTransacao(input.id, {
      Authorization:"Basic " + btoa(pub + ":" + secret), Accept:"application/json", "Content-Type":"application/json"
    });
    if (response.status === 404) return reply(404, {erro:"Transação não encontrada."});
    if (!response.ok) return reply(502, {erro:"A Nitro não concluiu a consulta."});
    const payload = response.payload;
    const data = payload?.data;
    if (payload?.success !== true || data?.id !== input.id || data.payment_method !== "pix" || (data.currency != null && data.currency !== "BRL")) {
      return reply(422, {erro:"O provedor não confirmou esse Pix em reais."});
    }
    const amount = String(data.amount);
    if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return reply(502, {erro:"Valor inválido na resposta da Nitro."});
    return reply(200, {id:data.id, situacao:statuses.get(data.status) ?? "Situação não reconhecida", valor:amount});
  } catch {
    return reply(503, {erro:"Consulta temporariamente indisponível. Tente novamente."});
  }
}

if (import.meta.main) Deno.serve(handle);
