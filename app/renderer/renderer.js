(function () {
  const api = window.insel;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const island = $('#island');
  let state = 'idle', leaveT = null, toastT = null, drag = null, dragEnd = 0, hover = false;

  function setState(s) {
    state = s; island.dataset.state = s;
    $$('.view').forEach(v => { v.inert = v.dataset.view !== s; });
  }
  setState('idle');

  // ---------- Öffnen / Schließen ----------
  // Außerhalb der Insel ist das Fenster für die Maus durchlässig.
  island.addEventListener('mouseenter', () => {
    hover = true; api.ignore(false); clearTimeout(leaveT);
    if ((state === 'idle' || state === 'vol') && !drag) { clearTimeout(volT); setState('hub'); }
  });
  island.addEventListener('mouseleave', e => {
    hover = false;
    if (drag || e.buttons) return;
    api.ignore(true); scheduleClose();
  });
  function scheduleClose() {
    clearTimeout(leaveT);
    leaveT = setTimeout(() => { if (state !== 'toast' && state !== 'vol' && !hover) setState('idle'); }, 450);
  }
  island.addEventListener('click', e => { if (Date.now() - dragEnd < 250) { e.stopPropagation(); e.preventDefault(); } }, true);
  island.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) setState(g.dataset.go); });

  function toast(text, ms, who) {
    $('#toastText').textContent = text; $('#toastWho').textContent = who || ''; setState('toast');
    clearTimeout(toastT); toastT = setTimeout(() => setState(hover ? 'hub' : 'idle'), ms || 2600);
  }

  // ---------- Verschieben ----------
  island.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('input')) return;
    drag = { id: e.pointerId, x: e.screenX, y: e.screenY, moved: false };
  });
  window.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.screenX - drag.x, e.screenY - drag.y) < 6) return;
      drag.moved = true; island.classList.add('dragging');
      try { island.setPointerCapture(e.pointerId); } catch (_) {}
      api.dragStart();
    }
    api.dragMove();
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved; drag = null;
    if (moved) {
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
    placeGlass(); setTimeout(placeGlass, 600);
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
    const cx = geo.win.x + r.left + r.width / 2;
    const ay = geo.anchor === 'bottom' ? geo.win.y + geo.win.h - M : geo.win.y + M;
    const s = island.style;
    s.setProperty('--vx', (geo.display.x - cx) + 'px'); s.setProperty('--vy', (geo.display.y - ay) + 'px');
    s.setProperty('--vw', geo.display.width + 'px'); s.setProperty('--vh', geo.display.height + 'px');
  }
  function stopGlass() {
    if (glassStream) glassStream.getTracks().forEach(t => t.stop());
    glassStream = null; glassDisplay = null; gv.srcObject = null;
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
      glassDisplay = want; gv.srcObject = glassStream; await gv.play();
      $('#glass').hidden = false; island.classList.add('glassy'); placeGlass();
    } catch (_) { stopGlass(); }
  }
  function setGlass(on) { glassOn = on; if (on) startGlass(); else stopGlass(); }

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
    appsHtml = html; $('#apps').innerHTML = html;
    // Die Übersicht wächst mit der Zahl der Symbole (bis zur Fensterbreite).
    const n = 2 + d.pins.length + d.others.length, seps = d.others.length ? 2 : 1;
    const w = n * 44 + seps * 13 + 32;
    island.style.setProperty('--hubw', Math.max(480, Math.min(760, w)) + 'px');
  }
  renderApps({ pins: [], others: [] });
  api.on('apps', renderApps);
  $('#apps').addEventListener('click', e => {
    if (e.target.closest('[data-start]')) return api.helper({ c: 'start' });
    if (e.target.closest('[data-add]')) { setState('idle'); return api.pinAdd(); }
    const b = e.target.closest('[data-kind]');
    if (b) api.appClick(b.dataset.kind, +b.dataset.i);
  });
  $('#apps').addEventListener('contextmenu', e => {
    const b = e.target.closest('[data-kind]');
    if (b) { e.preventDefault(); api.appMenu(b.dataset.kind, +b.dataset.i); }
  });

  // ---------- Symbole aus dem Infobereich ----------
  let trayIcons = [], trayHtml = '';
  // Mausrad blättert seitlich durch lange Symbolreihen
  ['#apps', '#tray'].forEach(sel => $(sel).addEventListener('wheel', e => { $(sel).scrollLeft += e.deltaY; }, { passive: true }));
  function renderTray(ev) {
    trayIcons = ev.icons || [];
    const html = trayIcons.map((t, i) => '<button class="ti" data-ti="' + i + '" title="' + esc(t.title) + '">' +
      (t.icon ? '<img src="' + esc(t.icon) + '" alt="">' : '<span class="letter">' + esc((t.title || '?').charAt(0).toUpperCase()) + '</span>') + '</button>').join('');
    if (html !== trayHtml) { trayHtml = html; $('#tray').innerHTML = html; }
    island.classList.toggle('has-tray', trayIcons.length > 0);
  }
  $('#tray').addEventListener('click', e => { const b = e.target.closest('[data-ti]'); if (b && trayIcons[+b.dataset.ti]) api.trayClick(trayIcons[+b.dataset.ti].id, 'left'); });
  $('#tray').addEventListener('contextmenu', e => { const b = e.target.closest('[data-ti]'); if (b && trayIcons[+b.dataset.ti]) { e.preventDefault(); api.trayClick(trayIcons[+b.dataset.ti].id, 'right'); } });

  // ---------- Uhr ----------
  function tick() { const d = new Date(); $('#clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  tick(); setInterval(tick, 5000);

  // ---------- Musik ----------
  const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const noArt = 'linear-gradient(135deg,#ffb454,#c2456b)';
  let media = { has: false, playing: false, pos: 0, dur: 0, at: 0 };
  island.style.setProperty('--art', noArt);
  function showMedia() {
    const m = media;
    $('#idleMusic').hidden = !m.has; $('#idleVol').hidden = m.has;
    island.classList.toggle('paused', !(m.has && m.playing));
    $('#mTitle').textContent = m.has ? (m.title || 'Unbekannter Titel') : 'Keine Wiedergabe';
    $('#mArtist').textContent = m.has ? (m.artist || m.app || '') : 'Starte Musik in Spotify, im Browser oder einem anderen Player.';
    $('#chipTitle').textContent = m.has ? (m.title || 'Musik') : 'Keine Wiedergabe';
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
  }
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

  // ---------- Einstellungen ----------
  function toggle(id, fn) {
    $(id).addEventListener('click', () => { const on = $(id).getAttribute('aria-pressed') !== 'true'; $(id).setAttribute('aria-pressed', on); fn(on); });
  }
  toggle('#tTaskbar', api.setHideTaskbar);
  toggle('#tAuto', api.setAutostart);
  toggle('#tGlass', on => { api.setGlass(on); setTimeout(() => setGlass(on), 150); });
  toggle('#tFrames', api.setFrames);
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

  // ---------- Timer ----------
  let left = 720, running = false;
  function showTimer() { const s = fmt(left).padStart(5, '0'); $('#time').textContent = s; $('#timerChip').textContent = s; $('#tToggle').textContent = running ? 'Pause' : 'Start'; }
  $('#tToggle').addEventListener('click', () => { if (left > 0) { running = !running; showTimer(); } });
  $('#tPlus').addEventListener('click', () => { left += 60; showTimer(); });
  $('#tReset').addEventListener('click', () => { left = 720; running = false; showTimer(); });
  showTimer();

  setInterval(() => {
    showPos();
    if (running) { left--; if (left <= 0) { left = 0; running = false; toast('Timer abgelaufen', 4000); } showTimer(); }
  }, 1000);

  // ---------- Ereignisse vom Helfer ----------
  api.on('ev', ev => {
    if (ev.t === 'media') { media = Object.assign({ at: Date.now() }, ev); showMedia(); }
    else if (ev.t === 'thumb') island.style.setProperty('--art', ev.data ? 'url("' + ev.data + '")' : noArt);
    else if (ev.t === 'volume') {
      const v = Math.round(ev.level * 100), key = v + '|' + ev.muted;
      showVol(v, ev.muted);
      if (lastVol !== null && key !== lastVol) volOsd(v, ev.muted);
      lastVol = key;
    }
    else if (ev.t === 'toast') toast(ev.m);
    else if (ev.t === 'notif') { if (state === 'idle' || state === 'vol' || state === 'toast' || state === 'hub') toast([ev.title, ev.body].filter(Boolean).join(' – '), 5000, ev.app); }
    else if (ev.t === 'notifyState') showNotifyState(ev);
    else if (ev.t === 'tray') renderTray(ev);
    else if (ev.t === 'notifAccess') { if (!ev.ok) $('#nHint').textContent = 'Windows gibt die Mitteilungen noch nicht frei. Erlaube den Zugriff unter Einstellungen → Datenschutz und Sicherheit → Benachrichtigungen.'; }
    else if (ev.t === 'theme') $('#tLight').setAttribute('aria-pressed', !!ev.light);
    else if (ev.t === 'visible') { if (glassOn) { if (ev.on) startGlass(); else stopGlass(); } }
  });

  api.ready().then(s => {
    $('#tTaskbar').setAttribute('aria-pressed', !!s.hideTaskbar);
    $('#tAuto').setAttribute('aria-pressed', !!s.autostart);
    $('#tGlass').setAttribute('aria-pressed', !!s.glass);
    $('#tFrames').setAttribute('aria-pressed', !!s.frames);
    showNotifyState(s.notify);
    (s.widgets || []).forEach(w => { const b = document.querySelector('[data-widget="' + w.name + '"]'); if (b) b.setAttribute('aria-pressed', !!w.on); });
    glassOn = !!s.glass; if (glassOn) setTimeout(startGlass, 300);
  });
  showMedia();
})();
