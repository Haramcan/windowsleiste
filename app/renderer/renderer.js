(function () {
  const api = window.insel;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const island = $('#island');
  let locked = false;
  let state = 'idle', leaveT = null, toastT = null, drag = null, dragEnd = 0, hover = false;

  const sticky = s => s === 'start' || s === 'notes';
  let goBack = false;   // beim Schließen per Taste zurück ins vorherige Fenster (z. B. das Spiel)
  function closeBack() { goBack = true; setState('idle'); }
  function setState(s) {
    const was = state;
    state = s; island.dataset.state = s;
    if (s === 'start' && was !== 'start') openStart();
    if (s === 'notes' && was !== 'notes') { api.focus(true); setTimeout(() => $('#note').focus(), 60); }
    if (sticky(was) && !sticky(s)) { api.focus(false, goBack); goBack = false; }
    if (s === 'mixer' && was !== 'mixer') api.mixer(true);
    if (was === 'mixer' && s !== 'mixer') api.mixer(false);
    $$('.view').forEach(v => { v.inert = v.dataset.view !== s; });
    reportRect();
    if (s === 'toast' || s === 'vol') api.flash(s === 'vol' ? 1700 : 6500);   // bei "Automatisch ausblenden" kurz zeigen
    if (s !== 'hub' && s !== 'start') { const p = document.getElementById('peek'); if (p) p.classList.remove('on'); }
  }
  // Dem Hauptprozess laufend sagen, wo die Insel im Fenster liegt (auch während sie wächst oder schrumpft).
  function sendRect() { const r = island.getBoundingClientRect(); api.rect({ left: r.left, top: r.top, width: r.width, height: r.height }); }
  function reportRect() { sendRect(); [120, 300, 650].forEach(ms => setTimeout(sendRect, ms)); }
  setInterval(sendRect, 2000);
  setState('idle');

  // ---------- Öffnen / Schließen ----------
  // Außerhalb der Insel ist das Fenster für die Maus durchlässig.
  island.addEventListener('mouseenter', () => {
    hover = true; api.ignore(false); clearTimeout(leaveT);
    if ((state === 'idle' || state === 'vol') && !drag) { clearTimeout(volT); setState('hub'); }
  });
  // Falls das Betreten einmal nicht gemeldet wurde (z. B. nach einem Vollbild-Spiel): jede Bewegung zählt auch.
  island.addEventListener('mousemove', () => {
    if (hover) return;
    hover = true; api.ignore(false); clearTimeout(leaveT);
    if ((state === 'idle' || state === 'vol') && !drag) { clearTimeout(volT); setState('hub'); }
  });
  island.addEventListener('mouseleave', e => {
    hover = false;
    if (drag || e.buttons) return;
    api.ignore(true); scheduleClose();
  });
  let menuOpen = false;   // Rechtsklick-Menü offen: Insel bleibt aufgeklappt
  function scheduleClose() {
    clearTimeout(leaveT);
    leaveT = setTimeout(() => { if (state !== 'toast' && state !== 'vol' && !sticky(state) && !hover && !menuOpen) setState('idle'); }, 450);
  }
  island.addEventListener('click', e => { if (Date.now() - dragEnd < 250) { e.stopPropagation(); e.preventDefault(); } }, true);
  island.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) setState(g.dataset.go); });

  function toast(text, ms, who) {
    $('#toastText').textContent = text; $('#toastWho').textContent = who || ''; setState('toast');
    clearTimeout(toastT); toastT = setTimeout(() => setState(hover ? 'hub' : 'idle'), ms || 2600);
  }

  // ---------- Verschieben ----------
  island.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('input, textarea')) return;
    const pin = e.target.closest('[data-kind="pin"]');
    if (locked && !pin) return;
    drag = { id: e.pointerId, x: e.screenX, y: e.screenY, moved: false, pin: pin || null };
  });
  window.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.screenX - drag.x, e.screenY - drag.y) < 6) return;
      drag.moved = true;
      try { island.setPointerCapture(e.pointerId); } catch (_) {}
      if (drag.pin) drag.pin.classList.add('moving');
      else { island.classList.add('dragging'); api.dragStart(); }
    }
    if (drag.pin) drag.pin.style.transform = 'translateX(' + (e.screenX - drag.x) + 'px)';
    else api.dragMove();
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved, pin = drag.pin; drag = null;
    if (moved && pin) {
      // Zielplatz: so viele andere angeheftete Symbole, wie links vom losgelassenen liegen
      const mid = pin.getBoundingClientRect().left + pin.offsetWidth / 2;
      const others = [...pin.parentElement.querySelectorAll('[data-kind="pin"]')].filter(b => b !== pin);
      const to = others.filter(b => b.getBoundingClientRect().left + b.offsetWidth / 2 < mid).length;
      pin.style.transform = ''; pin.classList.remove('moving'); dragEnd = Date.now();
      api.pinMove(+pin.dataset.i, to);
    } else if (moved) {
      const r = island.getBoundingClientRect();
      island.classList.remove('dragging'); dragEnd = Date.now();
      api.dragEnd({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    if (!island.matches(':hover')) { hover = false; api.ignore(true); scheduleClose(); }
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  api.on('layout', l => {
    island.dataset.anchor = l.anchor;
    island.style.setProperty('--il', l.insetL + 'px');
    island.style.setProperty('--ir', l.insetR + 'px');
    geo = Object.assign(geo || {}, l);
    if (!geo.win || !geo.display) return;
    placeGlass(); setTimeout(placeGlass, 600); reportRect();
    if (glassOn && geo.display.id !== glassDisplay) startGlass();
  });
  api.on('winpos', p => { if (geo) { geo.win.x = p.x; geo.win.y = p.y; placeGlass(); } });

  // ---------- Milchglas ----------
  // Ein kleines Live-Bild des Bildschirms liegt unscharf hinter der Insel und wird so verschoben,
  // dass es genau zu dem passt, was wirklich dahinter ist.
  const M = 24, gv = $('#gv');
  let geo = null, glassOn = false, glassDisplay = null, glassStream = null;
  function placeGlass() {
    if (!geo || !geo.win || !geo.display) return;
    const r = island.getBoundingClientRect();
    const z = geo.z || 1;   // Fenster und Bildschirm sind in Bildschirmpunkten angegeben, die Seite rechnet in vergrößerten Punkten
    const cx = geo.win.x + (r.left + r.width / 2) * z;
    const ay = geo.anchor === 'bottom' ? geo.win.y + geo.win.h - M * z : geo.win.y + M * z;
    const s = island.style;
    s.setProperty('--vx', (geo.display.x - cx) / z + 'px'); s.setProperty('--vy', (geo.display.y - ay) / z + 'px');
    s.setProperty('--vw', geo.display.width / z + 'px'); s.setProperty('--vh', geo.display.height / z + 'px');
  }
  function stopGlass() {
    if (glassStream) glassStream.getTracks().forEach(t => t.stop());
    glassStream = null; glassDisplay = null; gv.srcObject = null;
    $('#gv').hidden = true; $('#gi').hidden = true;
    $('#glass').hidden = true; island.classList.remove('glassy');
  }
  async function startGlass() {
    if (!geo || !geo.display) return;
    const want = geo.display.id;
    stopGlass();
    if (!glassOn) return;
    try {
      const id = await api.glassSource(want);
      if (!id || !glassOn) return;
      glassStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 640, maxHeight: 400, maxFrameRate: 24 } } });
      glassDisplay = want; gv.srcObject = glassStream; gv.hidden = false; await gv.play();
      $('#glass').hidden = false; island.classList.add('glassy'); placeGlass();
    } catch (_) { stopGlass(); }
  }
  // Zwei Arten: 'bild' = unscharfes Hintergrundbild (auch im Stream sichtbar), 'live' = echtes Live-Bild.
  let glassMode = false, wallUrl = '';
  function applyGlass() {
    glassOn = glassMode === 'live';
    stopGlass();
    if (glassOn) return startGlass();
    if (glassMode === 'bild' && wallUrl) {
      $('#gi').src = wallUrl; $('#gi').hidden = false;
      $('#glass').hidden = false; island.classList.add('glassy'); placeGlass();
    }
  }
  function showGlassToggles() {
    $('#tGlass').setAttribute('aria-pressed', !!glassMode);
    $('#tLive').setAttribute('aria-pressed', glassMode === 'live');
  }
  function setGlassMode(mode) { glassMode = mode; showGlassToggles(); api.setGlass(mode); setTimeout(applyGlass, 150); }

  // ---------- Programme ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function appBtn(a, kind, i) {
    const cls = 'app' + (a.active ? ' running active' : a.wins.length ? ' running' : '');
    const pic = a.icon ? '<img src="' + esc(a.icon) + '" alt="">' : '<span class="letter">' + esc((a.name || '?').charAt(0).toUpperCase()) + '</span>';
    return '<button class="' + cls + '" data-kind="' + kind + '" data-i="' + i + '" title="' + esc(a.name) + '">' + pic + '</button>';
  }
  let appsHtml = '';
  function renderApps(d) {
    const start = '<button class="app" data-start title="Start"><svg width="22" height="22" viewBox="0 0 22 22" fill="var(--accent)"><rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="11.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="11.5" width="7.5" height="7.5" rx="1"/><rect x="11.5" y="11.5" width="7.5" height="7.5" rx="1"/></svg></button>';
    const add = '<button class="app add" data-add title="Programm oder Spiel anheften"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg></button>';
    const sep = '<span class="sep"></span>';
    const html = start + sep +
      d.pins.map((a, i) => appBtn(a, 'pin', i)).join('') + add +
      (d.others.length ? sep + d.others.map((a, i) => appBtn(a, 'other', i)).join('') : '');
    if (html === appsHtml) return;   // nichts geändert: nicht neu zeichnen, sonst gehen Klicks verloren
    appsHtml = html; $('#apps').innerHTML = html; $('#sApps').innerHTML = html;
    // Die Übersicht wächst mit der Zahl der Symbole (bis zur Fensterbreite).
    const n = 2 + d.pins.length + d.others.length, seps = d.others.length ? 2 : 1;
    const w = n * 44 + seps * 13 + 32;
    island.style.setProperty('--hubw', Math.max(560, Math.min(800, w)) + 'px');
  }
  renderApps({ pins: [], others: [] });
  api.on('apps', renderApps);
  // Dieselbe Programmreihe gibt es zweimal: in der aufgeklappten Insel und unten im Menü.
  ['#apps', '#sApps'].forEach(sel => {
    $(sel).addEventListener('click', e => {
      if (e.target.closest('[data-start]')) return setState(state === 'start' ? 'hub' : 'start');
      if (e.target.closest('[data-add]')) { setState('idle'); return api.pinAdd(); }
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      if (e.shiftKey) api.appNew(b.dataset.kind, +b.dataset.i);   // Umschalt+Klick: neues Fenster, wie bei Windows
      else api.appClick(b.dataset.kind, +b.dataset.i);
      if (state === 'start') setState('idle');
    });
    // Mittlere Maustaste: neues Fenster
    $(sel).addEventListener('auxclick', e => {
      const b = e.button === 1 && e.target.closest('[data-kind]');
      if (b) { e.preventDefault(); api.appNew(b.dataset.kind, +b.dataset.i); }
    });
    $(sel).addEventListener('contextmenu', e => {
      if (e.target.closest('[data-start]')) { e.preventDefault(); return api.startMenu(); }
      const b = e.target.closest('[data-kind]');
      if (b) { e.preventDefault(); api.appMenu(b.dataset.kind, +b.dataset.i); }
    });
  });

  // Rechtsklick auf eine freie Stelle der Insel: Task-Manager, Desktop, Einstellungen …
  island.addEventListener('contextmenu', e => {
    if (e.defaultPrevented || e.target.closest('input, textarea, .v-start, .v-notes')) return;
    e.preventDefault(); api.islandMenu();
  });

  // ---------- Symbole aus dem Infobereich ----------
  let trayIcons = [], trayHtml = '';
  // Mausrad blättert seitlich durch lange Symbolreihen
  ['#apps', '#tray', '#sApps', '#sTray'].forEach(sel => $(sel).addEventListener('wheel', e => { $(sel).scrollLeft += e.deltaY; }, { passive: true }));
  function renderTray(ev) {
    trayIcons = ev.icons || [];
    const html = trayIcons.map((t, i) => '<button class="ti" data-ti="' + i + '" title="' + esc(t.title) + '">' +
      (t.icon ? '<img src="' + esc(t.icon) + '" alt="">' : '<span class="letter">' + esc((t.title || '?').charAt(0).toUpperCase()) + '</span>') + '</button>').join('');
    if (html !== trayHtml) { trayHtml = html; $('#tray').innerHTML = html; $('#sTray').innerHTML = html; }
    island.classList.toggle('has-tray', trayIcons.length > 0);
  }
  $('#tray').addEventListener('click', e => { const b = e.target.closest('[data-ti]'); if (b && trayIcons[+b.dataset.ti]) api.trayClick(trayIcons[+b.dataset.ti].id, 'left'); });
  $('#tray').addEventListener('contextmenu', e => { const b = e.target.closest('[data-ti]'); if (b && trayIcons[+b.dataset.ti]) { e.preventDefault(); api.trayClick(trayIcons[+b.dataset.ti].id, 'right'); } });
  $('#sTray').addEventListener('click', e => { const b = e.target.closest('[data-ti]'); if (b && trayIcons[+b.dataset.ti]) api.trayClick(trayIcons[+b.dataset.ti].id, 'left'); });
  $('#sTray').addEventListener('contextmenu', e => { const b = e.target.closest('[data-ti]'); if (b && trayIcons[+b.dataset.ti]) { e.preventDefault(); api.trayClick(trayIcons[+b.dataset.ti].id, 'right'); } });

  // ---------- Uhr ----------
  function tick() {
    const d = new Date();
    $('#clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    $('#date').textContent = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    $('#bDay').textContent = $('#date').textContent;
  }
  tick(); setInterval(tick, 5000);

  // ---------- Musik ----------
  const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const noArt = 'linear-gradient(135deg,#ffb454,#c2456b)';
  let media = { has: false, playing: false, pos: 0, dur: 0, at: 0 };
  island.style.setProperty('--art', noArt);
  function showMedia() {
    const m = media;
    $('#idleMusic').hidden = !m.has; $('#idleVol').hidden = m.has;
    island.classList.toggle('has-media', !!m.has);
    island.classList.toggle('paused', !(m.has && m.playing));
    $('#mTitle').textContent = m.has ? (m.title || 'Unbekannter Titel') : 'Keine Wiedergabe';
    $('#mArtist').textContent = m.has ? (m.artist || m.app || '') : 'Starte Musik in Spotify, im Browser oder einem anderen Player.';
    $('#chipTitle').textContent = m.has ? (m.title || 'Musik') : 'Keine Wiedergabe';
    $('#hmTitle').textContent = $('#mTitle').textContent; $('#hmArtist').textContent = m.has ? (m.artist || m.app || '') : '';
    $('#hPlayIcon').setAttribute('d', m.has && m.playing ? 'M4.5 3h3v12h-3zM10.5 3h3v12h-3z' : 'M5 3.2v11.6a.6.6 0 00.92.5l9-5.8a.6.6 0 000-1l-9-5.8a.6.6 0 00-.92.5z');
    $('#playIcon').setAttribute('d', m.has && m.playing ? 'M4.5 3h3v12h-3zM10.5 3h3v12h-3z' : 'M5 3.2v11.6a.6.6 0 00.92.5l9-5.8a.6.6 0 000-1l-9-5.8a.6.6 0 00-.92.5z');
    showPos();
  }
  function showPos() {
    const m = media;
    let p = m.pos || 0;
    if (m.has && m.playing) p += (Date.now() - m.at) / 1000;
    if (m.dur > 0) p = Math.min(p, m.dur);
    $('#pos').textContent = fmt(p); $('#dur').textContent = fmt(m.dur || 0);
    $('#fill').style.width = (m.dur > 0 ? p / m.dur * 100 : 0) + '%';
    $('#hPos').textContent = fmt(p); $('#hDur').textContent = fmt(m.dur || 0); $('#hFill').style.width = $('#fill').style.width;
  }
  $$('[data-m]').forEach(b => b.addEventListener('click', () => api.helper({ c: 'media', a: b.dataset.m })));
  $('#play').addEventListener('click', () => api.helper({ c: 'media', a: 'toggle' }));
  $('#next').addEventListener('click', () => api.helper({ c: 'media', a: 'next' }));
  $('#prev').addEventListener('click', () => api.helper({ c: 'media', a: 'prev' }));

  // ---------- Lautstärke ----------
  let volT = null, lastVol = null;
  // Lautstärke über Tastatur oder Windows geändert: kurz in der Insel zeigen
  function volOsd(v, muted) {
    $('#volFill').style.width = (muted ? 0 : v) + '%'; $('#volOsd').textContent = muted ? 'Stumm' : v;
    if (state !== 'idle' && state !== 'vol') return;
    setState('vol'); clearTimeout(volT); volT = setTimeout(() => { if (state === 'vol') setState('idle'); }, 1400);
  }
  function showVol(v, muted) {
    $('#volMusic').value = v; $('#volQuick').value = v; $('#volVal').textContent = v;
    $('#tMute').setAttribute('aria-pressed', !!muted);
  }
  function sendVol(e) { const v = +e.target.value; showVol(v, false); lastVol = v + '|false'; api.helper({ c: 'volume', v: v / 100 }); }
  $('#volMusic').addEventListener('input', sendVol);
  $('#volQuick').addEventListener('input', sendVol);
  $('#tMute').addEventListener('click', () => api.helper({ c: 'mute' }));
  $('#tMic').addEventListener('click', () => api.micToggle());

  // ---------- Einstellungen ----------
  function toggle(id, fn) {
    $(id).addEventListener('click', () => { const on = $(id).getAttribute('aria-pressed') !== 'true'; $(id).setAttribute('aria-pressed', on); fn(on); });
  }
  toggle('#tTaskbar', api.setHideTaskbar);
  toggle('#tAuto', api.setAutostart);
  toggle('#tWinKey', api.setWinKey);
  toggle('#tAutoHide', api.setAutoHide);
  toggle('#tMicKey', api.setMicKey);
  function showScale(v) { $$('[data-scale]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.scale === v)); }
  $$('[data-scale]').forEach(b => b.addEventListener('click', () => { showScale(+b.dataset.scale); api.setScale(+b.dataset.scale); }));

  // ---------- Kalender ----------
  let calY = 0, calM = 0;
  function drawCal() {
    const now = new Date(), first = new Date(calY, calM, 1);
    $('#calTitle').textContent = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const lead = (first.getDay() + 6) % 7, days = new Date(calY, calM + 1, 0).getDate(), prevDays = new Date(calY, calM, 0).getDate();
    let h = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(x => '<span class="hd">' + x + '</span>').join('');
    for (let i = lead; i > 0; i--) h += '<span class="out">' + (prevDays - i + 1) + '</span>';
    for (let i = 1; i <= days; i++) h += '<span' + (i === now.getDate() && calM === now.getMonth() && calY === now.getFullYear() ? ' class="today"' : '') + '>' + i + '</span>';
    for (let i = 1; (lead + days + i - 1) % 7 !== 0; i++) h += '<span class="out">' + i + '</span>';
    $('#calGrid').innerHTML = h;
  }
  function calNow() { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); drawCal(); }
  $('#calPrev').addEventListener('click', () => { if (--calM < 0) { calM = 11; calY--; } drawCal(); });
  $('#calNext').addEventListener('click', () => { if (++calM > 11) { calM = 0; calY++; } drawCal(); });
  $('#calToday').addEventListener('click', calNow);
  $('#bDay').addEventListener('click', calNow);
  calNow();

  // ---------- Vorschau eines Fensters beim Überfahren eines Programms ----------
  const peek = $('#peek');
  let peekT = null, peekFor = null;
  function hidePeek() { clearTimeout(peekT); peekFor = null; peek.classList.remove('on'); }
  ['#apps', '#sApps'].forEach(sel => {
    $(sel).addEventListener('mouseover', e => {
      const b = e.target.closest('.app.running');
      if (!b) return hidePeek();
      if (peekFor === b) return;
      hidePeek(); peekFor = b;
      peekT = setTimeout(async () => {
        const info = await api.winThumb(b.dataset.kind, +b.dataset.i);
        if (peekFor !== b || !info || drag) return;
        $('#peekTitle').textContent = info.title || '';
        $('#peekImg').hidden = !info.data; if (info.data) $('#peekImg').src = info.data;
        $('#peekMore').textContent = info.count > 1 ? '+ ' + (info.count - 1) + ' weitere Fenster' : (info.data ? '' : 'Fenster ist minimiert');
        // unter der Insel (oder darüber, wenn sie unten sitzt), mittig unter dem Symbol
        const r = b.getBoundingClientRect(), ir = island.getBoundingClientRect(), vw = document.documentElement.clientWidth;
        peek.style.left = Math.max(8, Math.min(vw - 308, r.left + r.width / 2 - 150)) + 'px';
        if (island.dataset.anchor === 'bottom') { peek.style.top = ''; peek.style.bottom = (document.documentElement.clientHeight - ir.top + 8) + 'px'; }
        else { peek.style.bottom = ''; peek.style.top = (ir.bottom + 8) + 'px'; }
        peek.classList.add('on');
      }, 380);
    });
    $(sel).addEventListener('mouseleave', hidePeek);
    $(sel).addEventListener('mousedown', hidePeek);
  });
  $('#bMic').addEventListener('click', () => api.micToggle());
  $('#bSnip').addEventListener('click', () => { setState('idle'); api.snip(); });

  // ---------- Lautstärke pro Programm ----------
  function renderMixer(list) {
    if ($('#mxList').matches(':active') || $('#mxList :active')) return;   // nicht neu zeichnen, während ein Regler gezogen wird
    $('#mxList').innerHTML = list.length ? list.map(a => '<div class="row"><span class="cap" title="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
      '<input type="range" min="0" max="100" value="' + Math.round((a.muted ? 0 : a.level) * 100) + '" data-vol="' + esc(a.name) + '"><span class="q-val num">' + Math.round((a.muted ? 0 : a.level) * 100) + '</span></div>').join('')
      : '<p class="hint">Gerade spielt kein Programm Ton ab.</p>';
  }
  $('#mxList').addEventListener('input', e => {
    const s = e.target.closest('[data-vol]'); if (!s) return;
    s.nextElementSibling.textContent = s.value; api.appVol(s.dataset.vol, s.value / 100);
  });

  // ---------- Notizen ----------
  $('#note').addEventListener('input', () => api.noteSave($('#note').value));
  $('#note').addEventListener('keydown', e => { if (e.key === 'Escape') closeBack(); });
  $('#tGlass').addEventListener('click', () => setGlassMode(glassMode ? false : 'bild'));
  $('#tLive').addEventListener('click', () => setGlassMode(glassMode === 'live' ? 'bild' : 'live'));
  toggle('#tFrames', api.setFrames);
  toggle('#tHideFs', api.setHideFullscreen);
  toggle('#tLock', on => { locked = on; api.setLocked(on); });
  toggle('#tClear', on => { island.classList.toggle('clear', on); api.setClear(on); });

  // ---------- Updates ----------
  let upd = { state: 'idle', version: '' }, updToastFor = '';
  function showUpdate(u) {
    upd = u;
    const b = $('#bUpdate'), v = 'Version ' + u.version;
    b.setAttribute('aria-pressed', u.state === 'ready');
    b.textContent = u.state === 'checking' ? 'Suche nach Updates …'
      : u.state === 'loading' ? 'Update ' + u.next + ' wird geladen …'
      : u.state === 'ready' ? 'Update ' + u.next + ' jetzt installieren'
      : u.state === 'current' ? v + ' · aktuell'
      : u.state === 'error' ? v + ' · Suche fehlgeschlagen, nochmal versuchen'
      : v + ' · nach Updates suchen';
    if (u.state === 'ready' && updToastFor !== u.next && (state === 'idle' || state === 'vol')) { updToastFor = u.next; toast('Einstellungen → Update installieren', 6000, 'Update ' + u.next + ' ist bereit'); }
  }
  $('#bUpdate').addEventListener('click', () => { if (upd.state === 'ready') api.updateInstall(); else api.updateCheck(); });

  // ---------- Startmenü mit Suche ----------
  let allApps = [], shown = [], iconUrls = {};
  let settingsList = [], rows = [], rsel = 0, fileRows = [], filePending = false, fileTimer = null, searchSeq = 0;
  const sGrid = $('#sGrid'), sList = $('#sList'), sSearch = $('#sSearch');
  const ICON = { gear: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/></svg>', search: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>', web: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>' };
  api.settingsList().then(l => { settingsList = l || []; });
  const STOP = new Set(['oder', 'und', 'die', 'der', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'von', 'mit', 'fur', 'zu', 'im', 'in', 'am', 'an', 'auf', 'wie', 'ich']);
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
  const wordsOf = q => norm(q).split(/[\s,]+/).filter(w => w && !STOP.has(w));
  const hit = (text, ws) => { const t = norm(text); return ws.length > 0 && ws.every(w => t.includes(w)); };
  const appIcon = a => iconUrls[a.id] ? '<img src="' + esc(iconUrls[a.id]) + '" alt="">' : '<span class="letter">' + esc(a.name.charAt(0).toUpperCase()) + '</span>';

  // Ohne Suchtext: alle Programme als Raster
  function drawGrid() {
    shown = allApps.slice(0, 60);
    sGrid.innerHTML = shown.length ? shown.map((a, i) => '<button class="s-app" data-si="' + i + '" style="--i:' + Math.min(i, 14) + '" title="' + esc(a.name) + '">' +
      appIcon(a) + '<span class="n">' + esc(a.name) + '</span></button>').join('') : '<div class="s-empty">' + (allApps.length ? 'Keine Programme gefunden.' : 'Programme werden geladen …') + '</div>';
    sGrid.scrollTop = 0;
    loadIcons(shown, () => shown.forEach((a, i) => { const b = sGrid.querySelector('[data-si="' + i + '"] .letter'); if (b && iconUrls[a.id]) b.outerHTML = '<img src="' + esc(iconUrls[a.id]) + '" alt="">'; }));
  }
  function loadIcons(apps, done) {
    const need = apps.filter(a => !(a.id in iconUrls)).map(a => a.id);
    if (need.length) api.startIcons(need).then(res => { Object.assign(iconUrls, res); done(); });
  }

  // Mit Suchtext: Liste wie bei der Windows-Suche
  function rowHtml(r, i) {
    const pic = r.app ? appIcon(r.app) : r.img ? '<img src="' + esc(r.img) + '" alt="">' : '<span class="ic">' + (r.ic || '') + '</span>';
    return '<button class="s-row' + (i === rsel ? ' sel' : '') + '" data-ri="' + i + '">' + pic +
      '<span class="t"><b>' + esc(r.label) + '</b><small>' + esc(r.sub || '') + '</small></span></button>';
  }
  function drawList(q, keepLabel) {
    const ws = wordsOf(q), first = ws[0] || '';
    const apps = allApps.filter(a => hit(a.name, ws))
      .sort((a, b) => norm(a.name).indexOf(first) - norm(b.name).indexOf(first)).slice(0, 6)
      .map(a => ({ label: a.name, sub: 'App', app: a, run: () => { api.startLaunch(a.id); setState('idle'); } }));
    const sets = settingsList.filter(s => hit(s.name + ' ' + s.sub + ' ' + s.keys, ws)).slice(0, 6)
      .map(s => ({ label: s.name, sub: s.sub, ic: ICON.gear, run: () => { api.runSetting(s.i); setState('idle'); } }));
    const more = [
      { label: '„' + q + '“ in der Windows-Suche', sub: 'Öffnet die Suche von Windows mit diesem Text', ic: ICON.search, run: () => { setState('idle'); api.winSearch(q); } },
      { label: '„' + q + '“ im Web suchen', sub: 'Öffnet deinen Browser', ic: ICON.web, run: () => { api.webSearch(q); setState('idle'); } }];
    rows = []; let h = '';
    const group = (title, items) => {
      if (!items.length) return;
      h += '<div class="s-sec">' + title + '</div>';
      items.forEach(r => { h += rowHtml(r, rows.push(r) - 1); });
    };
    rsel = 0;
    const all = [].concat(apps, sets, fileRows, more);
    if (keepLabel) { const k = all.findIndex(r => r.label === keepLabel); if (k >= 0) rsel = k; }
    group('Apps', apps); group('Einstellungen', sets);
    if (fileRows.length) group('Dateien', fileRows);
    else if (filePending) h += '<div class="s-sec">Dateien</div><div class="s-wait">Suche …</div>';
    group('Weitere', more);
    sList.innerHTML = h;
    loadIcons(apps.map(r => r.app), () => apps.forEach(r => { const i = rows.indexOf(r); const el = sList.querySelector('[data-ri="' + i + '"] .letter'); if (el && iconUrls[r.app.id]) el.outerHTML = '<img src="' + esc(iconUrls[r.app.id]) + '" alt="">'; }));
  }
  function markSel(scroll) {
    sList.querySelectorAll('.s-row').forEach(b => b.classList.toggle('sel', +b.dataset.ri === rsel));
    const el = sList.querySelector('.s-row.sel');
    if (el && scroll) el.scrollIntoView({ block: 'nearest' });
  }
  function drawStart() {
    const q = sSearch.value.trim();
    sGrid.hidden = !!q; sList.hidden = !q;
    clearTimeout(fileTimer); fileRows = []; filePending = q.length >= 2;
    if (!q) return drawGrid();
    drawList(q);
    if (!filePending) return;
    fileTimer = setTimeout(() => {
      const id = ++searchSeq;
      api.searchFiles(q).then(items => {
        if (id !== searchSeq || sSearch.value.trim() !== q) return;
        filePending = false;
        fileRows = (items || []).map(f => ({ label: f.name, sub: f.path, img: f.icon, path: f.path, ic: '', run: () => { api.openFile(f.path); setState('idle'); } }));
        drawList(q, rows[rsel] && rows[rsel].label);
      });
    }, 200);
  }
  function openStart() {
    sSearch.value = ''; drawStart(); resetPower();
    api.focus(true); setTimeout(() => sSearch.focus(), 60);
    api.startApps().then(list => { allApps = list || []; if (state === 'start') drawStart(); });
  }
  function launch(i) { if (shown[i]) { api.startLaunch(shown[i].id); setState('idle'); } }
  sSearch.addEventListener('input', drawStart);
  sSearch.addEventListener('keydown', e => {
    const listMode = !!sSearch.value.trim();
    if (e.key === 'Escape') return closeBack();
    if (!listMode) return;
    if (e.key === 'Enter') { if (rows[rsel]) rows[rsel].run(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); rsel = Math.min(rows.length - 1, rsel + 1); markSel(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rsel = Math.max(0, rsel - 1); markSel(true); }
  });
  sGrid.addEventListener('click', e => { const b = e.target.closest('[data-si]'); if (b) launch(+b.dataset.si); });
  sList.addEventListener('click', e => { const b = e.target.closest('[data-ri]'); if (b && rows[+b.dataset.ri]) rows[+b.dataset.ri].run(); });
  sList.addEventListener('mousemove', e => { const b = e.target.closest('[data-ri]'); if (b && +b.dataset.ri !== rsel) { rsel = +b.dataset.ri; markSel(false); } });
  sList.addEventListener('contextmenu', e => { const b = e.target.closest('[data-ri]'); const r = b && rows[+b.dataset.ri]; if (r && r.path) { e.preventDefault(); api.showFile(r.path); } });

  // Ein/Aus: Neu starten und Herunterfahren brauchen einen zweiten Klick.
  const powerText = { restart: 'Nochmal klicken: Neu starten', off: 'Nochmal klicken: Herunterfahren' };
  let powerT = null;
  function resetPower() { $$('[data-power]').forEach(b => b.removeAttribute('aria-pressed')); $('#sHint').classList.remove('on'); }
  $$('[data-power]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.power;
    if (k === 'lock') { api.power('lock'); return setState('idle'); }
    if (b.getAttribute('aria-pressed') === 'true') return api.power(k);
    resetPower();
    b.setAttribute('aria-pressed', 'true'); $('#sHint').textContent = powerText[k]; $('#sHint').classList.add('on');
    clearTimeout(powerT); powerT = setTimeout(resetPower, 4000);
  }));
  toggle('#tLight', api.setTheme);
  $('#bIcons').addEventListener('click', () => api.deskIcons());
  $('#bWall').addEventListener('click', () => { setState('idle'); api.wallpaper(); });

  $$('[data-widget]').forEach(b => b.addEventListener('click', () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); api.setWidget(b.dataset.widget, on); }));

  // ---------- Mitteilungen ----------
  toggle('#tNotify', api.setNotify);
  function showNotifyState(n) {
    $('#tNotify').setAttribute('aria-pressed', !!n.on);
    $('#nList').innerHTML = n.apps.map(a => '<button class="tog" data-app="' + esc(a.name) + '" aria-pressed="' + !!a.on + '">' + esc(a.name) + '</button>').join('');
    if (n.apps.length) $('#nHint').textContent = 'Tippe ein Programm an, um seine Mitteilungen ab- oder anzuschalten.';
  }
  $('#nList').addEventListener('click', e => {
    const b = e.target.closest('[data-app]');
    if (b) api.setNotifyApp(b.dataset.app, b.getAttribute('aria-pressed') !== 'true');
  });
  $('#quit').addEventListener('click', () => api.quit());


  setInterval(() => {
    showPos();
  }, 1000);

  // ---------- Ereignisse vom Helfer ----------
  let micSeen = false, micWas = false;
  api.on('ev', ev => {
    if (ev.t === 'media') { media = Object.assign({ at: Date.now() }, ev); showMedia(); }
    else if (ev.t === 'thumb') island.style.setProperty('--art', ev.data ? 'url("' + ev.data + '")' : noArt);
    else if (ev.t === 'volume') {
      const v = Math.round(ev.level * 100), key = v + '|' + ev.muted;
      showVol(v, ev.muted);
      if (lastVol !== null && key !== lastVol) volOsd(v, ev.muted);
      lastVol = key;
    }
    else if (ev.t === 'toast') toast(ev.m, 4500);
    else if (ev.t === 'go') { if (['start', 'settings'].includes(ev.s)) setState(ev.s); }
    else if (ev.t === 'cfg') { locked = !!ev.locked; $('#tLock').setAttribute('aria-pressed', locked); $('#tAutoHide').setAttribute('aria-pressed', !!ev.autoHide); }
    else if (ev.t === 'menu') { menuOpen = !!ev.on; if (!menuOpen && !island.matches(':hover')) { hover = false; api.ignore(true); scheduleClose(); } }
    else if (ev.t === 'update') showUpdate(ev);
    else if (ev.t === 'blur') { if (sticky(state)) setState('idle'); }
    else if (ev.t === 'winkey') { if (state === 'start') closeBack(); else setState('start'); }
    else if (ev.t === 'mic') {
      if (micSeen && ev.has && ev.muted !== micWas && (state === 'idle' || state === 'vol' || state === 'toast')) toast(ev.muted ? 'Mikrofon ist stumm' : 'Mikrofon ist an', 1600);
      if (ev.has) { micSeen = true; micWas = ev.muted; }   // erst ab dem ersten echten Zustand vergleichen, sonst meldet sich die Insel beim Start
      island.classList.toggle('has-mic', !!ev.has); island.classList.toggle('mic-off', !!ev.has && !!ev.muted); $('#bMic').hidden = !ev.has; $('#tMic').hidden = !ev.has; $('#tMic').setAttribute('aria-pressed', !!ev.muted); $('#bMic').title = ev.muted ? 'Mikrofon ist stumm – einschalten' : 'Mikrofon stumm schalten'; }
    else if (ev.t === 'mixer') renderMixer(ev.list || []);
    else if (ev.t === 'wall') { wallUrl = ev.data || ''; if (glassMode === 'bild') applyGlass(); }
    else if (ev.t === 'notif') { if (state === 'idle' || state === 'vol' || state === 'toast' || state === 'hub') toast([ev.title, ev.body].filter(Boolean).join(' – '), 5000, ev.app); }
    else if (ev.t === 'notifyState') showNotifyState(ev);
    else if (ev.t === 'tray') renderTray(ev);
    else if (ev.t === 'notifAccess') { if (!ev.ok) $('#nHint').textContent = 'Windows gibt die Mitteilungen noch nicht frei. Erlaube den Zugriff unter Einstellungen → Datenschutz und Sicherheit → Benachrichtigungen.'; }
    else if (ev.t === 'theme') $('#tLight').setAttribute('aria-pressed', !!ev.light);
    else if (ev.t === 'visible') { island.classList.toggle('asleep', !ev.on); hover = false; drag = null; island.classList.toggle('dragging', false); if (!ev.on && state !== 'idle') setState('idle');
       if (glassOn) { if (ev.on) startGlass(); else stopGlass(); } }
  });

  api.ready().then(s => {
    $('#tTaskbar').setAttribute('aria-pressed', !!s.hideTaskbar);
    $('#tAuto').setAttribute('aria-pressed', !!s.autostart);
    $('#tFrames').setAttribute('aria-pressed', !!s.frames);
    $('#tHideFs').setAttribute('aria-pressed', s.hideFullscreen !== false);
    locked = !!s.locked; $('#tLock').setAttribute('aria-pressed', locked);
    $('#tWinKey').setAttribute('aria-pressed', !!s.winKey); $('#tAutoHide').setAttribute('aria-pressed', !!s.autoHide);
    $('#tMicKey').setAttribute('aria-pressed', s.micKey !== false); showScale(s.scale || 1); $('#note').value = s.note || '';
    island.classList.toggle('clear', !!s.clear); $('#tClear').setAttribute('aria-pressed', !!s.clear);
    showNotifyState(s.notify);
    (s.widgets || []).forEach(w => { const b = document.querySelector('[data-widget="' + w.name + '"]'); if (b) b.setAttribute('aria-pressed', !!w.on); });
    glassMode = s.glass || false; wallUrl = s.wall || ''; showGlassToggles(); setTimeout(applyGlass, 300);
  });
  showMedia();
})();
