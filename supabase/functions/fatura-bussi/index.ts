import {consultarTransacao, endpoint, imagemPix} from "../_shared/nitro.ts";
const base = Deno.env.get("SUPABASE_URL")!;
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const allowed = new Set(["https://pay.consigbeneficio.com.br","https://consig-beneficios-faturas.zanysundae4.chatgpt.site","https://consigbeneficios.github.io"]);
const idPattern = /^[a-zA-Z0-9_-]{1,150}$/;
const states: Record<string,string> = {pendente:"pendente", pago:"pago", cancelado:"cancelado", expirado:"cancelado", reembolsado:"reembolsado"};
async function db(op:string,key:string,values:Record<string,unknown>={}) {
  const resp = await fetch(base+"/rest/v1/rpc/bussi_fatura_servidor", {method:"POST",headers:{apikey:secret,Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({p_op:op,p_chave:key,p_dados:values}),redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!resp.ok) throw Error("banco");
  return await resp.json();
}
function gatewayHeaders() {
  const pub=Deno.env.get("NITRO_PUBLIC_KEY"), priv=Deno.env.get("NITRO_SECRET_KEY");
  if(!pub||!priv) throw Error("config");
  return {Authorization:"Basic "+btoa(pub+":"+priv),"Content-Type":"application/json"};
}
function centavos(value:unknown) {
  const str=String(value);
  if(!/^\d{1,10}(\.\d{1,2})?$/.test(str)) return -1;
  const [inteiro,fracao=""]=str.split(".");
  return Number(inteiro)*100+Number(fracao.padEnd(2,"0"));
}
function payer(value:Record<string,unknown>) {
  if(!value || typeof value!=="object") return null;
  const str=(key:string)=>typeof value[key]==="string" ? String(value[key]).trim() : "";
  const name=str("name"), email=str("email"), document=str("document").replace(/[.\-/ ]/g,""), phone=str("phone").replace(/[()+ -]/g,"");
  if(name.length<3 || name.length>120 || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^(\d{11}|\d{14})$/.test(document) || !/^\d{10,13}$/.test(phone)) return null;
  return {name,email,document,phone};
}
function publico(f:any) {
  const expired=Date.parse(f.vence_em)<=Date.now();
  const situacao=expired && ["aberta","pendente"].includes(f.situacao) ? "expirada" : f.situacao;
  return {numero:f.numero,descricao:f.descricao,cliente:f.pagador?.name??null,contrato:f.pagador?.contract??null,original:f.original_centavos,valor:f.valor_centavos,vence:f.vence_em,situacao,
    confirmado:f.pago_verificado_em,verificado:f.verificado_em,
    falhaProvedor:situacao==="processando" && f.emissao_http_status>=500,
    pix:situacao==="pendente"?f.pix:null,qr:situacao==="pendente"?f.qr:null};
}
async function confirmar(f:any, id:string) {
  const resp=await consultarTransacao(id,gatewayHeaders());
  if(!resp.ok) throw Error("consulta");
  const result=resp.payload, d=result?.data;
  const ordem=d?.metadata?.order_id ?? d?.external_ref;
  const corresponde=ordem==null ? f.nitro_id===id : ordem===f.id;
  if(result?.success!==true || d?.id!==id || d.payment_method!=="pix" || (d.currency!=null&&d.currency!=="BRL") || centavos(d.amount)!==f.valor_centavos || !corresponde || !Object.hasOwn(states,d.status)) throw Error("divergencia");
  if(!f.nitro_id && f.situacao==="processando") {
    if(states[d.status]==="pendente" && (typeof d.pix_code!=="string" || !d.pix_code.startsWith("000201") || d.pix_code.length>2048)) return f;
    await db("vincular",f.token_hash,{id,pix:typeof d.pix_code==="string"?d.pix_code:null,qr:imagemPix(d.pix_qr_code)});
  }
  const verified = await db("verificar",f.token_hash,{id,ordem:f.id,centavos:f.valor_centavos,situacao:states[d.status]}) || f;
  if (verified.situacao === "pago" && verified.pago_verificado_em) {
    try {
      const notification = await fetch(base + "/functions/v1/bussi-whatsapp", {
        method: "POST",
        headers: {apikey: secret, Authorization: "Bearer " + secret, "Content-Type": "application/json"},
        body: JSON.stringify({action: "pagamento_verificado", numero: verified.numero}),
        redirect: "error", signal: AbortSignal.timeout(12000),
      });
      if (!notification.ok) console.warn("bussi_whatsapp_encerramento", notification.status);
    } catch {
      console.warn("bussi_whatsapp_encerramento_indisponivel");
    }
  }
  return verified;
}
// A consultation can recover a timed-out creation, but never issues another charge.
async function recuperarEmissao(f:any) {
  const lock = await fetch(base+"/rest/v1/rpc/bussi_reservar_consulta_emissao", {
    method:"POST",headers:{apikey:secret,Authorization:"Bearer "+secret,"Content-Type":"application/json"},
    body:JSON.stringify({p_hash:f.token_hash}),redirect:"error",signal:AbortSignal.timeout(8000)
  });
  if (!lock.ok || await lock.json() !== true) return f;
  const url = new URL("/transactions",endpoint);
  const day = (v:number) => new Date(v).toISOString().slice(0,10);
  url.searchParams.set("start_date",day(Date.parse(f.aceite_em)-86400000));
  url.searchParams.set("end_date",day(Date.now()+86400000));
  url.searchParams.set("limit","100");
  for (let page=1;page<=3;page++) {
    url.searchParams.set("page",String(page));
    const response = await fetch(url,{headers:gatewayHeaders(),redirect:"error",signal:AbortSignal.timeout(8000)});
    if (!response.ok) { console.warn("nitro_consulta_emissao",f.numero,response.status); return f; }
    const result=await response.json(), list=result?.data;
    const rows=[result,list,result?.transactions,list?.transactions,result?.transacoes,list?.transacoes,
      list?.data,list?.items,result?.items,result?.results,list?.results].find(Array.isArray);
    if (result?.success===false || !rows) {
      const keys=["success","data","transactions","transacoes","items","results","status","message","error","pagination","total","api","version","endpoints","empresa"];
      const shape=(obj:any)=>keys.filter(k=>obj!=null && Object.hasOwn(obj,k)).join(",");
      console.warn("nitro_lista_formato",f.numero,shape(result),shape(list),result?.success===false?"recusada":"incompativel");
      return f;
    }
    const match=rows.find((r:any)=>r && (r.metadata?.order_id===f.id || r.external_ref===f.id) && typeof r.id==="string" && idPattern.test(r.id));
    if (match) return await confirmar(f,match.id);
    if (rows.length<100) break;
  }
  console.info("nitro_referencia_ausente_na_consulta",f.numero);
  return f;
}
function motivoNitro(status:number, data:any) {
  // Inspect validation text in memory. Logs and public responses use only these categories.
  const detail=JSON.stringify([data?.message,data?.error,data?.errors,data?.mensagem]).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  if ([401,403].includes(status)) return "autorizacao";
  if (![400,422].includes(status)) return "indeterminado";
  if (/(minim|minimum|at least)/.test(detail) && /(amount|valor|montante|transa[cç]ao)/.test(detail)) return "valor_minimo";
  if (/(cpf|cnpj|document|telefone|phone|email|e-mail|customer)/.test(detail)) return "cadastro";
  return "validacao";
}
export async function handle(req:Request) {
  const origin=req.headers.get("Origin");
  const h=new Headers({"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"});
  const out=(status:number,data:object)=>new Response(JSON.stringify(data),{status,headers:h});
  if(origin && !allowed.has(origin)) return out(403,{erro:"Origem inválida."});
  if(origin)h.set("Access-Control-Allow-Origin",origin);
  h.set("Access-Control-Allow-Headers","content-type, apikey");h.set("Access-Control-Allow-Methods","POST, OPTIONS");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:h});
  if(req.method!=="POST")return out(405,{erro:"Use o link individual."});
  try {
    if(Number(req.headers.get("content-length"))>16384)return out(413,{erro:"Dados muito longos."});
    const raw=await req.text();if(raw.length>16384)return out(413,{erro:"Dados muito longos."});
    let body;try{body=JSON.parse(raw)}catch{return out(400,{erro:"Dados inválidos."});}
    const cb=new URL(req.url).searchParams.get("retorno");
    if(cb!==null){
      if(!/^[a-f0-9-]{36}$/.test(cb)||!idPattern.test(body?.data?.transaction_id??""))return out(400,{erro:"Notificação inválida."});
      const f=await db("notificacao",cb);
      if(!f || (f.nitro_id && f.nitro_id!==body.data.transaction_id))return out(200,{recebido:true});
      await confirmar(f,body.data.transaction_id);
      return out(200,{recebido:true});
    }
    if(typeof body?.token!=="string"||!/^[0-9a-f]{64}$/.test(body.token))return out(404,{erro:"Fatura indisponível."});
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body.token));
    const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
    let f=await db("ler",hash);
    if(!f || String(f.numero)!==String(body.numero))return out(404,{erro:"Fatura indisponível."});
    if(body.acao==="aceitar"){
      const supplied=body.pagador==null ? null : payer(body.pagador);
      if(body.aceito!==true || (body.pagador!=null && !supplied))return out(400,{erro:"Não foi possível solicitar o Pix."});
      gatewayHeaders();
      const current=await db("aceitar",hash,supplied ?? {});
      if(!current)return out(200,publico(await db("ler",hash)));
      const customer=payer(current.pagador) ?? supplied;
      const src="https://pay.consigbeneficio.com.br/fatura"+String(f.numero).padStart(4,"0");
      const response=await fetch(endpoint,{method:"POST",headers:gatewayHeaders(),redirect:"error",signal:AbortSignal.timeout(30000),
        body:JSON.stringify({amount:f.valor_centavos/100,payment_method:"pix",description:f.descricao,...(customer ? {customer} : {}),
          metadata:{order_id:f.id},source_url:src,source_label:"Cartão de Benefícios CONSIG",postbackUrl:base+"/functions/v1/fatura-bussi?retorno="+f.id})});
      const data=await response.json().catch(()=>null);
      if(!response.ok){
        const motivo=motivoNitro(response.status,data);
        console.warn("nitro_emissao",f.numero,response.status,motivo);
        // Reopen only an explicit rejection; a proxy or ambiguous failure may follow a successful issuance.
        const recusada=[400,422].includes(response.status) && data?.success===false;
        const estado=recusada ? await db("recusada",hash) : await db("falha_emissao",hash,{http:response.status});
        const mensagens:Record<string,string>={
          autorizacao:"A Nitro recusou o acesso da integração. O atendimento precisa verificar a conta.",
          valor_minimo:"A Nitro informou que o valor está abaixo do mínimo aceito.",
          cadastro:"O emissor da fatura precisa conferir o cadastro com a Nitro.",
          validacao:"A Nitro recusou os dados da solicitação. Entre em contato com o atendimento.",
          indeterminado:response.status>=500 ? "A Nitro retornou um erro ao emitir o Pix." : "A emissão ainda não foi confirmada."
        };
        return out(502,{erro:mensagens[motivo],fatura:publico(estado || current)});
      }
      const d=data?.data;
      if(data?.success!==true||typeof d?.id!=="string"||!idPattern.test(d.id)||d.payment_method!=="pix"||d.status!=="pendente"||centavos(d.amount)!==f.valor_centavos||(d.metadata?.order_id ?? d.external_ref)!==f.id||typeof d.pix_code!=="string"||!d.pix_code.startsWith("000201")||d.pix_code.length>2048)throw Error("resposta");
      const qr=imagemPix(d.pix_qr_code);
      f=await db("vincular",hash,{id:d.id,pix:d.pix_code,qr}) || await db("ler",hash);
    }else if(body.acao==="consultar"){
      if(!f.nitro_id && f.situacao==="processando") {
        try { f=await recuperarEmissao(f); } catch { console.warn("nitro_consulta_indisponivel",f.numero); }
      } else if(f.nitro_id && (!f.verificado_em||Date.parse(f.verificado_em)<Date.now()-30000))f=await confirmar(f,f.nitro_id);
    }else return out(400,{erro:"Operação inválida."});
    return out(200,publico(f));
  }catch{return out(503,{erro:"Serviço temporariamente indisponível. Consulte novamente em instantes."});}
}
if(import.meta.main) Deno.serve(handle);
