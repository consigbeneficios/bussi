(()=>{
'use strict';
const SUPABASE_URL='https://qzelhgfwrppkhdmolhys.supabase.co';
const KEY='sb_publishable_KCmjXZQbnFBkB977wPFLDg_4YiNvUw0';
const CLOUD_URL=new URL('fatura.html',location.href).href;
const status=document.getElementById('cloudStatus');
const signIn=document.getElementById('cloudSignIn');
const signUp=document.getElementById('cloudSignUp');
const signOut=document.getElementById('cloudSignOut');
const syncButton=document.getElementById('cloudSync');
const email=document.getElementById('cloudEmail');
const password=document.getElementById('cloudPassword');
const list=document.getElementById('cloudInvoiceList');
if(!status||!window.supabase?.createClient){if(status)status.textContent='Não foi possível carregar a conexão com o Supabase.';return;}
const db=window.supabase.createClient(SUPABASE_URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
let busy=false;
function say(m){status.textContent=m;}
function safeDate(d){return /^\d{4}-\d{2}-\d{2}$/.test(String(d||''))?d:null;}
function parseLink(link){
 try{
  const hash=new URL(link).hash;
  const p=new URLSearchParams(hash.slice(1)).get('p');
  if(!p)return null;
  let b=p.replace(/-/g,'+').replace(/_/g,'/');
  while(b.length%4)b+='=';
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b),x=>x.charCodeAt(0))));
 }catch{return null}
}
function cloudLink(token){return CLOUD_URL+'?token='+encodeURIComponent(token)}
async function getUser(){const {data,error}=await db.auth.getUser();return error?null:data.user;}
async function render(){
 const u=await getUser();
 signIn.disabled=signUp.disabled=!!u;
 signOut.disabled=syncButton.disabled=!u;
 password.style.display=u?'none':'';
 email.value=u?.email||email.value||'sac@consigbeneficio.com.br';
 email.disabled=!!u;
 if(u){say('Conectado à nuvem: '+u.email+'. Clique em Sincronizar para salvar as faturas.');await refreshList();}
 else{say('Conecte uma conta Supabase para armazenar faturas em segurança. Os dados locais permanecem no navegador.');list.textContent='';}
}
async function authAction(mode){
 const e=email.value.trim(),p=password.value;
 if(!e||p.length<8){say('Informe um e-mail e uma senha com pelo menos 8 caracteres.');return}
 signIn.disabled=signUp.disabled=true;
 try{
  const {data,error}=mode==='signup'?await db.auth.signUp({email:e,password:p}):await db.auth.signInWithPassword({email:e,password:p});
  if(error)throw error;
  password.value='';
  if(data.session){await render();}
  else say('Verifique seu e-mail para confirmar o cadastro e depois clique em Entrar.');
 }catch(err){say('Falha na autenticação: '+(err.message||'verifique os dados'))}
 finally{signIn.disabled=signUp.disabled=false;}
}
signUp.addEventListener('click',()=>authAction('signup'));
signIn.addEventListener('click',()=>authAction('login'));
signOut.addEventListener('click',async()=>{await db.auth.signOut();await render()});
async function refreshList(){
 const u=await getUser();if(!u)return;
 const {data,error}=await db.from('bussi_invoices').select('invoice_number,customer_name,amount,status,access_token').order('created_at',{ascending:false}).limit(50);
 if(error){say('Falha ao consultar faturas: '+error.message);return}
 list.replaceChildren();
 for(const inv of data||[]){
  const line=document.createElement('div');
  line.style.cssText='border-bottom:1px solid #e5e8ec;padding:9px 0;font-size:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap';
  const title=document.createElement('span');
  title.textContent=inv.invoice_number+' · '+inv.customer_name+' · '+Number(inv.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+' · '+inv.status;
  const copy=document.createElement('button');copy.type='button';copy.className='btn sm ghost';copy.textContent='Copiar link';
  copy.addEventListener('click',async()=>{const url=cloudLink(inv.access_token);try{await navigator.clipboard.writeText(url);say('Link '+inv.invoice_number+' copiado.')}catch{prompt('Copie o link:',url)}});
  line.append(title,copy);list.append(line);
 }
 if(!data?.length)list.textContent='Nenhuma fatura sincronizada nesta conta.';
}
function statusOf(charge){
 return charge.status==='Pagamento confirmado'?'confirmed':
  charge.status==='Pagamento recusado'?'refused':'pending';
}
function invoiceNameCloud(n){return 'fatura'+String(n).padStart(4,'0')}
function rewriteLocalInvoice(charge,invoice){
 const raw=parseLink(charge.url);
 if(!raw)return;
 raw.invoice=invoice;
 charge.url=new URL('pagamento.html#p='+b64url(raw),'https://consigbeneficios.github.io/bussi/').href;
 charge.invoice=invoice;
 charge.shortCode=invoice;
}
async function sync(){
 if(busy)return {ok:false,reason:'Sincronização em andamento'};
 busy=true;syncButton.disabled=true;
 try{
  const user=await getUser();
  if(!user)throw Error('Entre na conta Supabase em Integrações antes de sincronizar');
  const {data:registered,error:readError}=await db.from('bussi_invoices')
   .select('invoice_number,access_token,status,source_charge_id')
   .order('created_at',{ascending:false}).limit(1000);
  if(readError)throw readError;
  const known=new Map((registered||[]).map(x=>[x.invoice_number,x]));
  const bySource=new Map((registered||[]).filter(x=>x.source_charge_id).map(x=>[x.source_charge_id,x]));
  let highest=[...known.keys()].reduce((n,name)=>{const m=/^fatura(\d+)$/.exec(name);return m?Math.max(n,Number(m[1])):n},10);
  let created=0,updated=0,ignored=0,renumbered=0;
  for(const charge of [...charges].reverse()){
   if(!charge?.id||!/^fatura\d{4,}$/i.test(String(charge.invoice||''))){ignored++;continue;}
   const sourceId=String(charge.id);
   const linked=bySource.get(sourceId);
   if(linked){
    charge.cloudUrl=cloudLink(linked.access_token);
    if(linked.invoice_number!==charge.invoice)rewriteLocalInvoice(charge,linked.invoice_number);
    const desired=statusOf(charge);
    // Somente estados finais podem ser propagados automaticamente; nunca reabrir uma cobrança confirmada.
    if(linked.status!=='confirmed'&&desired!=='pending'&&linked.status!==desired){
     const {error}=await db.from('bussi_invoices').update({status:desired})
      .eq('source_charge_id',sourceId).neq('status','confirmed');
     if(error)throw Error('Status da '+charge.invoice+': '+error.message);
     linked.status=desired;updated++;
    }
    continue;
   }
   const snapshot=parseLink(charge.url);
   if(!snapshot?.pix){ignored++;continue;}
   let invoice=String(charge.invoice).toLowerCase();
   let result=null;
   for(let attempt=0;attempt<15;attempt++){
    if(known.has(invoice)){
     highest=Math.max(highest,Number(invoice.slice(6))||10)+1;
     invoice=invoiceNameCloud(highest);continue;
    }
    const entry={
     owner_id:user.id,source_charge_id:sourceId,invoice_number:invoice,
     customer_name:String(charge.customer||snapshot.customer||'Cliente'),
     customer_phone:String(charge.phone||snapshot.phone||''),
     contract_number:String(charge.contract||snapshot.contract||''),
     amount:Number(charge.amount??snapshot.amount),
     original_amount:Number(charge.original??snapshot.original??snapshot.amount),
     discount_pct:Number(charge.discount??snapshot.discount??0),
     description:String(charge.description||snapshot.description||''),
     issue_date:safeDate(charge.issueDate||snapshot.issueDate)||new Date().toISOString().slice(0,10),
     due_date:safeDate(charge.due||snapshot.due),pix_payload:String(snapshot.pix),
     status:statusOf(charge),
    };
    const {data,error}=await db.from('bussi_invoices').insert(entry)
     .select('access_token,invoice_number,source_charge_id,status').single();
    if(!error){result=data;break;}
    if(error.code!=='23505')throw Error(charge.invoice+': '+error.message);
    // Outro aparelho reservou o número: obtenha o próximo e nunca ligue uma fatura ao token de outro cliente.
    const {data:recent,error:reloadError}=await db.from('bussi_invoices').select('invoice_number')
     .order('created_at',{ascending:false}).limit(1000);
    if(reloadError)throw reloadError;
    for(const row of recent||[]){
     const m=/^fatura(\d+)$/.exec(row.invoice_number||'');if(m)highest=Math.max(highest,Number(m[1]));
    }
    highest++;invoice=invoiceNameCloud(highest);
   }
   if(!result)throw Error('Não foi possível reservar número para '+charge.invoice+'. Tente sincronizar novamente.');
   if(charge.invoice!==invoice){rewriteLocalInvoice(charge,invoice);renumbered++;}
   charge.cloudUrl=cloudLink(result.access_token);
   known.set(invoice,result);bySource.set(sourceId,result);created++;
   highest=Math.max(highest,Number(invoice.slice(6))||10);
   localStorage.setItem(K.charges,JSON.stringify(charges));
  }
  save(K.charges,charges);
  if(highest>=11)localStorage.setItem(INVOICE_SEQUENCE_KEY,String(Math.max(nextInvoiceNumber(),highest+1)));
  if(charges[0]?.cloudUrl&&lastLink){
   lastLink=charges[0].cloudUrl;
   const field=document.getElementById('generatedLink');
   if(field)field.value=lastLink;
  }
  renderAll();
  say('Nuvem sincronizada: '+created+' nova(s), '+updated+' status atualizado(s), '+ignored+' sem dados Pix. '+(renumbered?'Algumas faturas foram renumeradas para evitar duplicidade.':''));
  await refreshList();
  return {ok:true,created,updated,ignored};
 }catch(err){
  const message=err.message||'falha não identificada';
  say('Erro de sincronização: '+message);
  return {ok:false,reason:message};
 }finally{busy=false;syncButton.disabled=false;}
}
async function updateStatus(charge){
 if(!charge?.id)return;
 const user=await getUser();if(!user)return;
 try{
  const {error}=await db.from('bussi_invoices').update({status:statusOf(charge)})
   .eq('source_charge_id',String(charge.id)).neq('status','confirmed');
  if(error)throw error;
  await refreshList();
 }catch(err){say('Não foi possível atualizar o status da fatura na nuvem: '+(err.message||err))}
}
window.BussiCloud={
 sync,
 updateStatus,
 async isAuthenticated(){return !!(await getUser())}
};
const importButton=document.getElementById('cloudImportLink');
const legacyInput=document.getElementById('cloudLegacyLink');
if(importButton&&legacyInput)importButton.addEventListener('click',async()=>{
 const link=legacyInput.value.trim();
 let url;
 try{url=new URL(link)}catch{say('Cole um endereço de fatura válido.');return}
 if(!['pay.consigbeneficio.com.br','consigbeneficios.github.io'].includes(url.hostname)){
  say('Este endereço não pertence ao BUSSI. Use um link de pagamento emitido no sistema.');return;
 }
 const snap=parseLink(link);
 if(!snap||!snap.pix||!/^fatura\d{4,}$/i.test(String(snap.invoice||''))||!(Number(snap.amount)>0)){
  say('Não foi possível importar: os dados da fatura estão incompletos ou inválidos.');return;
 }
 const id=Number(snap.chargeId);
 if(!Number.isSafeInteger(id)||id<=0){say('Identificador de cobrança inválido.');return}
 if(charges.some(x=>String(x.id)===String(id))){
  say('Esta fatura já está no histórico. Abra o histórico ou clique em Sincronizar faturas.');return;
 }
 const charge={
  id,invoice:String(snap.invoice).toLowerCase(),contract:String(snap.contract||snap.invoice),
  customer:String(snap.customer||'Cliente'),phone:String(snap.phone||''),
  description:String(snap.description||''),original:Number(snap.original??snap.amount),
  discount:Number(snap.discount??0),amount:Number(snap.amount),
  status:'Aguardando confirmação',due:safeDate(snap.due),issueDate:safeDate(snap.issueDate),
  createdAt:new Date().toISOString(),shortCode:String(snap.invoice).toLowerCase(),
  url:publicPaymentUrl(link)
 };
 charges.unshift(charge);save(K.charges,charges);renderAll();
 legacyInput.value='';
 if(await getUser()){
  const result=await sync();
  if(result?.ok)say('Fatura '+charge.invoice+' recuperada e sincronizada. Copie o novo link no histórico da nuvem.');
 }else say('Fatura '+charge.invoice+' recuperada neste navegador. Conecte a conta da nuvem para salvar online.');
});
syncButton.addEventListener('click',sync);

db.auth.onAuthStateChange((_event,_session)=>{setTimeout(render,0)});
render();
})();
