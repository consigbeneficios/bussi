export const endpoint = "https://api.nitropagamento.app";

export async function consultarTransacao(id:string, headers:HeadersInit) {
  const encoded = encodeURIComponent(id);
  const options = {headers, redirect:"error" as const, signal:AbortSignal.timeout(30000)};
  const response = await fetch(endpoint+"/transactions/"+encoded,options);
  const payload = response.ok ? await response.json().catch(()=>null) : null;
  // Some deployments return the API index at the path-style route.
  const index = response.ok && payload?.version && payload?.endpoints && !payload?.data;
  if (response.status!==404 && !index) return {status:response.status,ok:response.ok,payload};
  const alternate = await fetch(endpoint+"/?id="+encoded,options);
  return {status:alternate.status,ok:alternate.ok,payload:alternate.ok ? await alternate.json().catch(()=>null) : null};
}

export function imagemPix(value:unknown) {
  if (typeof value!=="string") return null;
  const png = value.replace(/^data:image\/png;base64,/i,"");
  return /^[A-Za-z0-9+/=]{1,80000}$/.test(png) ? png : null;
}
