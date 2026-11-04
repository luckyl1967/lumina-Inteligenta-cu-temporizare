import {initializeApp, deleteApp} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {getDatabase, ref, onValue, update, runTransaction, goOffline} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';

const $ = id => document.getElementById(id);
const KEY = 'lumina.settings.v1';
const ADMIN_DEVICE_KEY = 'lumina.adminDevice';

// Praguri afișare (trebuie să corespundă firmware-ului)
const TEMP_STOP = 70, TEMP_RECOVER = 50, TEMP_STALE_MS = 60000;

let saved = null, app = null, auth = null, db = null;
let rooms = [], selected = '', connected = false, user = null, ready = false, busy = false, offset = 0;
let isAdmin = false, authResolved = false, view = 'home', setupMode = false;
let unsubs = [], authUnsub = null, generation = 0;
const timerDrafts = new Map();
const TIMER_ZONES = ['Europe/Bucharest','Europe/Madrid','Atlantic/Canary','Europe/London','UTC'];
const timerKey = room => generation + ':' + room.id;
function timerDefaults(room) {
  const cfg = room.led_timer || {};
  const done = cfg.id && room.timer_state?.id === cfg.id && room.timer_state.status === 'done';
  let detected;
  try { detected=Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  return {
    enabled: cfg.enabled === true && !done, mode: cfg.mode === 'daily' ? 'daily' : 'delay',
    hours: String(cfg.hours ?? 1), action: cfg.action === 'on' ? 'on' : 'off',
    start: cfg.start || '20:00', stop: cfg.stop || '23:00',
    timezone: TIMER_ZONES.includes(cfg.timezone) ? cfg.timezone : TIMER_ZONES.includes(detected) ? detected : 'Europe/Bucharest',
    baseId: cfg.id || '', dirty:false, saving:false, conflict:false, pendingId:''
  };
}
function timerDraft(room) {
  const key=timerKey(room);
  let d=timerDrafts.get(key);
  if(!d || (!d.dirty && !d.saving)) {
    d=timerDefaults(room); timerDrafts.set(key,d);
  } else if((room.led_timer?.id || '')!==d.baseId && room.led_timer?.id!==d.pendingId) d.conflict=true;
  return d;
}
function renderTimer(room) {
  const d=timerDraft(room), cfg=room.led_timer || {}, state=room.timer_state || {};
  const supported=room.timer_supported===true, ctl=canControl(room) && supported;
  const set=(id,value)=>{if($(id).value!==value) $(id).value=value;};
  $('timerEnabled').checked=d.enabled;
  $('timerEnabledText').textContent=d.enabled?'ON':'OFF';
  $('timerEnabled').disabled=!ctl || d.saving;
  for(const [id,value] of [['timerHours',d.hours],['timerAction',d.action],['timerStart',d.start],['timerStop',d.stop],['timerTimezone',d.timezone]]) set(id,value);
  $('delayMode').setAttribute('aria-pressed',String(d.mode==='delay'));
  $('dailyMode').setAttribute('aria-pressed',String(d.mode==='daily'));
  $('delayFields').hidden=d.mode!=='delay';
  $('dailyFields').hidden=d.mode!=='daily';
  for(const id of ['delayMode','dailyMode','timerHours','timerAction','timerStart','timerStop','timerTimezone'])
    $(id).disabled=!ctl || d.saving || (['timerStart','timerStop','timerTimezone'].includes(id)?d.mode!=='daily':false) ||
      (['timerHours','timerAction'].includes(id) && d.mode!=='delay');
  $('timerHours').required=d.enabled && d.mode==='delay';
  $('timerStart').required=$('timerStop').required=d.enabled && d.mode==='daily';
  $('timerSave').disabled=!ctl || d.saving || d.conflict;
  $('timerSave').textContent=d.saving?'Se salvează…':d.enabled && d.mode==='delay'?'Pornește / repornește întârzierea':'Salvează temporizarea';
  $('timerReload').hidden=!d.dirty;
  $('timerReload').disabled=d.saving;
  $('timerDraftNote').hidden=!d.dirty;
  $('timerDraftNote').textContent=d.conflict?'Setările au fost schimbate de altă sesiune. Reîncarcă înainte să salvezi.':'Modificări nesalvate. ON/OFF se aplică după apăsarea butonului de salvare.';
  $('timerHint').textContent=d.mode==='delay'
    ? 'O singură execuție, după 0,01–720 ore. Comenzile manuale nu anulează întârzierea; pentru anulare salvează OFF.'
    : 'Zilnic, inclusiv peste miezul nopții. La activare se aplică starea intervalului curent. Comanda manuală rămâne până la următoarea pornire sau oprire programată.';
  let text='', cls='';
  const matches=!!cfg.id && state.id===cfg.id;
  if(!supported) { text='Necesită firmware v6 pe ESP pentru temporizare. Comenzile manuale rămân disponibile.'; cls='warn'; }
  else if(!cfg.id) text='Temporizare dezactivată.';
  else if(!matches) { text='Setări trimise în Firebase; ESP-ul nu a confirmat încă primirea.'; cls='warn'; }
  else if(state.status==='waiting_clock') { text='Salvată pe ESP. Așteaptă sincronizarea orei prin internet.'; cls='warn'; }
  else if(state.status==='storage_error') { text='Eroare de memorie pe ESP. Temporizarea nu este activă; verifică logul dispozitivului.'; cls='warn'; }
  else if(state.status==='invalid') { text='ESP-ul a respins setările. Temporizarea nu este activă.'; cls='warn'; }
  else if(state.status==='done') { text='Întârziere executată. Activează ON și salvează pentru o nouă execuție.'; cls='ok'; }
  else if(state.status==='disabled') text='Temporizare dezactivată pe ESP.';
  else if(state.status==='daily') { text=`Confirmat pe ESP · zilnic ${cfg.start}–${cfg.stop} · ${cfg.timezone}.`; cls='ok'; }
  else if(state.status==='armed') {
    const left=Math.max(0,Math.ceil((Number(cfg.due_at)-Date.now()-offset)/1000));
    const duration=`${Math.floor(left/3600)} h ${Math.floor(left%3600/60)} min ${left%60} s`;
    text=left>0?`Confirmat pe ESP · ${cfg.action==='on'?'Aprinde':'Stinge'} peste aproximativ ${duration}.`:'Termen atins; așteaptă confirmarea executării de la ESP.';
    cls=left>0?'ok':'warn';
  } else { text='ESP-ul nu a confirmat o stare cunoscută.'; cls='warn'; }
  if(supported && presence(room)!=='online') { text+=' ESP-ul nu comunică recent; ultima confirmare nu dovedește că execută acum.'; cls='warn'; }
  $('timerStatus').textContent=text;
  $('timerStatus').className='timer-status '+cls;
}
function editTimer(field,value) {
  const room=current(); if(!room) return;
  const d=timerDraft(room);
  d[field]=value; d.dirty=true;
  renderTimer(room);
}
async function saveTimerFromForm(event) {
  event.preventDefault();
  const room=current(); if(!room || !canControl(room) || room.timer_supported!==true) return;
  const d=timerDraft(room); if(d.saving || d.conflict) return;
  let hours=Number(d.hours);
  if(!Number.isFinite(hours) || hours<0.01 || hours>720) {
    if(d.enabled && d.mode==='delay') return notify('Alege un număr de ore între 0,01 și 720.',true);
    hours=1;
  }
  const validTime=s=>typeof s==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  if(d.enabled && d.mode==='daily' && (!validTime(d.start) || !validTime(d.stop))) return notify('Completează orele de pornire și oprire.',true);
  if(d.enabled && d.mode==='daily' && d.start===d.stop) return notify('Ora de pornire trebuie să fie diferită de ora de oprire.',true);
  const id=globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const due=(Math.floor((Date.now()+offset)/1000)+Math.ceil(hours*3600))*1000;
  const payload={id,enabled:d.enabled,mode:d.mode,action:d.action,hours,
    due_at:d.mode==='delay'?due:0,start:validTime(d.start)?d.start:'20:00',stop:validTime(d.stop)?d.stop:'23:00',timezone:d.timezone};
  const gen=generation, uid=user?.uid, name=room.nume || room.id;
  d.saving=true;d.pendingId=id;renderTimer(room);
  try {
    await update(ref(db,saved.root+'/'+room.id),{led_timer:payload});
    if(generation!==gen || user?.uid!==uid) return;
    d.saving=false;d.dirty=false;d.conflict=false;d.baseId=id;d.pendingId='';
    notify('Setări trimise pentru '+name+'. Urmărește confirmarea ESP-ului.');
  } catch(e) {
    if(generation!==gen || user?.uid!==uid) return;
    d.saving=false;d.pendingId='';
    notify('Temporizare nesalvată: '+e.message,true);
  }
  if(generation===gen && user?.uid===uid && current()) renderTimer(current());
}

// ---------------------------------------------------------------- utilitare
function notify(text, error = false) {
  const m = $('message');
  m.textContent = text; m.className = error ? 'error' : ''; m.style.display = 'block';
  clearTimeout(notify.timer); notify.timer = setTimeout(() => m.style.display = 'none', 7000);
}
const validKey = s => typeof s === 'string' && /^[a-z0-9_-]{1,64}$/.test(s);
const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
const b64enc = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64dec = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const adminDevice = () => localStorage.getItem(ADMIN_DEVICE_KEY) === '1';

function parseConfig(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw Error('Lipsește obiectul firebaseConfig.');
  const body = text.slice(start, end + 1);
  let out;
  try { out = JSON.parse(body); } catch {
    out = {};
    const re = /(?:["']?(apiKey|authDomain|databaseURL|projectId|storageBucket|messagingSenderId|appId|measurementId)["']?)\s*:\s*(["'])(.*?)\2/g;
    for (const m of body.matchAll(re)) out[m[1]] = m[3];
  }
  const clean = {};
  for (const k of ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId','measurementId'])
    if (typeof out[k] === 'string') clean[k] = out[k].trim();
  for (const k of ['apiKey','authDomain','databaseURL','projectId'])
    if (!clean[k]) throw Error('Lipsește câmpul ' + k);
  const url = new URL(clean.databaseURL);
  if (url.protocol !== 'https:' || !/(\.firebaseio\.com|\.firebasedatabase\.app)$/.test(url.hostname))
    throw Error('databaseURL trebuie să fie URL-ul HTTPS al Firebase RTDB.');
  if (!/^[a-z0-9.-]+\.firebaseapp\.com$/.test(clean.authDomain)) throw Error('authDomain invalid.');
  return clean;
}

function validateSettings(s) {
  if (!s || !validKey(s.root)) throw Error('Configurație invalidă.');
  s.firebase = parseConfig(JSON.stringify(s.firebase));
  return {client: String(s.client || '').slice(0, 80), root: s.root, firebase: s.firebase, allowUnknown: !!s.allowUnknown};
}

// ---------------------------------------------------------------- stare cameră
const current = () => rooms.find(x => x.id === selected);

function presence(room) {
  const t = room?.last_seen;
  if (typeof t !== 'number' || t <= 0) return 'unknown';
  const age = Date.now() + offset - t;
  return age >= -15000 && age <= 90000 ? 'online' : 'offline';
}
function canControl(room) {
  const p = presence(room);
  return !!room && !!user && connected && ready && !busy && (p === 'online' || (p === 'unknown' && saved?.allowUnknown));
}

function renderTemperature(room) {
  const t = room.temperatura;
  const ts = room.temperatura_actualizata;
  const hasTemp = typeof t === 'number' && isFinite(t);
  const age = typeof ts === 'number' ? Date.now() + offset - ts : Infinity;
  const fresh = hasTemp && room.senzor_ok !== false && age <= TEMP_STALE_MS;

  $('tempValue').textContent = hasTemp ? t.toFixed(1).replace('.', ',') : '--';
  $('tempValue').style.color = !fresh ? 'var(--muted)' : t >= TEMP_STOP ? 'var(--bad)' : t >= TEMP_RECOVER ? 'var(--warn)' : 'var(--text)';
  $('tempTime').textContent = !hasTemp ? 'Nicio citire primită'
    : room.senzor_ok === false ? 'Ultima citire validă; sonda este indisponibilă'
    : fresh ? 'Actualizat ' + new Date(ts).toLocaleTimeString('ro-RO')
    : 'Citire veche: ' + (typeof ts === 'number' ? new Date(ts).toLocaleString('ro-RO') : 'necunoscută');

  const blocked = room.protectie_termica === true;
  const reason = room.motiv_protectie || '';
  const known = typeof room.protectie_termica === 'boolean';
  let cls = 'idle', txt = 'Fără date', alert = '';

  if (!known) { cls = 'idle'; txt = 'Fără date'; }
  else if (blocked && reason === 'supratemperatura') {
    cls = 'bad'; txt = 'Supraîncălzire';
    alert = `Bandă oprită: temperatură ≥ ${TEMP_STOP} °C. Revine automat sub ${TEMP_RECOVER} °C.`;
    if (room.senzor_ok === false) alert += ' Sonda este indisponibilă; blocarea rămâne activă.';
  } else if (room.senzor_ok === false || reason === 'eroare_senzor') {
    cls = 'warn'; txt = 'Sondă indisponibilă';
    alert = blocked
      ? 'Bandă oprită de firmware: senzorul DS18B20 nu poate fi citit.'
      : 'Sonda DS18B20 nu poate fi citită. Banda nu este oprită automat; protecția nu poate detecta supraîncălzirea fără o temperatură validă.';
  } else if (blocked && reason === 'asteptare_senzor') {
    cls = 'warn'; txt = 'Așteaptă senzorul';
    alert = 'Bandă oprită până la prima citire validă a temperaturii.';
  } else if (blocked) {
    cls = 'bad'; txt = 'Protecție activă'; alert = 'Bandă oprită de protecția termică.';
  } else { cls = 'ok'; txt = 'Protecție OK'; }

  if (!fresh && known && cls === 'ok') { cls = 'warn'; txt = 'Date vechi'; }

  $('protBadge').className = 'badge ' + cls;
  $('protBadge').textContent = txt;
  $('protAlert').hidden = !alert;
  $('protAlert').textContent = alert;
  return {blocked, known};
}

function renderRoom(room) {
  const p = presence(room);
  $('roomName').textContent = room.nume || room.id;
  $('roomPosition').textContent = (rooms.findIndex(x => x.id === selected) + 1) + ' / ' + rooms.length;
  $('deviceDot').className = 'dot ' + (p === 'unknown' ? '' : p);
  $('deviceText').textContent = p === 'online' ? 'Dispozitiv online' : p === 'offline' ? 'Dispozitiv offline' : 'Prezență necunoscută';
  $('lastSeen').textContent = typeof room.last_seen === 'number' && room.last_seen > 0
    ? 'Ultima comunicare: ' + new Date(room.last_seen).toLocaleString('ro-RO') : '';
  $('deviceWarning').textContent = !connected ? 'Fără conexiune la internet.'
    : p === 'offline' ? 'Dispozitivul nu a comunicat recent; comenzile sunt dezactivate.'
    : (p === 'unknown' && !saved.allowUnknown) ? 'Dispozitivul nu a raportat încă prezența.' : '';

  const {blocked} = renderTemperature(room);
  const ctl = canControl(room);

  // Releu
  const r = room.releu === true, rb = $('relay');
  rb.textContent = r ? 'ON' : 'OFF'; rb.className = 'toggle' + (r ? ' on' : '');
  rb.setAttribute('aria-pressed', String(r)); rb.disabled = !ctl;

  // Bandă: led_on = cerere, led_efectiv = ieșire reală (dacă firmware-ul o publică)
  const req = room.led_on === true;
  const hasEff = typeof room.led_efectiv === 'boolean';
  const eff = hasEff ? room.led_efectiv : req;
  const lb = $('led');
  if (req && !eff) { lb.textContent = blocked ? 'BLOCAT' : 'ÎN AȘTEPTARE'; lb.className = 'toggle' + (blocked ? ' blocked' : ''); }
  else { lb.textContent = req ? 'ON' : 'OFF'; lb.className = 'toggle' + (req ? ' on' : ''); }
  lb.setAttribute('aria-pressed', String(req)); lb.disabled = !ctl;
  $('ledSub').textContent = req && !eff ? (blocked ? 'Cerere ON – oprită de protecție' : 'Cerere ON – așteaptă dispozitivul') : 'Iluminare ambientală';

  const level = Math.max(1, Math.min(5, Number(room.led_brightness) || 1));
  $('levelText').textContent = 'Nivel ' + level;
  [...$('levels').children].forEach((b, i) => {
    b.className = i + 1 === level ? 'selected' : '';
    b.disabled = !ctl;
    b.setAttribute('aria-pressed', String(i + 1 === level));
  });
  renderTimer(room);
}

// ---------------------------------------------------------------- randare ecrane
function render() {
  $('clientLabel').textContent = saved?.client || '';
  const loggedIn = !!user;
  const showSettings = setupMode || (loggedIn && isAdmin && view === 'settings');

  $('setup').hidden = !!saved || setupMode;
  $('login').hidden = !saved || setupMode || loggedIn || !authResolved;
  $('home').hidden = !saved || !loggedIn || showSettings;
  $('settings').hidden = !showSettings;
  $('adminNav').hidden = !(loggedIn && isAdmin) || setupMode;

  if (!loggedIn) { renderList(); return; }

  $('cloudDot').className = 'dot ' + (connected ? 'online' : 'offline');
  $('cloudText').textContent = connected ? 'Conectat' : 'Se conectează…';
  $('userText').textContent = user.email || '';
  $('accountEmail').textContent = user.email || '';
  $('addRoom').disabled = !connected || !ready || busy || !isAdmin;
  updateClientLink();

  const room = current();
  $('roomCard').hidden = !room;
  $('empty').hidden = !!room;
  $('emptyText').textContent = !ready ? 'Se încarcă…' : isAdmin ? 'Nu există camere. Adaugă una din Setări.' : 'Nu există camere configurate.';
  $('prev').hidden = $('next').hidden = rooms.length < 2;
  if (room) renderRoom(room);
  renderList();
}

function renderList() {
  const box = $('roomList');
  box.replaceChildren();
  if (!rooms.length) { box.textContent = 'Nicio cameră disponibilă.'; return; }
  for (const room of rooms) {
    const row = document.createElement('div'); row.className = 'roomitem';
    const d = document.createElement('div'), n = document.createElement('strong'), i = document.createElement('small');
    n.textContent = room.nume || room.id; i.textContent = 'ID: ' + room.id; d.append(n, i);
    const e = document.createElement('button'); e.textContent = 'Redenumește';
    e.disabled = !connected || !ready || busy; e.onclick = () => renameRoom(room);
    row.append(d, e); box.append(row);
  }
}

function updateClientLink() {
  if (!saved) { $('clientLink').value = ''; return; }
  const payload = b64enc(JSON.stringify({client: saved.client, root: saved.root, firebase: saved.firebase, allowUnknown: saved.allowUnknown}));
  $('clientLink').value = location.origin + location.pathname + '#setup=' + payload;
}

// ---------------------------------------------------------------- Firebase
function stopListeners() { unsubs.forEach(fn => fn()); unsubs = []; rooms = []; ready = false; connected = false; offset = 0; isAdmin = false; timerDrafts.clear(); }

async function switchProject(settings, {logoutOld = true} = {}) {
  const gen = ++generation;
  stopListeners();
  if (authUnsub) { authUnsub(); authUnsub = null; }
  user = null; authResolved = false;
  if (app) { if (logoutOld) { try { await signOut(auth); } catch {} } goOffline(db); await deleteApp(app); }
  saved = settings;
  app = initializeApp(settings.firebase, 'lumina-' + gen);
  auth = getAuth(app);
  db = getDatabase(app);
  // Sesiune persistentă: rămâi conectat după închiderea aplicației / fundal / repornire
  await setPersistence(auth, browserLocalPersistence);

  authUnsub = onAuthStateChanged(auth, u => {
    if (gen !== generation) return;
    stopListeners();
    user = u; authResolved = true;
    if (!u) { view = 'home'; render(); return; }

    unsubs.push(onValue(ref(db, '.info/connected'), s => { connected = s.val() === true; render(); }));
    unsubs.push(onValue(ref(db, '.info/serverTimeOffset'), s => { offset = Number(s.val()) || 0; }));

    // Administrator = UID în /admins sau aparatul pe care s-a făcut configurarea
    isAdmin = adminDevice();
    unsubs.push(onValue(ref(db, 'admins/' + u.uid), s => { isAdmin = s.val() === true || adminDevice(); if (!isAdmin) view = 'home'; render(); }, () => { isAdmin = adminDevice(); render(); }));

    unsubs.push(onValue(ref(db, settings.root), s => {
      const data = s.val() || {};
      rooms = Object.entries(data)
        .filter(([id, v]) => validKey(id) && v && typeof v === 'object' && !Array.isArray(v))
        .map(([id, v]) => ({...v, id}))
        .sort((a, b) => (Number(a.ordine) || 0) - (Number(b.ordine) || 0) || (a.nume || a.id).localeCompare(b.nume || b.id, 'ro'));
      if (!rooms.some(r => r.id === selected)) selected = rooms[0]?.id || '';
      ready = true; render();
    }, e => { ready = false; rooms = []; notify('Acces refuzat: ' + e.message, true); render(); }));
    render();
  });
  render();
}

// ---------------------------------------------------------------- acțiuni
async function renameRoom(room) {
  const name = prompt('Nume afișat pentru ' + room.id, room.nume || room.id)?.trim();
  if (!name) return;
  if (name.length > 60) return notify('Maximum 60 de caractere.', true);
  try { await update(ref(db, saved.root + '/' + room.id), {nume: name}); notify('Nume salvat.'); }
  catch (e) { notify(e.message, true); }
}

async function command(patch) {
  const room = current();
  if (!canControl(room)) return;
  const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => room[key] !== value));
  if (!Object.keys(changed).length) return;
  // onValue arata imediat cererea locala Firebase. Nu este confirmare de la ESP.
  // Nu blocam celelalte comenzi pana cand serverul confirma aceasta scriere.
  try { await update(ref(db, saved.root + '/' + room.id), changed); }
  catch (e) { notify('Comandă eșuată: ' + e.message, true); }
}

function navigate(n) {
  if (!rooms.length) return;
  const i = rooms.findIndex(x => x.id === selected);
  selected = rooms[(i + n + rooms.length) % rooms.length].id;
  render();
}

function fillForm(s) {
  $('client').value = s?.client || '';
  $('root').value = s?.root || 'luci';
  $('configText').value = s ? JSON.stringify(s.firebase, null, 2) : '';
  $('allowUnknown').checked = !!s?.allowUnknown;
}

// ---------------------------------------------------------------- evenimente
$('homeNav').onclick = () => { view = 'home'; render(); };
$('settingsNav').onclick = () => { view = 'settings'; fillForm(saved); render(); };
$('setupAdmin').onclick = () => { setupMode = true; fillForm(null); render(); };

$('configForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const root = $('root').value.trim();
    if (!validKey(root)) throw Error('ROOT_NODE: litere mici, cifre, _ sau -.');
    const settings = {client: $('client').value.trim(), root, firebase: parseConfig($('configText').value), allowUnknown: $('allowUnknown').checked};
    const sameProject = saved && saved.firebase.projectId === settings.firebase.projectId && saved.firebase.apiKey === settings.firebase.apiKey;
    if (saved && !sameProject && !confirm('Schimbi proiectul Firebase? Va trebui să te reconectezi.')) return;
    localStorage.setItem(KEY, JSON.stringify(settings));
    localStorage.setItem(ADMIN_DEVICE_KEY, '1');
    setupMode = false; view = 'settings';
    await switchProject(settings, {logoutOld: !sameProject});
    notify(sameProject ? 'Setări salvate.' : 'Proiect salvat. Conectează-te.');
  } catch (err) { notify(err.message, true); }
};

$('loginForm').onsubmit = async e => {
  e.preventDefault();
  if (!auth) return;
  const b = e.submitter; b.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
    $('password').value = ''; view = 'home';
  } catch (err) {
    const c = err.code || '';
    notify(c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') ? 'E-mail sau parolă incorectă.'
      : c.includes('too-many-requests') ? 'Prea multe încercări. Reîncearcă mai târziu.'
      : c.includes('network') ? 'Fără conexiune la internet.' : 'Conectare eșuată: ' + c, true);
  } finally { b.disabled = false; }
};

const doLogout = async () => { if (auth && confirm('Te deconectezi?')) { try { await signOut(auth); } catch (e) { notify(e.message, true); } } };
$('logout').onclick = doLogout;
$('logoutTop').onclick = doLogout;

$('copyLink').onclick = async () => {
  try { await navigator.clipboard.writeText($('clientLink').value); notify('Link copiat.'); }
  catch { $('clientLink').select(); notify('Selectează și copiază manual linkul.', true); }
};

$('prev').onclick = () => navigate(-1);
$('next').onclick = () => navigate(1);
let touchStart = null;
$('roomCard').addEventListener('touchstart', e => { touchStart = e.touches[0].clientX; }, {passive: true});
$('roomCard').addEventListener('touchend', e => {
  if (touchStart === null || e.target.closest('button,input,select,textarea,label,form')) return;
  const d = e.changedTouches[0].clientX - touchStart;
  if (Math.abs(d) > 70) navigate(d < 0 ? 1 : -1);
  touchStart = null;
}, {passive: true});

$('relay').onclick = () => command({releu: current()?.releu !== true});
$('led').onclick = () => command({led_on: current()?.led_on !== true});
for (let i = 1; i <= 5; i++) {
  const b = document.createElement('button');
  b.textContent = i; b.setAttribute('aria-label', 'Luminozitate nivel ' + i);
  b.onclick = () => command({led_brightness: i});
  $('levels').append(b);
}

$('addRoom').onclick = () => { if (!ready || !connected || !isAdmin) return; $('newName').value = ''; $('newId').value = ''; $('roomDialog').showModal(); };
$('newName').oninput = () => { $('newId').value = slug($('newName').value); };
$('cancelRoom').onclick = () => $('roomDialog').close();
$('timerForm').onsubmit=saveTimerFromForm;
$('timerEnabled').onchange=e=>editTimer('enabled',e.target.checked);
$('delayMode').onclick=()=>editTimer('mode','delay');
$('dailyMode').onclick=()=>editTimer('mode','daily');
for(const [id,field] of [['timerHours','hours'],['timerAction','action'],['timerStart','start'],['timerStop','stop'],['timerTimezone','timezone']])
  $(id).addEventListener('input',e=>editTimer(field,e.target.value));
$('timerReload').onclick=()=>{if(current()){timerDrafts.delete(timerKey(current()));renderTimer(current());}};
$('roomForm').onsubmit = async e => {
  e.preventDefault();
  const name = $('newName').value.trim(), id = $('newId').value.trim();
  if (!name || !validKey(id)) return notify('Nume sau ID invalid.', true);
  const b = e.submitter; b.disabled = true;
  try {
    const order = rooms.reduce((m, r) => Math.max(m, Number(r.ordine) || 0), -1) + 1;
    const result = await runTransaction(ref(db, saved.root + '/' + id),
      ex => ex === null ? {nume: name, ordine: order, releu: false, led_on: false, led_brightness: 1} : undefined, {applyLocally: false});
    if (!result.committed) throw Error('ID-ul există deja; datele nu au fost suprascrise.');
    selected = id; $('roomDialog').close(); notify('Cameră creată. ROOM_ID în ESP: "' + id + '".');
  } catch (err) { notify(err.message, true); } finally { b.disabled = false; render(); }
};

// Reîmprospătare prezență / vechime temperatură
setInterval(() => { if (current()) render(); }, 5000);
setInterval(()=>{if(current() && user && view==='home')renderTimer(current());},1000);
// La revenirea din fundal, redesenăm imediat
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

// ---------------------------------------------------------------- pornire
try {
  // Link de instalare pentru client: #setup=...
  const m = location.hash.match(/^#setup=([A-Za-z0-9_-]+)$/);
  if (m) {
    const s = validateSettings(JSON.parse(b64dec(m[1])));
    localStorage.setItem(KEY, JSON.stringify(s));
    history.replaceState(null, '', location.pathname + location.search);
  }
  const raw = localStorage.getItem(KEY);
  if (raw) await switchProject(validateSettings(JSON.parse(raw)), {logoutOld: false});
} catch (e) { notify('Configurație invalidă: ' + e.message, true); }
render();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
