/* BUSSI — eventos locais, totais diários duráveis e envio opcional a endpoint. */
(()=>{
'use strict';
const KEY='bussi.events.v1',DAILY_KEY='bussi.events.daily.v1',LIMIT=5000;
const TYPES=new Set(['link_opened','pay_clicked','pix_copied','invoice_downloaded','status_opened','payment_confirmed','payment_refused','charge_created']);
function readJson(key,defaultValue){try{const data=JSON.parse(localStorage.getItem(key)||'null');return data===null?defaultValue:data}catch{return defaultValue}}
function all(){const events=readJson(KEY,[]);return Array.isArray(events)?events:[]}
function dayInSaoPaulo(at){
 const d=new Date(at);if(!Number.isFinite(d.getTime()))return '';
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
 const p=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day
}
function rebuildDaily(events=all()){
 const days={};
 for(const e of events){
  if(!TYPES.has(e.type))continue;
  const day=dayInSaoPaulo(e.at);if(!day)continue;
  days[day]??={};days[day][e.type]=(days[day][e.type]||0)+1
 }
 try{localStorage.setItem(DAILY_KEY,JSON.stringify(days))}catch{}
 return days
}
function daily(){
 const existing=readJson(DAILY_KEY,null);
 if(existing&&typeof existing==='object'&&!Array.isArray(existing))return existing;
 return rebuildDaily()
}
function value(d,key){const x=d?.[key];return x==null?'':String(x).slice(0,120)}
function record(d,type){
 if(!TYPES.has(type))return null;
 const event={id:(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),type,at:new Date().toISOString(),chargeId:value(d,'chargeId')||value(d,'id'),invoice:value(d,'invoice')};
 const rollup=daily(),day=dayInSaoPaulo(event.at);
 if(day){rollup[day]??={};rollup[day][type]=(rollup[day][type]||0)+1}
 try{
  localStorage.setItem(DAILY_KEY,JSON.stringify(rollup));
  const records=all();records.push(event);
  localStorage.setItem(KEY,JSON.stringify(records.slice(-LIMIT)));
  window.dispatchEvent(new Event('bussi:event'))
 }catch(err){console.warn('BUSSI: não foi possível salvar o evento neste navegador.',err)}
 const url=typeof d?.trackingEndpoint==='string'?d.trackingEndpoint.trim():'';
 if(url&&/^https:\/\//i.test(url)){
  try{
   const body=JSON.stringify({type:event.type,at:event.at,chargeId:event.chargeId,invoice:event.invoice});
   if(navigator.sendBeacon)navigator.sendBeacon(url,new Blob([body],{type:'text/plain;charset=UTF-8'}));
   else fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body,keepalive:true,mode:'cors'}).catch(()=>{});
  }catch{}
 }
 return event
}
window.BussiEvents={all,daily,record,rebuildDaily,dayInSaoPaulo,key:KEY,dailyKey:DAILY_KEY};
daily(); // Migração única: os eventos existentes viram totais diários sem duplicação.
})();