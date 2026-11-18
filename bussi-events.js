/* BUSSI — eventos de interação (registro local e webhook opcional). */
(()=>{
'use strict';
const KEY='bussi.events.v1',LIMIT=5000;
const ALLOWED=new Set(['link_opened','pay_clicked','pix_copied','invoice_downloaded','status_opened','payment_confirmed','payment_refused','charge_created']);
function all(){try{const a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[]}catch{return []}}
function take(d,k){const x=d&&d[k];return x===undefined||x===null?'':String(x).slice(0,120)}
function record(d,type){
 if(!ALLOWED.has(type))return null;
 const ev={id:(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),type,at:new Date().toISOString(),chargeId:take(d,'chargeId')||take(d,'id'),invoice:take(d,'invoice')};
 try{const list=all();list.push(ev);localStorage.setItem(KEY,JSON.stringify(list.slice(-LIMIT)));window.dispatchEvent(new Event('bussi:event'))}catch{}
 const url=typeof d?.trackingEndpoint==='string'?d.trackingEndpoint.trim():'';
 if(url&&/^https:\/\//i.test(url)){
  try{
   const body=JSON.stringify({type:ev.type,at:ev.at,chargeId:ev.chargeId,invoice:ev.invoice});
   if(navigator.sendBeacon)navigator.sendBeacon(url,new Blob([body],{type:'text/plain;charset=UTF-8'}));
   else fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body,keepalive:true,mode:'cors'}).catch(()=>{});
  }catch{}
 }
 return ev
}
window.BussiEvents={all,record,key:KEY};
})();