(()=>{
'use strict';
const URL='https://qzelhgfwrppkhdmolhys.supabase.co';
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
const db=window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
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
async function sync(){
 if(busy)return;busy=true;syncButton.disabled=true;
 try{
  const user=await getUser();if(!user)throw Error('Entre na conta da nuvem antes de sincronizar');
  const {data:registered,error:readError}=await db.from('bussi_invoices').select('invoice_number,access_token,status').limit(1000);
  if(readError)throw readError;
  const known=new Map((registered||[]).map(x=>[x.invoice_number,x]));
  let count=0,skipped=0;
  for(const charge of charges){
   if(!charge.invoice||!/^fatura\d{4,}$/.test(charge.invoice)){skipped++;continue}
   const existing=known.get(charge.invoice);
   if(existing){
    charge.cloudUrl=cloudLink(existing.access_token);
    continue;
   }
   const raw=parseLink(charge.url);
   if(!raw?.pix){skipped++;continue}
   const entry={
    owner_id:user.id,invoice_number:String(charge.invoice),customer_name:String(charge.customer||raw.customer||'Cliente'),
    customer_phone:String(charge.phone||raw.phone||''),contract_number:String(charge.contract||raw.contract||''),
    amount:Number(charge.amount||raw.amount),original_amount:Number(charge.original||raw.original||raw.amount),
    discount_pct:Number(charge.discount||raw.discount||0),description:String(charge.description||raw.description||''),
    issue_date:safeDate(charge.issueDate||raw.issueDate)||new Date().toISOString().slice(0,10),
    due_date:safeDate(charge.due||raw.due),pix_payload:String(raw.pix),
    status:charge.status==='Pagamento confirmado'?'confirmed':charge.status==='Pagamento recusado'?'refused':'pending'
   };
   const {data,error}=await db.from('bussi_invoices').insert(entry).select('access_token,invoice_number').single();
   if(error){if(error.code==='23505'){skipped++;continue}throw Error(charge.invoice+': '+error.message)}
   charge.cloudUrl=cloudLink(data.access_token);known.set(data.invoice_number,data);count++;
  }
  save(K.charges,charges);
  const highest=[...known.keys()].reduce((n,x)=>{const m=/^fatura(\d+)$/.exec(x);return m?Math.max(n,Number(m[1])):n},10);
  if(highest>=11){const next=Math.max(nextInvoiceNumber(),highest+1);localStorage.setItem(INVOICE_SEQUENCE_KEY,String(next));}
  const last=charges[0];if(last?.cloudUrl&&lastLink){
    lastLink=last.cloudUrl;
    const field=document.getElementById('generatedLink');if(field)field.value=last.cloudUrl;
  }
  renderAll();
  say('Sincronização concluída: '+count+' nova(s) fatura(s), '+skipped+' ignorada(s). Os links ficam disponíveis abaixo.');
  await refreshList();
 }catch(err){say('Erro de sincronização: '+(err.message||'falha'));}
 finally{busy=false;syncButton.disabled=false}
}
syncButton.addEventListener('click',sync);
document.getElementById('generateCharge')?.addEventListener('click',()=>setTimeout(async()=>{if(await getUser())await sync();},650));
db.auth.onAuthStateChange((_event,_session)=>{setTimeout(render,0)});
render();
})();
