(function () {
  const kind = location.hash.slice(1), root = document.getElementById('wg');
  const pad = n => String(n).padStart(2, '0');

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
