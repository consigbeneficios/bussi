"use strict";
(() => {
  const base = "https://yzhjtqwpmxhigrijiuze.supabase.co";
  const apikey = "sb_publishable_fimYRn4YWFbiwYiADnrQvg_mACDleaU";
  const $ = id => document.getElementById(id);
  const brl = n => Number(n).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  // O cliente Supabase preserva a sessão MFA AAL2 e renova os tokens válidos.
  // Nunca gravar senhas, códigos TOTP ou tokens em backups do CRM.
  const auth = window.supabase.createClient(base,apikey,{
    auth:{storageKey:"bussi-finance-session-v1",persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  let jwt = null, factor = null, busy = false, requestId = null, lastLink = "", before = null;
  let cloudReady = false, cloudBusy = false, cloudTimer = null, cloudRestore = false, cloudSignature = "";
  // O acesso ao portal e ao financeiro depende da MESMA sessão Supabase + MFA.
  const gate=$("authGate"),accessPanel=$("nitroAccess");
  if(gate&&accessPanel){gate.replaceChildren(accessPanel);gate.style.display="grid";gate.style.padding="24px";accessPanel.style.maxWidth="680px";accessPanel.style.margin="0 auto";}
  const status = message => { $("nitroIssueStatus").textContent = message; };
  function resetRequest(){requestId=null;lastLink="";$("nitroGenerated").hidden=true;$("printInvoice").disabled=true;}
  function digits(s){return String(s??"").replace(/\D/g,"");}
  function cents(value){
    const raw=String(value??"").trim().replace(/R\$/gi,"").replace(/\s/g,"");
    let x=raw;
    if (x.includes(",") && x.includes(".")) x=x.lastIndexOf(",")>x.lastIndexOf(".")?x.replace(/\./g,"").replace(",","."):x.replace(/,/g,"");
    else if (x.includes(",")) x=x.replace(",",".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(x)) x=x.replace(/\./g,"");
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(x))return null;
    const parts=x.split(".");
    const valueCents=Number(parts[0])*100+Number((parts[1]||"").padEnd(2,"0"));
    return Number.isSafeInteger(valueCents)&&valueCents>0?valueCents:null;
  }
  async function api(path,payload,method="POST"){
    const {data:{session},error:sessionError}=await auth.auth.getSession();
    if(sessionError||!session?.access_token)throw Error("Sua sessão BUSSI expirou. Entre novamente para sincronizar.");
    jwt=session.access_token;
    const headers={apikey,"Content-Type":"application/json",Authorization:"Bearer "+jwt};
    if(method==="POST" && path==="/rest/v1/bussi_portal_arquivos")headers.Prefer="return=minimal";
    const response=await fetch(base+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(30000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw Object.assign(new Error(data?.message||data?.erro||(response.status===401||response.status===403?"Acesso negado. Verifique sua sessão BUSSI.":"Operação indisponível.")),{status:response.status,code:data?.code});
    return data;
  }
  function showLogin(){jwt=null;factor=null;$("nitroLoginForm").hidden=false;$("nitroVerifyForm").hidden=true;$("nitroWorkspace").hidden=true;$("nitroLogout").hidden=true;$("generateCharge").disabled=true;$("printInvoice").disabled=true;resetRequest();if(typeof showAuth==="function")showAuth();}
  async function handle(action){
    if(busy)return;
    busy=true;
    try{await action();}catch(err){status(err?.message||"Não foi possível concluir.");}
    finally{busy=false;}
  }
  async function openVerifiedWorkspace(remembered=false){
    const {data:{user},error:userError}=await auth.auth.getUser();
    if(userError||!user)throw Error("Sessão inválida. Entre novamente.");
    const {data:assurance,error:assuranceError}=await auth.auth.mfa.getAuthenticatorAssuranceLevel();
    if(assuranceError || assurance?.currentLevel!=="aal2")throw Error("É necessária uma verificação do autenticador para esta sessão.");
    // A validação da função SQL confirma também a condição de administrador.
    await api("/rest/v1/rpc/bussi_dashboard_faturas",{});
    if(typeof enterApp==="function")enterApp();
    $("nitroLoginForm").hidden=true;$("nitroVerifyForm").hidden=true;
    $("nitroWorkspace").hidden=false;$("nitroLogout").hidden=false;
    $("generateCharge").disabled=false;
    status(remembered?"Sessão reconhecida neste navegador. Autenticador não solicitado novamente.":"Acesso BUSSI confirmado. Sessão lembrada neste navegador.");
    try{await startCloudSync();}catch(err){syncStatus("Nuvem indisponível: alterações continuam salvas neste navegador.",true);}
    await history();await summary();
  }
  $("nitroLoginForm").addEventListener("submit",event=>{
    event.preventDefault();void handle(async()=>{
      if(!window.isSecureContext)throw Error("Acesse o BUSSI usando HTTPS.");
      try{
        const {data,error}=await auth.auth.signInWithPassword({email:$("nitroEmail").value.trim(),password:$("nitroPassword").value});
        if(error)throw error;
        const {data:userData,error:userError}=await auth.auth.getUser();
        if(userError)throw userError;
        factor=(userData.user?.factors||data.user?.factors||[]).find(f=>f.factor_type==="totp"&&f.status==="verified")?.id;
        if(!factor)throw Error("Esta conta precisa ter o autenticador TOTP configurado.");
        $("nitroLoginForm").hidden=true;$("nitroVerifyForm").hidden=false;$("nitroLogout").hidden=false;
        status("Informe o código de seis dígitos do autenticador somente para autorizar a sessão.");
        $("nitroCode").focus();
      }finally{$("nitroPassword").value="";}
    });
  });
  $("nitroVerifyForm").addEventListener("submit",event=>{
    event.preventDefault();void handle(async()=>{
      if(!factor)throw Error("Entre com seu e-mail novamente.");
      try{
        const {error}=await auth.auth.mfa.challengeAndVerify({factorId:factor,code:$("nitroCode").value.trim()});
        if(error)throw error;
        await openVerifiedWorkspace(false);
      }finally{$("nitroCode").value="";}
    });
  });
  $("nitroLogout").addEventListener("click",()=>void handle(async()=>{
    await auth.auth.signOut({scope:"local"});
    stopCloudSync();showLogin();status("Sessão encerrada. Os registros permanecem preservados na nuvem.");
  }));
  window.addEventListener("bussi:logout",()=>void auth.auth.signOut({scope:"local"}).finally(()=>{stopCloudSync();showLogin();}));
  // Uma nova visita recupera a sessão AAL2 existente; não substitui MFA por uma flag local.
  async function restoreVerifiedSession(){
    try{
      const {data:{session}}=await auth.auth.getSession();
      if(!session){showLogin();return;}
      await openVerifiedWorkspace(true);
    }catch(error){
      showLogin();
      status("Sua sessão anterior não pode ser reutilizada. Faça login e confirme o autenticador.");
    }
  }

  // Sincronização do CRM: snapshots versionados protegidos por RLS e AAL2.
  const BACKUP_TABLE="/rest/v1/bussi_portal_arquivos";
  const MARKER_KEY="bussi.cloud.last_signature.v1";
  const DIRTY_KEY="bussi.cloud.unsynced.v1";
  const RESET_ID="bussi_20261121_payment_0013", CUTOVER_KEY="bussi.resetId.v1";
  const cloudKeys={clients:"bussi.clients.v1",campaigns:"bussi.campaigns.v1",charges:"bussi.charges.v1",
    settings:"bussi.settings.v1",events:"bussi.events.v1",daily:"bussi.events.daily.v1",
    activity:"bussi.events.activity.v1",invoiceNext:"bussi.invoice.next.v1",chargeDraft:"bussi.charge.draft.v1"};
  function syncStatus(message,error=false){
    const el=$("bussiCloudSyncStatus");if(el){el.textContent=message;el.style.color=error?"#a43b3b":"#17634d";}
  }
  function readLocal(k,fallback){
    try{const v=localStorage.getItem(k);return v===null?fallback:JSON.parse(v)}catch{return fallback;}
  }
  function captureSnapshot(){
    const result={version:6,resetId:RESET_ID,clients:[],campaigns:[],charges:[],settings:{}};
    for(const [k,key] of Object.entries(cloudKeys)){
      const defaultVal=k==="invoiceNext"?14:k==="chargeDraft"||k==="settings"||k==="daily"||k==="activity"?{}:[];
      result[k]=readLocal(key,defaultVal);
    }
    if(!Array.isArray(result.clients))result.clients=[];
    result.clients=result.clients.filter(c=>!seededFake(c));
    if(!Array.isArray(result.charges))result.charges=[];
    if(!Array.isArray(result.campaigns))result.campaigns=[];
    if(!result.settings||typeof result.settings!=="object"||Array.isArray(result.settings))result.settings={};
    // Nunca persistir material de autenticação ou credenciais no backup.
    for(const key of Object.keys(result.settings)){
      if(/password|secret|token|credential|otp|session/i.test(key))delete result.settings[key];
    }
    return result;
  }
  function parseRemote(data){
    if(!data||typeof data!=="object"||!Array.isArray(data.clients)||!Array.isArray(data.campaigns)||
       !Array.isArray(data.charges)||!data.settings||typeof data.settings!=="object")throw Error("Arquivo remoto BUSSI inválido.");
    return data;
  }
  function rowKey(row,type){
    if(type==="clients")return String(row?.contract||"").toLowerCase().trim()||String(row?.document||"").trim();
    if(type==="charges")return String(row?.invoice||row?.id||"").trim();
    if(type==="campaigns")return String(row?.id||row?.name||"").trim();
    return String(row?.id||row?.at||JSON.stringify(row));
  }
  function mergeRows(remote,local,type){
    const map=new Map();let k=0;
    for(const item of [...remote,...local]){
      if(!item||typeof item!=="object")continue;
      if(type==="clients"&&seededFake(item))continue;
      const key=rowKey(item,type)||"unknown_"+(k++);
      map.set(key,item);
    }
    return [...map.values()];
  }
  function restoreSnapshot(remote,mergeLocal=false){
    const stored=captureSnapshot();
    const data=parseRemote(remote);
    const next={
      ...data,
      clients:mergeLocal?mergeRows(data.clients,stored.clients,"clients"):data.clients.filter(c=>!seededFake(c)),
      campaigns:mergeLocal?mergeRows(data.campaigns,stored.campaigns,"campaigns"):data.campaigns,
      charges:mergeLocal?mergeRows(data.charges,stored.charges,"charges"):data.charges,
      settings:mergeLocal?{...data.settings,...stored.settings}:data.settings
    };
    if(mergeLocal){
      next.events=mergeRows(Array.isArray(data.events)?data.events:[],Array.isArray(stored.events)?stored.events:[],"events");
      next.daily={...(data.daily||{}),...(stored.daily||{})};
      next.activity={...(data.activity||{}),...(stored.activity||{})};
      next.invoiceNext=Math.max(Number(data.invoiceNext)||11,Number(stored.invoiceNext)||11);
    }
    cloudRestore=true;
    try{
      for(const [field,key] of Object.entries(cloudKeys)){
        if(field==="chargeDraft" && mergeLocal && localStorage.getItem(key)!==null)continue; // edição após limpeza
        if(next[field]!==undefined)localStorage.setItem(key,JSON.stringify(next[field]));
      }
      clients=next.clients;campaigns=next.campaigns;charges=next.charges;settings=next.settings;
      if(typeof persistAll==="function")persistAll();
      if(typeof renderAll==="function")renderAll();
      if(typeof restoreChargeDraft==="function")restoreChargeDraft();
    }finally{cloudRestore=false;}
  }
  async function snapshotSignature(data){
    const raw=new TextEncoder().encode(JSON.stringify(data));
    const bytes=await crypto.subtle.digest("SHA-256",raw);
    return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,"0")).join("");
  }
  async function uploadSnapshot(force=false){
    if(!cloudReady||cloudBusy||cloudRestore)return;
    cloudBusy=true;
    try{
      const snapshot=captureSnapshot(),sig=await snapshotSignature(snapshot);
      if(!force&&sig===cloudSignature)return;
      // A assinatura única evita acumular cópias idênticas a cada atualização.
      try{await api(BACKUP_TABLE,{conteudo:snapshot});}
      catch(error){if(error.status!==409||error.code!=="23505")throw error;}
      cloudSignature=sig;
      localStorage.setItem(MARKER_KEY,sig);
      localStorage.removeItem(DIRTY_KEY);
      syncStatus("Nuvem sincronizada · "+new Date().toLocaleString("pt-BR"));
    }catch(error){
      localStorage.setItem(DIRTY_KEY,"1");
      syncStatus("Nuvem pendente: "+String(error.message||"falha de rede")+". Dados locais preservados.",true);
    }finally{cloudBusy=false;}
  }
  function scheduleCloudSync(){
    if(cloudRestore)return;
    localStorage.setItem(DIRTY_KEY,"1");
    if(!cloudReady)return;
    clearTimeout(cloudTimer);
    cloudTimer=setTimeout(()=>void uploadSnapshot(),1800);
  }
  function stopCloudSync(){
    cloudReady=false;cloudSignature="";clearTimeout(cloudTimer);
  }
  async function startCloudSync(){
    const copies=await api(BACKUP_TABLE+"?select=conteudo,assinatura,criado_em&order=criado_em.desc&limit=1",undefined,"GET");
    const latest=Array.isArray(copies)?copies[0]:null;
    const local=captureSnapshot();
    const lastDeviceSignature=localStorage.getItem(MARKER_KEY);
    const hasUnsynced=localStorage.getItem(DIRTY_KEY)==="1"||
      (!lastDeviceSignature&&(local.clients.length||local.campaigns.length||local.charges.length));
    if(latest?.conteudo){
      const remote=parseRemote(latest.conteudo);
      if(remote.resetId!==RESET_ID)throw Error("A limpeza financeira não consta no backup. Sincronização bloqueada.");
      const firstLoad=localStorage.getItem(CUTOVER_KEY)!==RESET_ID;
      const merge=!firstLoad && Boolean(hasUnsynced);
      const remoteSig=await snapshotSignature(remote);
      restoreSnapshot(remote,merge);
      cloudSignature=merge?remoteSig:await snapshotSignature(captureSnapshot());
      if(!merge)localStorage.removeItem(DIRTY_KEY);
      localStorage.setItem(CUTOVER_KEY,RESET_ID);
      syncStatus(merge?"Dados novos locais reunidos com o backup.":"Base limpa recuperada da nuvem.");
    }else{
      throw Error("O backup inicial do BUSSI não foi encontrado.");
    }
    cloudReady=true;
    await uploadSnapshot();
  }
  window.addEventListener("bussi:datachange",scheduleCloudSync);
  window.addEventListener("online",()=>void uploadSnapshot());
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible"&&cloudReady)void uploadSnapshot();
  });
  // Abrir e manter dados em sincronia sem criar cópias iguais.
  setInterval(()=>{if(cloudReady)void uploadSnapshot();},15000);
  window.BussiCloudSync={sync:()=>uploadSnapshot(true),get active(){return cloudReady;}};
  function linkFor(row){
    const n=Number(row.numero);
    if(!Number.isSafeInteger(n)||n<1||!/^[a-f0-9]{64}$/.test(String(row.token||"")))throw Error("Link retornado incompleto.");
    return "https://pay.consigbeneficio.com.br/fatura"+String(n).padStart(4,"0")+"#"+row.token;
  }
  function makeLink(row, label){
    const a=document.createElement("a");a.href=linkFor(row);a.textContent=label;a.rel="noopener noreferrer";a.target="_blank";return a;
  }
  function receiptLink(row){
    const url=new URL("comprovante-liquidacao.html",location.href);
    url.hash="numero="+encodeURIComponent(row.numero)+"&token="+encodeURIComponent(row.token);
    const a=document.createElement("a");a.href=url.href;a.textContent="Comprovante";a.target="_blank";a.rel="noopener noreferrer";return a;
  }
  function clientInfo(){
    const c=typeof selectedChargeClient==="function"?selectedChargeClient():null;
    if(!c)throw Error("Selecione um cliente real no CRM.");
    const name=String(c.name??"").trim(),contract=String(c.contract??"").trim();
    const phone=digits(c.phone),document=digits(c.document),email=String(c.email??"").trim().toLowerCase();
    if(name.length<5||!name.includes(" ")||contract.length<3||!/^\d{10,11}$/.test(phone)||phone.startsWith("00")||![11,14].includes(document.length)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      throw Error("Cadastro incompleto: abra CRM / Clientes e confira nome, contrato, CPF/CNPJ, telefone e e-mail.");
    }
    if((document.length===11&&!cpfOk(document))||(document.length===14&&!cnpjOk(document)))throw Error("Confira o CPF/CNPJ cadastrado no CRM.");
    return {name,contract,phone,document,email};
  }
  $("generateCharge").addEventListener("click",event=>{
    event.preventDefault();
    void handle(async()=>{
      if(!jwt||$("nitroWorkspace").hidden)throw Error("Confirme seu acesso administrativo ao BUSSI primeiro.");
      const payer=clientInfo();
      const amount=cents($("chargeOriginal").value);
      const desc=$("chargeDesc").value.trim();
      if(!amount||amount<200||desc.length<8||desc.length>180)throw Error("Informe a descrição contratual e o valor original válido.");
      if(Number($("chargeDiscount").value)!==50)throw Error("Esta emissão usa desconto fixo de 50%.");
      const expected=Math.ceil(amount/2),given=cents($("chargeFinal").value);
      if(given!==expected)throw Error("Valor de desconto inconsistente; confira o valor original.");
      const oldDisabled=$("generateCharge").disabled;
      $("generateCharge").disabled=true;
      try{
        requestId??=crypto.randomUUID();
        const row=await api("/rest/v1/rpc/bussi_emitir_link_cliente",{p_descricao:desc,p_original:amount,p_pedido:requestId,p_pagador:payer,p_contrato:payer.contract});
        lastLink=linkFor(row);$("nitroGenerated").hidden=false;$("nitroGeneratedLink").value=lastLink;
        $("nitroGeneratedNumber").textContent="fatura"+String(row.numero).padStart(4,"0");
        $("printInvoice").disabled=false;
        status("Fatura emitida pelo BUSSI. Nenhuma cobrança foi enviada à Nitro; o Pix será solicitado apenas quando o cliente optar por pagar.");
        requestId=null;await history();await summary();
      }finally{$("generateCharge").disabled=oldDisabled;}
    });
  });
  for(const id of ["chargeClient","chargeOriginal","chargeDiscount","chargeDesc"]){
    $(id)?.addEventListener("input",resetRequest);$(id)?.addEventListener("change",resetRequest);
  }
  $("printInvoice").addEventListener("click",()=>{if(lastLink)window.open(lastLink,"_blank","noopener,noreferrer");});
  $("nitroOpenGenerated").addEventListener("click",()=>{if(lastLink)window.open(lastLink,"_blank","noopener,noreferrer");});
  $("nitroCopyGenerated").addEventListener("click",async()=>{if(!lastLink)return;try{await navigator.clipboard.writeText(lastLink);status("Link seguro copiado.");}catch{prompt("Copie o link:",lastLink);}});
  async function history(older=false){
    if(!jwt)return;
    const rows=await api("/rest/v1/rpc/bussi_historico_faturas",{p_antes:older?before:null});
    if(!Array.isArray(rows))throw Error("Histórico de faturas indisponível.");
    if(!older)$("nitroHistory").replaceChildren();
    for(const r of rows){
      const row=document.createElement("tr");
      const number=document.createElement("td"),customer=document.createElement("td"),description=document.createElement("td"),
        original=document.createElement("td"),value=document.createElement("td"),situation=document.createElement("td"),link=document.createElement("td");
      number.textContent="fatura"+String(r.numero).padStart(4,"0");
      customer.textContent=[r.cliente||"Sem identificação",r.contrato||""].filter(Boolean).join(" · ");
      description.textContent=r.descricao;
      original.textContent=brl(Number(r.original_centavos||0)/100);
      value.textContent=brl(Number(r.valor_centavos||0)/100);
      situation.textContent=r.situacao;
      try{
        link.append(makeLink(r,"Abrir fatura"));
        if(r.situacao==="pago"){link.append(document.createTextNode(" · "),receiptLink(r));}
      }catch{link.textContent="Indisponível";}
      row.append(number,customer,description,original,value,situation,link);$("nitroHistory").append(row);
    }
    if(!older&&!rows.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=7;td.textContent="Nenhuma fatura emitida.";tr.append(td);$("nitroHistory").append(tr);}
    before=rows.at(-1)?.numero??null;$("nitroMore").hidden=rows.length<50;
  }
  // Indicadores financeiros consolidados no próprio banco do BUSSI.
  // O gateway de pagamento não emite faturas nem determina valores.
  window.BussiServerKpis={
    data:null,
    apply(){
      const d=this.data;if(!d)return;
      const nodes={
        mCharges:String(d.faturas),
        mConfirmed:String(d.pagas),
        mPaidValue:brl(Number(d.recebido_centavos||0)/100),
        mPaidCount:d.pagas+" recebimento(s) confirmado(s)",
        mPendingValue:brl(Number(d.aguardando_centavos||0)/100),
        mPendingCount:d.aguardando+" fatura(s) aguardando pagamento"
      };
      for(const [id,value] of Object.entries(nodes)){const node=$(id);if(node)node.textContent=value;}
    }
  };
  async function summary(){
    if(!jwt)return;
    const [data,metrics]=await Promise.all([
      api("/rest/v1/rpc/bussi_resumo_recebimentos",{}),
      api("/rest/v1/rpc/bussi_dashboard_faturas",{})
    ]);
    $("nitroSummary").textContent=Number(data.quantidade||0)+" recebimento(s) confirmado(s) pela Nitro · "+brl(Number(data.total_centavos||0)/100);
    if(!metrics||!Number.isSafeInteger(Number(metrics.faturas)))throw Error("Indicadores BUSSI indisponíveis.");
    window.BussiServerKpis.data=metrics;
    window.BussiServerKpis.apply();
  }
  $("nitroRefresh").addEventListener("click",()=>void handle(async()=>{await history();await summary();status("Situação consultada no servidor.");}));
  $("nitroMore").addEventListener("click",()=>void handle(()=>history(true)));
  showLogin();
  void restoreVerifiedSession();
})();
