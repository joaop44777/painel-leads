const API_URL="https://script.google.com/macros/s/AKfycbyJREouzyp6eufA2d_mleGNm2s1AAV9JVAYoetw2TnLnApHkr30R_bivOccl1zJs3Ak/exec";
const INTERVALO=5000;
let primeiraCarga=true;
let idsConhecidos=new Set();
let leads=[];

const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

function data(v){
 if(!v)return"Sem data";
 const d=new Date(v); if(isNaN(d))return String(v);
 return new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(d);
}
function hora(){
 $("lastUpdate").textContent=new Intl.DateTimeFormat("pt-BR",{timeStyle:"medium",timeZone:"America/Sao_Paulo"}).format(new Date());
}
function toast(t,m){
 const x=document.createElement("div");x.className="toast";x.innerHTML=`<b>${esc(t)}</b><span>${esc(m)}</span>`;$("toast").appendChild(x);setTimeout(()=>x.remove(),7000);
}
function som(){
 try{
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
  const c=new C(),t=c.currentTime;
  [0,.16,.32].forEach((a,i)=>{let o=c.createOscillator(),g=c.createGain();o.frequency.value=i===1?880:660;g.gain.setValueAtTime(.0001,t+a);g.gain.exponentialRampToValueAtTime(.18,t+a+.02);g.gain.exponentialRampToValueAtTime(.0001,t+a+.13);o.connect(g);g.connect(c.destination);o.start(t+a);o.stop(t+a+.14)});
  setTimeout(()=>c.close(),800);
 }catch(e){}
}
async function ativarNotificacoes(){
 if(!("Notification"in window)){toast("Notificações indisponíveis","Este navegador não oferece notificações.");return}
 const p=await Notification.requestPermission();
 $("notify").textContent=p==="granted"?"🔔 Notificações ativadas":p==="denied"?"🔕 Notificações bloqueadas":"🔔 Ativar notificações";
 if(p==="granted")toast("Notificações ativadas","Você será avisado quando um novo lead cair.");
}
function atualizarBotao(){
 if(!("Notification"in window)){$("notify").textContent="🔕 Sem suporte";$("notify").disabled=true}
 else if(Notification.permission==="granted")$("notify").textContent="🔔 Notificações ativadas";
 else if(Notification.permission==="denied")$("notify").textContent="🔕 Notificações bloqueadas";
}
function notificar(l){
 const corpo=`${l.nome||"Novo cliente"}${l.whatsapp?" • WhatsApp: "+l.whatsapp:""}`;
 toast("🔔 NOVO LEAD!",corpo);som();
 if("Notification"in window&&Notification.permission==="granted"){
  try{const n=new Notification("🔔 NOVO LEAD!",{body:corpo,tag:"lead-"+l.id,requireInteraction:true});n.onclick=()=>{window.focus();n.close()}}catch(e){}
 }
}
function ordenar(a){return[...a].sort((x,y)=>(new Date(y.dataHora).getTime()||0)-(new Date(x.dataHora).getTime()||0))}
function card(l,atendido){
 return `<article class="lead" data-id="${esc(l.id)}"><div><div class="name">${esc(l.nome||"Nome não informado")}</div><div class="fields"><div><div class="label">WhatsApp</div><div class="value">${esc(l.whatsapp||"Não informado")}</div></div><div><div class="label">Placa</div><div class="value">${esc(l.placa||"Não informada")}</div></div><div><div class="label">Táxi / APP</div><div class="value">${esc(l.taxiApp||"Não informado")}</div></div></div><div class="date">Recebido em ${esc(data(l.dataHora))}</div></div>${atendido?'<span class="status">✓ Atendido</span>':`<button class="attend" onclick="marcarAtendido(${Number(l.id)})">Atendido</button>`}</article>`;
}
function render(){
 const p=ordenar(leads.filter(l=>String(l.status).toLowerCase()==="parado"));
 const a=ordenar(leads.filter(l=>String(l.status).toLowerCase()==="atendido"));
 $("stoppedCount").textContent=p.length;$("attendedCount").textContent=a.length;$("tabStopped").textContent=p.length;$("tabAttended").textContent=a.length;
 $("stoppedList").innerHTML=p.length?p.map(l=>card(l,false)).join():'<div class="empty"><b>Nenhum lead parado</b>Todos os leads recebidos foram atendidos.</div>';
 $("attendedList").innerHTML=a.length?a.map(l=>card(l,true)).join():'<div class="empty"><b>Nenhum lead atendido</b>Os leads marcados como atendidos aparecerão aqui.</div>';
}
async function carregar(){
 try{
  const r=await fetch(API_URL+"?_="+Date.now(),{cache:"no-store"});if(!r.ok)throw Error();
  const d=await r.json();if(!Array.isArray(d))throw Error();
  const novos=!primeiraCarga?d.filter(l=>!idsConhecidos.has(String(l.id))&&String(l.status).toLowerCase()==="parado"):[];
  leads=d;idsConhecidos=new Set(d.map(l=>String(l.id)));render();hora();
  $("connection").textContent="● Conectado";$("connection").className="online";
  novos.forEach(notificar);primeiraCarga=false;
 }catch(e){console.error(e);$("connection").textContent="● Sem conexão";$("connection").className="error"}
}
async function marcarAtendido(id){
 const b=document.querySelector(`.lead[data-id="${CSS.escape(String(id))}"] .attend`);if(b){b.disabled=true;b.textContent="Salvando..."}
 try{
  const r=await fetch(`${API_URL}?acao=atender&id=${encodeURIComponent(id)}&_=${Date.now()}`,{cache:"no-store"});
  if(!r.ok)throw Error();const d=await r.json();if(!d.sucesso)throw Error(d.erro);
  const l=leads.find(x=>Number(x.id)===Number(id));if(l)l.status="Atendido";render();toast("Lead atendido",l?.nome||`Lead #${id}`);
 }catch(e){toast("Erro","Não foi possível marcar este lead como atendido.");if(b){b.disabled=false;b.textContent="Atendido"}}
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".content").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active")});
$("notify").onclick=ativarNotificacoes;atualizarBotao();carregar();setInterval(carregar,INTERVALO);