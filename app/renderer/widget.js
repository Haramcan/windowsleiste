(function () {
  const kind = location.hash.slice(1), root = document.getElementById('wg');
  const pad = n => String(n).padStart(2, '0');

  // Milchglas und Daten vom Hauptprogramm
  const handlers = {};
  if (window.widget && window.widget.onData) window.widget.onData(d => {
    if (d.t === 'geo') {
      const img = document.getElementById('gi'), card = document.getElementById('card');
      if (d.wall) {
        img.src = d.wall; img.hidden = false; card.classList.add('glassy');
        // Lage des Bildschirms relativ zur Glasfläche (Karte beginnt 16 Punkte im Fenster, Glas ragt 40 Punkte darüber hinaus)
        img.style.left = (d.x - 17 + 40) + 'px'; img.style.top = (d.y - 17 + 40) + 'px'; img.style.width = d.w + 'px'; img.style.height = d.h + 'px';
      } else { img.hidden = true; card.classList.remove('glassy'); }
    } else if (handlers[d.t]) handlers[d.t](d);
  });
  const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  if (kind === 'music') {
    const P = 'M5 3.2v11.6a.6.6 0 00.92.5l9-5.8a.6.6 0 000-1l-9-5.8a.6.6 0 00-.92.5z', S = 'M4.5 3h3v12h-3zM10.5 3h3v12h-3z';
    root.innerHTML = '<div class="m-top"><div class="m-art" id="art"></div><div class="m-meta"><strong id="mt">Keine Wiedergabe</strong><small id="ma"></small></div></div>' +
      '<div class="m-ctl"><button data-a="prev"><svg width="16" height="16" viewBox="0 0 18 18" fill="currentColor"><path d="M3 3h1.6v12H3zM16 3.6v10.8a.6.6 0 01-.95.5L7 9.5a.6.6 0 010-1l8.05-5.4a.6.6 0 01.95.5z"/></svg></button>' +
      '<button class="play" data-a="toggle"><svg width="16" height="16" viewBox="0 0 18 18" fill="currentColor"><path id="pi" d="' + P + '"/></svg></button>' +
      '<button data-a="next"><svg width="16" height="16" viewBox="0 0 18 18" fill="currentColor"><path d="M13.4 3H15v12h-1.6zM2 3.6v10.8a.6.6 0 00.95.5L11 9.5a.6.6 0 000-1L2.95 3.1A.6.6 0 002 3.6z"/></svg></button></div>';
    root.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) window.widget.media(b.dataset.a); });
    handlers.media = m => {
      document.getElementById('mt').textContent = m.has ? (m.title || 'Unbekannter Titel') : 'Keine Wiedergabe';
      document.getElementById('ma').textContent = m.has ? (m.artist || '') : '';
      document.getElementById('pi').setAttribute('d', m.has && m.playing ? S : P);
    };
    handlers.thumb = t => { document.getElementById('art').style.backgroundImage = t.data ? 'url("' + t.data + '")' : ''; };
  }

  if (kind === 'note') {
    root.innerHTML = '<h3>Notiz</h3><div class="n-text empty" id="nt">Noch leer. Schreib etwas unter Notizen in der Insel.</div>';
    handlers.note = n => { const el = document.getElementById('nt'); const has = !!(n.text || '').trim(); el.classList.toggle('empty', !has); el.innerHTML = has ? esc(n.text) : 'Noch leer. Schreib etwas unter Notizen in der Insel.'; };
  }

  if (kind === 'clock') {
    root.innerHTML = '<div class="w-time num" id="t"></div><div class="w-date" id="d"></div>';
    const tick = () => {
      const n = new Date();
      document.getElementById('t').textContent = pad(n.getHours()) + ':' + pad(n.getMinutes());
      document.getElementById('d').textContent = n.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    };
    tick(); setInterval(tick, 5000);
  }

  if (kind === 'calendar') {
    let shown = '';
    const draw = () => {
      const d = new Date(), key = d.toDateString();
      if (key === shown) return;
      shown = key;
      const y = d.getFullYear(), m = d.getMonth();
      const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
      let h = '<h3>' + d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) + '</h3><div class="cal num">';
      h += ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(x => '<span class="hd">' + x + '</span>').join('');
      for (let i = 0; i < first; i++) h += '<span></span>';
      for (let i = 1; i <= days; i++) h += '<span' + (i === d.getDate() ? ' class="today"' : '') + '>' + i + '</span>';
      root.innerHTML = h + '</div>';
    };
    draw(); setInterval(draw, 60000);
  }

  if (kind === 'system') {
    root.innerHTML = '<h3>System</h3>' +
      '<div class="meter num"><span>CPU</span><i><u id="cpu"></u></i><em id="cpuV">–</em></div>' +
      '<div class="meter num"><span>RAM</span><i><u id="ram"></u></i><em id="ramV">–</em></div>' +
      '<div class="sub num" id="ramT"></div>';
    window.widget.onStats(s => {
      const c = Math.round(s.cpu * 100), r = Math.round(s.ram * 100);
      document.getElementById('cpu').style.width = c + '%'; document.getElementById('cpuV').textContent = c + ' %';
      document.getElementById('ram').style.width = r + '%'; document.getElementById('ramV').textContent = r + ' %';
      document.getElementById('ramT').textContent = s.ramUsed.toFixed(1).replace('.', ',') + ' von ' + Math.round(s.ramTotal) + ' GB belegt';
    });
  }
})();
