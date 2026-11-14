/* Hora do Remédio — app Android (Capacitor)
   Os dados ficam somente no celular do paciente. */
(function(){
"use strict";

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const ymd = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const toMin = t => { const p = t.split(":").map(Number); return p[0]*60+p[1]; };
const fromMin = m => pad(Math.floor(m/60)%24)+":"+pad(m%60);
const uid = () => Math.random().toString(36).slice(2,10);
const nowMin = () => { const d = new Date(); return d.getHours()*60+d.getMinutes(); };
const LS = {
  get(k){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};

/* ---------- plugins nativos ---------- */
const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const plugin = name => (isNative && Cap.registerPlugin) ? Cap.registerPlugin(name) : null;
const LN = plugin("LocalNotifications");
const Prefs = plugin("Preferences");
const AppP = plugin("App");
const TTS = plugin("TextToSpeech");

/* ---------- textos ---------- */
const UNITS = {
  comprimido:["comprimido","comprimidos"], capsula:["cápsula","cápsulas"], gota:["gota","gotas"],
  ml:["mL","mL"], sache:["sachê","sachês"], jato:["jato","jatos"], ui:["unidade (UI)","unidades (UI)"],
  colher:["colher","colheres"], aplicacao:["aplicação","aplicações"]
};
function fmtQty(q){
  q = Number(q);
  if (Math.abs(q % 1 - 0.5) < 1e-9) return q < 1 ? "½" : Math.floor(q)+" e ½";
  return String(q).replace(".",",");
}
function doseText(m){
  const q = Number(m.qty), u = UNITS[m.unit] || [m.unit, m.unit];
  return fmtQty(q)+" "+(q <= 1 ? u[0] : u[1]);
}
function doseSpeech(m){
  const q = Number(m.qty), u = UNITS[m.unit] || [m.unit, m.unit];
  let qs = Math.abs(q % 1 - 0.5) < 1e-9 ? (q < 1 ? "meio" : Math.floor(q)+" e meio") : String(q).replace(".",",");
  const unit = (q <= 1 ? u[0] : u[1]).replace("mL","mililitros").replace(" (UI)","");
  return qs+" "+unit;
}
const PILL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="M9.2 8.1l5.6 7.8"/></svg>';
const thumb = m => m.photo ? '<img class="thumb" src="'+esc(m.photo)+'" alt="Foto de '+esc(m.name)+'">' : '<div class="pill-ico">'+PILL_SVG+'</div>';
const WEEK = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
const MONTH = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const longDate = d => { const w = WEEK[d.getDay()]; return w[0].toUpperCase()+w.slice(1)+", "+d.getDate()+" de "+MONTH[d.getMonth()]; };

/* ---------- estado e armazenamento ---------- */
const state = { meds: [], log: {}, snooze: {}, view: "hoje", form: null, confirmDel: null, notifOk: true };
if (LS.get("hr_big")) document.documentElement.classList.add("big");

async function loadData(){
  let meds = null, log = null, snooze = null;
  if (Prefs){
    try {
      const a = await Prefs.get({ key: "meds" }); if (a && a.value) meds = JSON.parse(a.value);
      const b = await Prefs.get({ key: "log" }); if (b && b.value) log = JSON.parse(b.value);
      const c = await Prefs.get({ key: "snooze" }); if (c && c.value) snooze = JSON.parse(c.value);
    } catch(e){}
  }
  state.meds = meds || LS.get("hr_meds") || [];
  state.log = log || LS.get("hr_log") || {};
  state.snooze = snooze || LS.get("hr_snooze") || {};
}
function pruneLog(){
  const cut = new Date(); cut.setDate(cut.getDate()-60); const c = ymd(cut);
  for (const k of Object.keys(state.log)) if (k.slice(0,10) < c) delete state.log[k];
  const now = Date.now();
  for (const k of Object.keys(state.snooze)) if (state.snooze[k] < now - 3600e3) delete state.snooze[k];
}
function persist(which){
  pruneLog();
  const map = { meds: state.meds, log: state.log, snooze: state.snooze };
  LS.set("hr_"+which, map[which]);
  if (Prefs) Prefs.set({ key: which, value: JSON.stringify(map[which]) }).catch(() => {});
  scheduleSoon();
}

/* ---------- doses ---------- */
function dosesFor(date){
  const ds = ymd(date), out = [];
  for (const m of state.meds){
    if (m.start && ds < m.start) continue;
    if (!m.continuous && m.end && ds > m.end) continue;
    const cd = m.createdAt ? new Date(m.createdAt) : null;
    const skipBefore = (cd && ymd(cd) === ds) ? cd.getHours()*60 + cd.getMinutes() : -1;
    for (const t of m.times){ if (toMin(t) < skipBefore) continue; out.push({ key: ds+"|"+m.id+"|"+t, med: m, time: t, date: ds }); }
  }
  return out.sort((a,b) => a.time.localeCompare(b.time) || a.med.name.localeCompare(b.med.name));
}
function findDose(key){
  const [ds, id, t] = key.split("|");
  const m = state.meds.find(x => x.id === id);
  return m ? { key, med: m, time: t, date: ds } : null;
}
function statusOf(d){
  if (state.log[d.key]) return "taken";
  const today = ymd(new Date());
  if (d.date < today || (d.date === today && toMin(d.time) < nowMin())) return "late";
  return "pending";
}
function untilText(mins){
  if (mins <= 0) return "agora";
  const h = Math.floor(mins/60), m = mins%60;
  if (!h) return "daqui a "+m+" min";
  return "daqui a "+h+"h"+(m ? " "+pad(m)+"min" : "");
}

/* ---------- notificações do sistema ---------- */
// Um aviso por horário (agrupa remédios do mesmo horário). Agenda os próximos dias
// e reagenda sempre que o app é aberto ou algo muda.
const CHANNEL = "doses_v1";
let schedTimer = null, scheduling = Promise.resolve();
function scheduleSoon(){ clearTimeout(schedTimer); schedTimer = setTimeout(() => { scheduling = scheduling.then(reschedule, reschedule); }, 400); }
const DAY0 = Date.UTC(2024,0,1);
function notifId(ds, time){ // inteiro estável e único por data+hora
  const [y,mo,d] = ds.split("-").map(Number);
  const day = Math.round((Date.UTC(y,mo-1,d) - DAY0) / 864e5);
  return 1000 + (day % 20000) * 1440 + toMin(time);
}
function notifFor(group, at, snoozed){
  const lines = group.map(d => d.med.name+" — "+doseText(d.med)+(d.med.notes ? " ("+d.med.notes+")" : ""));
  const title = "💊 Hora do remédio · "+group[0].time+(snoozed ? " (lembrete)" : "");
  return {
    id: snoozed ? 900000000 + (notifId(group[0].date, group[0].time) % 99999999) : notifId(group[0].date, group[0].time),
    title,
    body: group.length === 1 ? lines[0] : group.length+" remédios: "+group.map(d => d.med.name).join(", "),
    largeBody: lines.join("\n"),
    summaryText: "Toque em “Tomei” depois de tomar",
    schedule: { at, allowWhileIdle: true },
    channelId: CHANNEL,
    actionTypeId: "DOSE",
    smallIcon: "ic_stat_pill",
    iconColor: "#0E5A57",
    autoCancel: true,
    foreground: true,
    extra: { keys: group.map(d => d.key) }
  };
}
async function reschedule(){
  if (!LN) return;
  try {
    const pend = await LN.getPending();
    if (pend && pend.notifications && pend.notifications.length)
      await LN.cancel({ notifications: pend.notifications.map(n => ({ id: n.id })) });
    if (!state.meds.length) return;
    const now = Date.now(), list = [];
    const perDay = Math.max(1, new Set(state.meds.flatMap(m => m.times)).size);
    const days = Math.max(3, Math.min(30, Math.floor(400 / perDay)));
    let lastAt = null;
    for (let i = 0; i < days; i++){
      const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+i);
      const groups = {};
      for (const x of dosesFor(d)){ if (!state.log[x.key]) (groups[x.time] = groups[x.time] || []).push(x); }
      for (const t of Object.keys(groups)){
        const [h,mi] = t.split(":").map(Number);
        const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi, 0, 0);
        if (at.getTime() <= now + 3000) continue;
        list.push(notifFor(groups[t], at, false));
        lastAt = at;
      }
    }
    // lembretes adiados ("lembrar em 10 minutos")
    const snoozeGroups = {};
    for (const [k, until] of Object.entries(state.snooze)){
      if (until <= now || state.log[k]) continue;
      const d = findDose(k); if (!d) continue;
      const g = d.date+"|"+d.time;
      (snoozeGroups[g] = snoozeGroups[g] || { until, items: [] }).items.push(d);
    }
    for (const g of Object.values(snoozeGroups)) list.push(notifFor(g.items, new Date(g.until), true));
    // aviso final para abrir o app e manter os lembretes em dia
    if (lastAt){
      const r = new Date(lastAt); r.setDate(r.getDate()-1); r.setHours(9,30,0,0);
      if (r.getTime() > now) list.push({ id: 999, title: "Hora do Remédio", body: "Abra o app para continuar recebendo os lembretes dos seus remédios.",
        schedule: { at: r, allowWhileIdle: true }, channelId: CHANNEL, smallIcon: "ic_stat_pill", iconColor: "#0E5A57" });
    }
    for (let i = 0; i < list.length; i += 60) await LN.schedule({ notifications: list.slice(i, i+60) });
  } catch(e){ console.warn("reschedule", e); }
}
async function setupNotifications(){
  if (!LN) return;
  try {
    await LN.createChannel({ id: CHANNEL, name: "Lembretes de remédio", description: "Avisa a hora de tomar cada remédio",
      importance: 5, visibility: 1, vibration: true, lights: true, lightColor: "#0E5A57", sound: "alarme.wav" });
  } catch(e){}
  try {
    await LN.registerActionTypes({ types: [{ id: "DOSE", actions: [
      { id: "tomei", title: "✓ Tomei" }, { id: "adiar", title: "Lembrar em 10 min" } ] }] });
  } catch(e){}
  try {
    LN.addListener("localNotificationActionPerformed", ev => {
      const n = ev && ev.notification || {}, keys = (n.extra && n.extra.keys) || [];
      if (!keys.length) return;
      if (ev.actionId === "tomei"){ keys.forEach(k => markTaken(k, false)); persist("log"); render(); }
      else if (ev.actionId === "adiar"){ snoozeKeys(keys); }
      else { // tocou no aviso: abre o alarme dentro do app
        const ds = keys.map(findDose).filter(d => d && !state.log[d.key]);
        if (ds.length) showAlarm(ds, true);
      }
    });
    LN.addListener("localNotificationReceived", n => {
      // app aberto na tela: mostra também o alarme grande
      const keys = (n && n.extra && n.extra.keys) || [];
      const ds = keys.map(findDose).filter(d => d && !state.log[d.key]);
      if (ds.length) showAlarm(ds, false);
    });
  } catch(e){}
  await checkPermission(true);
}
async function checkPermission(ask){
  if (!LN) return;
  try {
    let p = await LN.checkPermissions();
    if (p.display !== "granted" && ask) p = await LN.requestPermissions();
    state.notifOk = p.display === "granted";
  } catch(e){ state.notifOk = true; }
  $("#permBar").classList.toggle("hidden", state.notifOk);
}
$("#permBar").addEventListener("click", async () => {
  await checkPermission(true);
  if (!state.notifOk){
    $("#permBar").querySelector("span:last-child").textContent =
      "Abra Configurações › Apps › Hora do Remédio › Notificações e ative os avisos.";
  } else scheduleSoon();
});

/* ---------- telas ---------- */
function render(){
  document.querySelectorAll(".tab").forEach(b => {
    const on = b.dataset.tab === state.view || (state.view === "form" && b.dataset.tab === "remedios");
    if (on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
  const v = $("#view");
  if (state.view === "hoje") v.innerHTML = viewHoje();
  else if (state.view === "remedios") v.innerHTML = viewRemedios();
  else if (state.view === "historico") v.innerHTML = viewHistorico();
  else if (state.view === "form") { v.innerHTML = viewForm(); bindForm(); }
}

function emptyBox(){
  return '<div class="empty"><div class="pill-ico" style="margin:0 auto;width:4rem;height:4rem">'+PILL_SVG+'</div>'+
    '<h2>Nenhum remédio cadastrado</h2><p>Pegue a sua receita e cadastre cada remédio com a quantidade e os horários.</p>'+
    '<div class="stack"><button class="btn primary full" data-act="new">+ Cadastrar remédio</button></div></div>';
}

function doseCard(d){
  const s = statusOf(d), m = d.med;
  let act;
  if (s === "taken"){
    const at = new Date(state.log[d.key].at);
    act = '<div class="taken-row"><span>✓ Tomado às '+pad(at.getHours())+":"+pad(at.getMinutes())+'</span><button class="linkbtn" data-act="undo" data-key="'+esc(d.key)+'">Desfazer</button></div>';
  } else {
    act = '<button class="btn take full" data-act="take" data-key="'+esc(d.key)+'">✓ Tomei</button>';
  }
  return '<div class="dose s-'+s+'">'+
    '<div class="dose-time">'+d.time+'</div>'+
    '<div class="dose-body">'+thumb(m)+'<div style="min-width:0">'+
      '<div class="dose-name">'+esc(m.name)+'</div>'+
      '<div class="dose-qty">Tomar <b>'+esc(doseText(m))+'</b></div>'+
      (m.notes ? '<div class="dose-note">'+esc(m.notes)+'</div>' : '')+
      (s === "late" ? '<span class="tag late">Ainda não marcado</span>' : '')+
    '</div></div>'+
    '<div class="dose-act">'+act+'</div></div>';
}

function viewHoje(){
  if (!state.meds.length) return emptyBox();
  const doses = dosesFor(new Date()), nm = nowMin();
  if (!doses.length) return '<div class="hero done"><div class="lbl">Hoje</div><div class="big">Nenhum remédio para hoje</div></div>';
  const taken = doses.filter(d => state.log[d.key]).length;
  const late = doses.filter(d => statusOf(d) === "late");
  const next = doses.find(d => statusOf(d) === "pending");
  let hero;
  if (late.length){
    const d = late[late.length-1];
    hero = '<div class="hero late"><div class="lbl">Atenção</div><div class="big">'+esc(d.med.name)+' das '+d.time+' ainda não foi marcado</div>'+
      '<div class="sub">'+(late.length > 1 ? "São "+late.length+" doses sem marcar hoje. " : "")+'Se já tomou, toque em “Tomei”.</div>';
  } else if (next){
    hero = '<div class="hero next"><div class="lbl">Próximo remédio</div><div class="big">'+next.time+' · '+esc(next.med.name)+'</div>'+
      '<div class="sub">Tomar '+esc(doseText(next.med))+' — '+untilText(toMin(next.time)-nm)+'</div>';
  } else {
    hero = '<div class="hero done"><div class="lbl">Tudo certo</div><div class="big">Você tomou todos os remédios de hoje ✓</div>';
  }
  hero += '<div class="progress"><div class="bar"><i style="width:'+Math.round(taken/doses.length*100)+'%"></i></div><p>'+taken+' de '+doses.length+' doses tomadas hoje</p></div></div>';

  const groups = [["Madrugada",0,300],["Manhã",300,720],["Tarde",720,1080],["Noite",1080,1440]];
  let html = hero;
  for (const [name,a,b] of groups){
    const g = doses.filter(d => { const t = toMin(d.time); return t >= a && t < b; });
    if (!g.length) continue;
    html += '<h3 class="period">'+name+'</h3>'+g.map(doseCard).join("");
  }
  return html;
}

function viewRemedios(){
  let html = '<h2 class="sec" style="margin-top:.2rem">Meus remédios</h2>';
  if (!state.meds.length) return html + emptyBox() + privacyNote();
  html += '<button class="btn primary full" data-act="new" style="margin-bottom:1rem">+ Cadastrar remédio</button>';
  for (const m of state.meds){
    const period = m.continuous ? "Uso contínuo" : (m.end ? "Até "+m.end.split("-").reverse().join("/") : "");
    html += '<div class="med"><div class="med-top">'+thumb(m)+'<div style="min-width:0">'+
      '<div class="dose-name">'+esc(m.name)+'</div>'+
      '<div class="dose-qty">'+esc(doseText(m))+' · '+m.times.length+'× ao dia</div>'+
      (m.notes ? '<div class="dose-note">'+esc(m.notes)+'</div>' : '')+
      '</div></div>'+
      '<div class="chips">'+m.times.map(t => '<span class="chip">'+t+'</span>').join("")+'</div>'+
      (period ? '<div class="med-meta">'+esc(period)+'</div>' : '')+
      '<div class="med-actions"><button class="btn ghost small" data-act="edit" data-id="'+m.id+'">Editar</button>'+
      '<button class="btn ghost small" data-act="del" data-id="'+m.id+'">Excluir</button></div>'+
      (state.confirmDel === m.id ? '<div class="confirm"><p>Excluir '+esc(m.name)+'?</p><div class="row">'+
        '<button class="btn danger small" data-act="delyes" data-id="'+m.id+'">Sim, excluir</button>'+
        '<button class="btn ghost small" data-act="delno">Cancelar</button></div></div>' : '')+
      '</div>';
  }
  html += '<button class="btn ghost full" data-act="test" style="margin-top:.4rem">🔔 Testar o aviso (toca em 10 segundos)</button>';
  html += '<div class="note">Cadastre exatamente como está na receita. Este app só lembra os horários e não substitui as orientações do seu médico ou farmacêutico.</div>';
  html += '<div class="note">Se os avisos chegarem atrasados, abra Configurações › Apps › Hora do Remédio › Bateria e escolha <b>Sem restrições</b>.</div>';
  return html + privacyNote();
}
const privacyNote = () => '<div class="sync">Seus dados ficam guardados só neste celular.</div>';

function viewHistorico(){
  if (!state.meds.length) return emptyBox();
  let html = '<h2 class="sec" style="margin-top:.2rem">Últimos 7 dias</h2>';
  const today = new Date();
  for (let i = 0; i < 7; i++){
    const d = new Date(today); d.setHours(12,0,0,0); d.setDate(d.getDate()-i);
    let doses = dosesFor(d);
    if (i === 0) doses = doses.filter(x => toMin(x.time) <= nowMin() || state.log[x.key]);
    const taken = doses.filter(x => state.log[x.key]).length;
    const missed = doses.filter(x => !state.log[x.key]);
    const name = i === 0 ? "Hoje (até agora)" : i === 1 ? "Ontem" : longDate(d);
    const pct = doses.length ? Math.round(taken/doses.length*100) : 0;
    html += '<div class="day"><div class="day-top"><span class="day-name">'+name+'</span>'+(doses.length ? '<span class="day-score">'+taken+' / '+doses.length+'</span>' : '')+'</div>'+
      (doses.length ? '<div class="bar"><i style="width:'+pct+'%;background:'+(pct===100?"var(--ok)":pct>=50?"#C28A1C":"var(--late)")+'"></i></div>' : '')+
      (!doses.length ? '<div class="med-meta">Nenhuma dose prevista</div>' :
        missed.length ? '<div class="missed">Não marcado: '+missed.map(x => esc(x.med.name)+" ("+x.time+")").join(", ")+'</div>' :
        '<div class="allok">Todas as doses tomadas ✓</div>')+
      '</div>';
  }
  html += '<div class="note">Você pode mostrar esta tela ao seu médico na próxima consulta.</div>';
  return html;
}

/* ---------- formulário ---------- */
function blankForm(){
  return { id:null, name:"", qty:1, unit:"comprimido", mode:"intervalo", interval:12, first:"08:00", times:["08:00","20:00"],
    notes:"", start: ymd(new Date()), continuous:true, end:"", photo:null, errors:{} };
}
function viewForm(){
  const f = state.form;
  const unitOpts = Object.keys(UNITS).map(k => '<option value="'+k+'"'+(f.unit===k?" selected":"")+'>'+UNITS[k][1]+'</option>').join("");
  const intOpts = [4,6,8,12,24].map(h => '<option value="'+h+'"'+(Number(f.interval)===h?" selected":"")+'>de '+h+' em '+h+' horas'+(h===24?" (1× ao dia)":"")+'</option>').join("");
  return '<h2 class="sec" style="margin-top:.2rem">'+(f.id ? "Editar remédio" : "Cadastrar remédio")+'</h2>'+
  '<form class="form" id="medForm" novalidate>'+
    '<div class="field"><label for="fName">Nome do remédio</label><div class="hint">Como está escrito na receita (ex.: Losartana 50 mg)</div>'+
      '<input class="inp" id="fName" autocomplete="off" autocapitalize="words" value="'+esc(f.name)+'">'+(f.errors.name?'<div class="err">'+f.errors.name+'</div>':'')+'</div>'+

    '<div class="field"><div class="lab">Foto da caixa ou do comprimido (opcional)</div><div class="hint">Ajuda a reconhecer o remédio certo</div>'+
      '<div class="photo-row">'+(f.photo?'<img class="photo-prev" src="'+esc(f.photo)+'" alt="Foto do remédio">':'')+
      '<label class="btn ghost small" for="fPhoto">'+(f.photo?"Trocar foto":"📷 Adicionar foto")+'</label>'+
      (f.photo?'<button type="button" class="linkbtn" id="fPhotoDel">Remover</button>':'')+
      '<input class="fileinp" type="file" id="fPhoto" accept="image/*"></div></div>'+

    '<div class="field"><div class="lab">Quanto tomar em cada horário</div>'+
      '<div class="row"><input class="inp" id="fQty" type="number" inputmode="decimal" min="0.5" step="0.5" value="'+esc(f.qty)+'" style="max-width:7rem" aria-label="Quantidade">'+
      '<select class="inp" id="fUnit" aria-label="Unidade">'+unitOpts+'</select></div>'+(f.errors.qty?'<div class="err">'+f.errors.qty+'</div>':'')+'</div>'+

    '<div class="field"><div class="lab">Horários</div>'+
      '<div class="seg" role="group" aria-label="Como informar os horários">'+
        '<button type="button" data-mode="intervalo" aria-pressed="'+(f.mode==="intervalo")+'">De tantas em tantas horas</button>'+
        '<button type="button" data-mode="manual" aria-pressed="'+(f.mode==="manual")+'">Escolher os horários</button></div>'+
      '<div id="modeInt" class="'+(f.mode==="intervalo"?"":"hidden")+'">'+
        '<div class="row"><select class="inp" id="fInterval" aria-label="Intervalo">'+intOpts+'</select></div>'+
        '<div class="row" style="margin-top:.6rem"><label for="fFirst" style="font-weight:700">Primeira dose do dia às</label><input class="inp" type="time" id="fFirst" value="'+esc(f.first)+'" style="max-width:9rem"></div></div>'+
      '<div id="modeMan" class="'+(f.mode==="manual"?"":"hidden")+'">'+
        '<div class="row"><input class="inp" type="time" id="fNewTime" value="08:00" style="max-width:9rem" aria-label="Novo horário"><button type="button" class="btn primary small" id="fAddTime">+ Adicionar</button></div></div>'+
      '<div class="timesbox"><div class="lab">O aviso vai tocar às:</div><div class="chips" id="fChips"></div></div>'+
      (f.errors.times?'<div class="err">'+f.errors.times+'</div>':'')+'</div>'+

    '<div class="field"><label for="fNotes">Observações (opcional)</label><div class="hint">Ex.: em jejum, junto com o almoço, não partir o comprimido</div>'+
      '<textarea class="inp" id="fNotes">'+esc(f.notes)+'</textarea></div>'+

    '<div class="field"><div class="lab">Por quanto tempo</div>'+
      '<div class="row"><label for="fStart">Começar em</label><input class="inp" type="date" id="fStart" value="'+esc(f.start)+'" style="max-width:12rem"></div>'+
      '<label class="check"><input type="checkbox" id="fCont"'+(f.continuous?" checked":"")+'> Uso contínuo (sem data para parar)</label>'+
      '<div class="row '+(f.continuous?"hidden":"")+'" id="fEndRow"><label for="fEnd">Último dia</label><input class="inp" type="date" id="fEnd" value="'+esc(f.end)+'" style="max-width:12rem"></div>'+
      (f.errors.end?'<div class="err">'+f.errors.end+'</div>':'')+'</div>'+

    '<div class="form-actions"><button type="submit" class="btn primary full">Salvar remédio</button>'+
      '<button type="button" class="btn ghost full" data-act="cancel">Cancelar</button></div>'+
  '</form>';
}
function genTimes(first, every){
  const s = toMin(first || "08:00"), out = [];
  for (let k = 0; k < 24/every; k++) out.push(fromMin((s + k*every*60) % 1440));
  return Array.from(new Set(out)).sort();
}
function renderChips(){
  const f = state.form, el = $("#fChips"); if (!el) return;
  el.innerHTML = f.times.length ? f.times.map(t => '<span class="chip">'+t+'<button type="button" aria-label="Remover '+t+'" data-rm="'+t+'">×</button></span>').join("")
    : '<span class="med-meta">Nenhum horário ainda</span>';
}
function readForm(){
  const f = state.form;
  f.name = $("#fName").value.trim();
  f.qty = parseFloat(String($("#fQty").value).replace(",", "."));
  f.unit = $("#fUnit").value;
  f.notes = $("#fNotes").value.trim();
  f.start = $("#fStart").value || ymd(new Date());
  f.continuous = $("#fCont").checked;
  f.end = $("#fEnd").value;
  if ($("#fInterval")) f.interval = Number($("#fInterval").value);
  if ($("#fFirst")) f.first = $("#fFirst").value;
}
function bindForm(){
  const f = state.form;
  renderChips();
  const regen = () => { if (state.form.mode === "intervalo"){ f.interval = Number($("#fInterval").value); f.first = $("#fFirst").value || "08:00"; f.times = genTimes(f.first, f.interval); renderChips(); } };
  $("#fInterval").addEventListener("change", regen);
  $("#fFirst").addEventListener("change", regen);
  document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
    readForm(); f.mode = b.dataset.mode;
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $("#modeInt").classList.toggle("hidden", f.mode !== "intervalo");
    $("#modeMan").classList.toggle("hidden", f.mode !== "manual");
    if (f.mode === "intervalo") regen();
  }));
  $("#fAddTime").addEventListener("click", () => {
    const t = $("#fNewTime").value; if (!t) return;
    if (!f.times.includes(t)) f.times.push(t);
    f.times.sort(); renderChips();
  });
  $("#fChips").addEventListener("click", e => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    f.times = f.times.filter(t => t !== b.dataset.rm); renderChips();
  });
  $("#fCont").addEventListener("change", e => $("#fEndRow").classList.toggle("hidden", e.target.checked));
  $("#fPhoto").addEventListener("change", e => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    readForm();
    shrinkImage(file).then(url => { f.photo = url; render(); }).catch(() => {});
  });
  const del = $("#fPhotoDel"); if (del) del.addEventListener("click", () => { readForm(); f.photo = null; render(); });
  $("#medForm").addEventListener("submit", e => { e.preventDefault(); saveForm(); });
}
function shrinkImage(file){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const max = 240, r = Math.min(1, max/Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width*r); c.height = Math.round(img.height*r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      try { res(c.toDataURL("image/jpeg", 0.72)); } catch(err){ rej(err); }
    };
    img.onerror = rej; img.src = url;
  });
}
function saveForm(){
  readForm();
  const f = state.form, errs = {};
  if (!f.name) errs.name = "Escreva o nome do remédio.";
  if (!(f.qty > 0)) errs.qty = "Informe a quantidade (ex.: 1, 0,5 ou 20).";
  if (!f.times.length) errs.times = "Adicione pelo menos um horário.";
  if (!f.continuous && (!f.end || f.end < f.start)) errs.end = "O último dia precisa ser depois do início.";
  f.errors = errs;
  if (Object.keys(errs).length){ render(); const first = document.querySelector(".err"); if (first) first.scrollIntoView({block:"center"}); return; }
  const med = { id: f.id || uid(), name: f.name, qty: f.qty, unit: f.unit, times: f.times.slice().sort(), mode: f.mode,
    interval: f.interval, first: f.first, notes: f.notes, start: f.start, continuous: f.continuous, end: f.continuous ? "" : f.end, photo: f.photo, createdAt: f.createdAt || Date.now() };
  const i = state.meds.findIndex(m => m.id === med.id);
  if (i >= 0) state.meds[i] = med; else state.meds.push(med);
  state.meds.sort((a,b) => a.name.localeCompare(b.name, "pt-BR"));
  persist("meds");
  state.form = null; state.view = "remedios"; render(); window.scrollTo(0,0);
  checkPermission(true);
  check();
}

/* ---------- ações ---------- */
function markTaken(key, save){
  if (key.indexOf("teste|") === 0){ alarmDone(key); return; }
  state.log[key] = { at: Date.now() };
  delete state.snooze[key];
  alarmDone(key);
  if (save !== false){ persist("log"); if (state.view !== "form") render(); }
}
function snoozeKeys(keys){
  const until = Date.now() + 10*60*1000;
  for (const k of keys){ if (k.indexOf("teste|") === 0) continue; state.snooze[k] = until; alerted.delete(k); }
  persist("snooze");
}

document.addEventListener("click", e => {
  const tab = e.target.closest(".tab");
  if (tab){ state.view = tab.dataset.tab; state.form = null; state.confirmDel = null; render(); window.scrollTo(0,0); return; }
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act;
  if (act === "take") markTaken(b.dataset.key);
  else if (act === "undo"){ delete state.log[b.dataset.key]; persist("log"); render(); }
  else if (act === "new"){ state.form = blankForm(); state.view = "form"; render(); window.scrollTo(0,0); }
  else if (act === "edit"){
    const m = state.meds.find(x => x.id === b.dataset.id); if (!m) return;
    state.form = Object.assign(blankForm(), JSON.parse(JSON.stringify(m)), { errors:{} });
    if (!state.form.mode) state.form.mode = "manual";
    state.view = "form"; render(); window.scrollTo(0,0);
  }
  else if (act === "cancel"){ state.form = null; state.view = "remedios"; render(); }
  else if (act === "del"){ state.confirmDel = b.dataset.id; render(); }
  else if (act === "delno"){ state.confirmDel = null; render(); }
  else if (act === "delyes"){ state.meds = state.meds.filter(m => m.id !== b.dataset.id); state.confirmDel = null; persist("meds"); render(); }
  else if (act === "test") testAlarm(b);
});

async function testAlarm(btn){
  unlockAudio();
  const m = state.meds[0] || { id:"x", name:"Remédio de teste", qty:1, unit:"comprimido", notes:"" };
  if (LN){
    await checkPermission(true);
    try {
      await LN.schedule({ notifications: [{ id: 998, title: "💊 Teste do aviso", body: m.name+" — "+doseText(m),
        schedule: { at: new Date(Date.now()+10000), allowWhileIdle: true }, channelId: CHANNEL,
        smallIcon: "ic_stat_pill", iconColor: "#0E5A57", foreground: true }] });
      btn.textContent = "✓ Aviso marcado — bloqueie a tela e aguarde 10 segundos";
      return;
    } catch(e){}
  }
  const n = new Date();
  showAlarm([{ key: "teste|"+Date.now(), med: m, time: pad(n.getHours())+":"+pad(n.getMinutes()) }], true);
}

$("#fontBtn").addEventListener("click", () => {
  const on = document.documentElement.classList.toggle("big");
  LS.set("hr_big", on);
});

/* ---------- som e voz (com o app aberto) ---------- */
let actx = null;
function unlockAudio(){
  try {
    if (!actx){ const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
    if (actx && actx.state === "suspended") actx.resume();
  } catch(e){}
}
document.addEventListener("pointerdown", unlockAudio);
function beep(){
  unlockAudio();
  if (!actx) return;
  try {
    const t = actx.currentTime;
    [[0,784],[0.32,988],[0.64,1175]].forEach(([o,f]) => {
      const osc = actx.createOscillator(), g = actx.createGain();
      osc.type = "triangle"; osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t+o);
      g.gain.exponentialRampToValueAtTime(0.6, t+o+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t+o+0.28);
      osc.connect(g); g.connect(actx.destination);
      osc.start(t+o); osc.stop(t+o+0.3);
    });
  } catch(e){}
  try { if (navigator.vibrate) navigator.vibrate([400,150,400]); } catch(e){}
}
async function speak(text){
  if (TTS){ try { await TTS.speak({ text, lang: "pt-BR", rate: 0.9, volume: 1.0 }); return; } catch(e){} }
  try {
    if ("speechSynthesis" in window){
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = "pt-BR"; u.rate = 0.9;
      speechSynthesis.speak(u);
    }
  } catch(e){}
}
function stopSpeak(){
  if (TTS) TTS.stop().catch(() => {});
  try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch(e){}
}

/* ---------- alarme dentro do app ---------- */
let alarmItems = [], beepTimer = null;
const alerted = new Set();
function alarmSpeech(){
  return "Hora do remédio. " + alarmItems.map(d => d.med.name + ". Tomar " + doseSpeech(d.med) + (d.med.notes ? ". " + d.med.notes : "")).join(". ") + ".";
}
function renderAlarm(){
  $("#alarmWhen").textContent = alarmItems.length === 1 ? "Dose das " + alarmItems[0].time : alarmItems.length + " remédios para tomar";
  $("#alarmList").innerHTML = alarmItems.map(d =>
    '<div class="aitem"><div class="top">'+thumb(d.med)+'<div><div class="nm">'+esc(d.med.name)+'</div>'+
    '<div class="qt">Tomar <b>'+esc(doseText(d.med))+'</b></div>'+(d.med.notes?'<div class="nt">'+esc(d.med.notes)+'</div>':'')+'</div></div>'+
    '<button class="btn take full" data-act="take" data-key="'+esc(d.key)+'">✓ Tomei</button></div>').join("");
}
function showAlarm(list, quiet){
  for (const d of list){ if (!alarmItems.some(x => x.key === d.key)) alarmItems.push(d); alerted.add(d.key); }
  if (!alarmItems.length) return;
  renderAlarm();
  const ov = $("#alarm");
  const wasHidden = ov.classList.contains("hidden");
  ov.classList.remove("hidden");
  clearInterval(beepTimer);
  if (!quiet){ beep(); beepTimer = setInterval(beep, 3000); }
  if (wasHidden) setTimeout(() => speak(alarmSpeech()), quiet ? 400 : 1200);
}
function closeAlarm(){
  $("#alarm").classList.add("hidden");
  clearInterval(beepTimer); beepTimer = null;
  stopSpeak();
}
function alarmDone(key){
  const before = alarmItems.length;
  alarmItems = alarmItems.filter(d => d.key !== key);
  if (before === alarmItems.length) return;
  if (!alarmItems.length) closeAlarm(); else renderAlarm();
}
$("#snoozeBtn").addEventListener("click", () => {
  snoozeKeys(alarmItems.map(d => d.key));
  alarmItems = []; closeAlarm();
});
$("#speakBtn").addEventListener("click", () => speak(alarmSpeech()));

function check(){
  const nm = nowMin(), now = Date.now();
  const due = dosesFor(new Date()).filter(d => {
    if (state.log[d.key]) return false;
    const t = toMin(d.time);
    if (t > nm || nm - t > 180) return false;
    const sz = state.snooze[d.key];
    if (sz && now < sz) return false;
    if (alerted.has(d.key)) return false;
    return true;
  });
  if (due.length) showAlarm(due, false);
}

/* ---------- relógio e ciclo de vida ---------- */
let lastMin = -1;
function tick(){
  const d = new Date();
  $("#clock").textContent = pad(d.getHours())+":"+pad(d.getMinutes());
  $("#date").textContent = longDate(d);
  const m = d.getHours()*60+d.getMinutes();
  if (m !== lastMin){
    lastMin = m;
    if (state.view === "hoje" || state.view === "historico") render();
    check();
  }
}
setInterval(tick, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden){ lastMin = -1; tick(); } });

if (AppP){
  try {
    AppP.addListener("appStateChange", s => {
      if (s && s.isActive){ lastMin = -1; tick(); checkPermission(false); scheduleSoon(); }
    });
    AppP.addListener("backButton", () => {
      if (!$("#alarm").classList.contains("hidden")) return;
      if (state.view === "form"){ state.form = null; state.view = "remedios"; render(); }
      else if (state.view !== "hoje"){ state.view = "hoje"; state.confirmDel = null; render(); }
      else AppP.minimizeApp().catch(() => AppP.exitApp());
    });
  } catch(e){}
}

(async function start(){
  render(); tick();
  await loadData();
  render(); lastMin = -1; tick();
  await setupNotifications();
  scheduleSoon();
})();
})();
