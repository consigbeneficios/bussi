"use strict";
(() => {
  const base = "https://yzhjtqwpmxhigrijiuze.supabase.co";
  const apikey = "sb_publishable_fimYRn4YWFbiwYiADnrQvg_mACDleaU";
  const $ = id => document.getElementById(id);
  const brl = n => Number(n).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  let jwt = null, factor = null, busy = false, requestId = null, lastLink = "", before = null;
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
    const headers={apikey,"Content-Type":"application/json"};
    if(jwt)headers.Authorization="Bearer "+jwt;
    const response=await fetch(base+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(30000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(data?.message||data?.erro||(response.status===401||response.status===403?"Acesso negado. Entre novamente com o autenticador.":"Operação indisponível."));
    return data;
  }
  function showLogin(){jwt=null;factor=null;$("nitroLoginForm").hidden=false;$("nitroVerifyForm").hidden=true;$("nitroWorkspace").hidden=true;$("nitroLogout").hidden=true;$("generateCharge").disabled=true;$("printInvoice").disabled=true;resetRequest();}
  async function handle(action){
    if(busy)return;
    busy=true;
    try{await action();}catch(err){status(err?.message||"Não foi possível concluir.");}
    finally{busy=false;}
  }
  $("nitroLoginForm").addEventListener("submit",event=>{
    event.preventDefault();void handle(async()=>{
      if(!window.isSecureContext)throw Error("Acesse o BUSSI usando HTTPS.");
      const pwd=$("nitroPassword").value;
      try{
        const login=await api("/auth/v1/token?grant_type=password",{email:$("nitroEmail").value.trim(),password:pwd});
        jwt=login.access_token;
        const user=await api("/auth/v1/user",undefined,"GET");
        factor=user.factors?.find(x=>x.factor_type==="totp"&&x.status==="verified")?.id;
        if(!factor)throw Error("O acesso financeiro exige autenticador de dois fatores ativo.");
        $("nitroLoginForm").hidden=true;$("nitroVerifyForm").hidden=false;$("nitroLogout").hidden=false;
        status("Informe o código de seis dígitos do autenticador.");
        $("nitroCode").focus();
      }catch(error){jwt=null;throw error;}
      finally{$("nitroPassword").value="";}
    });
  });
  $("nitroVerifyForm").addEventListener("submit",event=>{
    event.preventDefault();void handle(async()=>{
      if(!factor||!jwt)throw Error("Entre com seu e-mail novamente.");
      const endpoint="/auth/v1/factors/"+encodeURIComponent(factor);
      const challenge=await api(endpoint+"/challenge",{});
      const result=await api(endpoint+"/verify",{challenge_id:challenge.id,code:$("nitroCode").value.trim()});
      jwt=result.access_token;
      $("nitroCode").value="";
      $("nitroVerifyForm").hidden=true;$("nitroWorkspace").hidden=false;
      $("generateCharge").disabled=false;
      status("Acesso BUSSI validado. Emita a fatura no BUSSI; a Nitro participa somente do recebimento Pix.");
      await history();
      await summary();
    });
  });
  $("nitroLogout").addEventListener("click",()=>{const old=jwt;showLogin();if(old)void fetch(base+"/auth/v1/logout?scope=local",{method:"POST",headers:{apikey,Authorization:"Bearer "+old},cache:"no-store"}).catch(()=>{});status("Acesso financeiro encerrado.");});
  function linkFor(row){
    const n=Number(row.numero);
    if(!Number.isSafeInteger(n)||n<1||!/^[a-f0-9]{64}$/.test(String(row.token||"")))throw Error("Link retornado incompleto.");
    return "https://pay.consigbeneficio.com.br/fatura"+String(n).padStart(4,"0")+"#"+row.token;
  }
  function makeLink(row, label){
    const a=document.createElement("a");a.href=linkFor(row);a.textContent=label;a.rel="noopener noreferrer";a.target="_blank";return a;
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
      try{link.append(makeLink(r,"Abrir fatura"));}catch{link.textContent="Indisponível";}
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
})();
