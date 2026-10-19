/*!
 * elevation-profile.js — profil elevasi interaktif untuk Peta Jalur Kerinci
 * Tanpa dependensi. Satu file: JS + CSS (disuntik otomatis).
 *
 * Pakai:
 *   KerinciElevation.mount({
 *     container: '#profil',
 *     gpxUrl: 'data/jalur_trail_kerinci_fress.gpx',
 *     onHover: p => marker.setLatLng([p.lat, p.lon]),   // p: {lat,lon,dist,ele,grade,gain,waypoint}
 *     onLeave: () => marker.remove()
 *   });
 *
 * Elevasi: dipakai dari <ele> di GPX bila ada. Bila tidak ada, diambil sekali dari
 * Open-Meteo Elevation API (butuh sinyal) lalu disimpan di localStorage untuk offline.
 */
(function (global) {
  'use strict';

  /* ---------- gaya ---------- */
  var CSS = [
    '.kep{--ink:#14301f;--mute:#5d7064;--line:#d9e0d6;--bg:#fbfbf8;--accent:#e0502d;',
    'font-family:inherit;background:var(--bg);color:var(--ink);border-radius:16px 16px 0 0;',
    'padding:12px 12px 10px;-webkit-user-select:none;user-select:none}',
    '.kep-tabs{display:flex;gap:6px;margin:0 0 10px;overflow-x:auto;scrollbar-width:none}',
    '.kep-tabs::-webkit-scrollbar{display:none}',
    '.kep-tab{flex:0 0 auto;border:1px solid var(--line);background:#fff;color:var(--ink);',
    'font:inherit;font-size:13px;padding:5px 12px;border-radius:999px;cursor:pointer}',
    '.kep-tab[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:#fff}',
    '.kep-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:0 0 6px}',
    '.kep-stat{min-width:0}',
    '.kep-stat b{display:block;font-size:19px;line-height:1.15;font-weight:650;',
    'font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.kep-stat b small{font-size:12px;font-weight:500;color:var(--mute);margin-left:2px}',
    '.kep-stat span{display:block;font-size:12px;color:var(--mute);white-space:nowrap}',
    '.kep-wp{height:16px;font-size:12px;color:var(--accent);font-weight:600;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 0 2px}',
    '.kep-chart{position:relative;touch-action:pan-y;outline:none}',
    '.kep-chart:focus-visible{box-shadow:0 0 0 2px var(--ink);border-radius:6px}',
    '.kep svg{display:block;width:100%;height:auto;overflow:visible}',
    '.kep-grid{stroke:var(--line);stroke-width:1}',
    '.kep-axis{fill:var(--mute);font-size:11px;font-variant-numeric:tabular-nums}',
    '.kep-cross{stroke:var(--ink);stroke-width:1;stroke-dasharray:3 3}',
    '.kep-dot{fill:#fff;stroke:var(--ink);stroke-width:2.5}',
    '.kep-wpdot{fill:#fff;stroke:var(--ink);stroke-width:1.5}',
    '.kep-legend{display:flex;gap:12px;margin:6px 0 0;font-size:11px;color:var(--mute);flex-wrap:wrap}',
    '.kep-legend i{display:inline-block;width:14px;height:4px;border-radius:2px;margin-right:4px;vertical-align:middle}',
    '.kep-msg{padding:28px 8px;text-align:center;font-size:13px;color:var(--mute)}',
    '.kep-msg button{margin-top:8px;font:inherit;font-size:13px;padding:6px 14px;border-radius:999px;',
    'border:1px solid var(--ink);background:#fff;color:var(--ink);cursor:pointer}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('kep-css')) return;
    var s = document.createElement('style');
    s.id = 'kep-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- util ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  function fmt(n, d) {
    d = d || 0;
    return n.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function hav(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function svg(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function childText(node, tag) {
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].localName === tag) return node.children[i].textContent;
    }
    return null;
  }

  /* ---------- GPX ---------- */
  function parseGPX(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX tidak valid');
    function pts(parent, tag) {
      return Array.prototype.map.call(parent.getElementsByTagName(tag), function (p) {
        var e = childText(p, 'ele');
        return {
          lat: parseFloat(p.getAttribute('lat')),
          lon: parseFloat(p.getAttribute('lon')),
          ele: e === null || e === '' || isNaN(+e) ? null : +e
        };
      });
    }
    var tracks = Array.prototype.map.call(doc.getElementsByTagName('trk'), function (t, i) {
      return { name: childText(t, 'name') || 'Jalur ' + (i + 1), pts: pts(t, 'trkpt') };
    });
    if (!tracks.length) {
      tracks = Array.prototype.map.call(doc.getElementsByTagName('rte'), function (t, i) {
        return { name: childText(t, 'name') || 'Jalur ' + (i + 1), pts: pts(t, 'rtept') };
      });
    }
    tracks = tracks.filter(function (t) { return t.pts.length > 1; });
    var wpts = Array.prototype.map.call(doc.getElementsByTagName('wpt'), function (w) {
      return { name: childText(w, 'name') || '', lat: +w.getAttribute('lat'), lon: +w.getAttribute('lon') };
    }).filter(function (w) { return w.name; });
    return { tracks: tracks, waypoints: wpts };
  }

  /* ---------- hitung profil ---------- */
  // Resample jarak seragam (lat/lon/ele), tanpa penghalusan; elevasi bisa null.
  function resample(pts, maxSamples) {
    var n = pts.length, d = [0], i;
    for (i = 1; i < n; i++) d[i] = d[i - 1] + hav(pts[i - 1], pts[i]);
    var total = d[n - 1];
    var step = Math.max(25, total / (maxSamples || 400));
    var N = Math.max(2, Math.round(total / step)) + 1;
    var hasEle = pts.every(function (p) { return p.ele !== null; });
    var out = [], j = 0;
    for (var k = 0; k < N; k++) {
      var s = total * k / (N - 1);
      while (j < n - 2 && d[j + 1] < s) j++;
      var seg = d[j + 1] - d[j] || 1, t = Math.min(1, Math.max(0, (s - d[j]) / seg));
      var a = pts[j], b = pts[j + 1];
      out.push({
        s: s,
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        ele: hasEle ? a.ele + (b.ele - a.ele) * t : null
      });
    }
    return { samples: out, total: total, hasEle: hasEle };
  }

  function smooth(arr, r) {
    return arr.map(function (_, i) {
      var sum = 0, c = 0;
      for (var k = Math.max(0, i - r); k <= Math.min(arr.length - 1, i + r); k++) { sum += arr[k]; c++; }
      return sum / c;
    });
  }

  function finalize(samples) {
    var ele = smooth(samples.map(function (p) { return p.ele; }), 2);
    var n = samples.length, i;
    // Kemiringan: selisih elevasi ±4 sampel (~200 m), lalu dihaluskan
    var grade = [];
    for (i = 0; i < n; i++) {
      var a = Math.max(0, i - 4), b = Math.min(n - 1, i + 4);
      var ds = samples[b].s - samples[a].s;
      grade.push(ds > 0 ? (ele[b] - ele[a]) / ds * 100 : 0);
    }
    // Naik/turun kumulatif dengan ambang 3 m agar noise tidak dihitung
    var gain = [0], loss = 0, totalGain = 0, ref = ele[0], TH = 3;
    for (i = 1; i < n; i++) {
      var diff = ele[i] - ref;
      if (diff >= TH) { totalGain += diff; ref = ele[i]; }
      else if (diff <= -TH) { loss += -diff; ref = ele[i]; }
      gain.push(totalGain);
    }
    return {
      s: samples.map(function (p) { return p.s; }),
      lat: samples.map(function (p) { return p.lat; }),
      lon: samples.map(function (p) { return p.lon; }),
      ele: ele, grade: grade, gain: gain,
      total: samples[n - 1].s,
      totalGain: totalGain, totalLoss: loss,
      min: Math.min.apply(null, ele), max: Math.max.apply(null, ele)
    };
  }

  /* ---------- elevasi dari Open-Meteo (cadangan, di-cache) ---------- */
  function cacheKey(samples) {
    var f = samples[0], l = samples[samples.length - 1];
    return 'kep-ele:' + samples.length + ':' + f.lat.toFixed(4) + ',' + f.lon.toFixed(4) +
      ':' + l.lat.toFixed(4) + ',' + l.lon.toFixed(4);
  }
  function fetchElevations(samples) {
    var key = cacheKey(samples);
    try {
      var c = localStorage.getItem(key);
      if (c) { var arr = JSON.parse(c); if (arr.length === samples.length) return Promise.resolve(arr); }
    } catch (e) { /* abaikan */ }
    var jobs = [];
    for (var i = 0; i < samples.length; i += 100) {
      var chunk = samples.slice(i, i + 100);
      var url = 'https://api.open-meteo.com/v1/elevation?latitude=' +
        chunk.map(function (p) { return p.lat.toFixed(5); }).join(',') +
        '&longitude=' + chunk.map(function (p) { return p.lon.toFixed(5); }).join(',');
      jobs.push(fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) { return j.elevation; }));
    }
    return Promise.all(jobs).then(function (parts) {
      var all = [].concat.apply([], parts);
      try { localStorage.setItem(key, JSON.stringify(all)); } catch (e) { /* penuh/diblokir */ }
      return all;
    });
  }

  function gradeColor(g) {
    var a = Math.abs(g);
    if (a < 5) return '#2f9e6b';
    if (a < 10) return '#d9a21b';
    if (a < 18) return '#e8662f';
    return '#b3261e';
  }

  /* ---------- komponen ---------- */
  function mount(opts) {
    injectCSS();
    var host = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!host) throw new Error('container tidak ditemukan');
    host.innerHTML = '';
    var root = document.createElement('div');
    root.className = 'kep';
    host.appendChild(root);

    var state = { views: [], active: 0, prof: null, idx: null, waypoints: [] };

    function msg(text, retry) {
      root.innerHTML = '';
      var m = document.createElement('div');
      m.className = 'kep-msg';
      m.textContent = text;
      if (retry) {
        var b = document.createElement('button');
        b.textContent = 'Coba lagi';
        b.onclick = load;
        m.appendChild(document.createElement('br'));
        m.appendChild(b);
      }
      root.appendChild(m);
    }

    function load() {
      msg('Memuat profil elevasi…');
      fetch(opts.gpxUrl).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (txt) {
        var g = parseGPX(txt);
        if (!g.tracks.length) throw new Error('GPX tidak berisi jalur');
        state.waypoints = g.waypoints;
        var all = [].concat.apply([], g.tracks.map(function (t) { return t.pts; }));
        var views = [{ name: 'Semua', pts: all }];
        if (g.tracks.length > 1) g.tracks.forEach(function (t) { views.push({ name: t.name, pts: t.pts }); });
        return Promise.all(views.map(function (v) {
          var rs = resample(v.pts, 400);
          if (rs.hasEle) return { name: v.name, prof: finalize(rs.samples) };
          return fetchElevations(rs.samples).then(function (el) {
            rs.samples.forEach(function (p, i) { p.ele = el[i]; });
            return { name: v.name, prof: finalize(rs.samples) };
          });
        }));
      }).then(function (views) {
        state.views = views;
        state.active = 0;
        draw();
      }).catch(function (err) {
        var offlineHint = /fetch|network|HTTP/i.test(String(err.message))
          ? 'Elevasi belum bisa dimuat. Buka sekali saat ada sinyal agar tersimpan untuk offline.'
          : 'Gagal memuat profil: ' + err.message;
        msg(offlineHint, true);
      });
    }

    function nearestWp(i, prof) {
      var best = null, bd = 120;
      state.waypoints.forEach(function (w) {
        var d = hav({ lat: prof.lat[i], lon: prof.lon[i] }, w);
        if (d < bd) { bd = d; best = w; }
      });
      return best;
    }

    function draw() {
      var view = state.views[state.active], P = view.prof;
      state.prof = P;
      root.innerHTML = '';

      // tab jalur
      if (state.views.length > 1) {
        var tabs = document.createElement('div');
        tabs.className = 'kep-tabs';
        state.views.forEach(function (v, i) {
          var b = document.createElement('button');
          b.className = 'kep-tab';
          b.textContent = v.name;
          b.setAttribute('aria-pressed', i === state.active ? 'true' : 'false');
          b.onclick = function () { state.active = i; state.idx = null; if (opts.onLeave) opts.onLeave(); draw(); };
          tabs.appendChild(b);
        });
        root.appendChild(tabs);
      }

      var stats = document.createElement('div'); stats.className = 'kep-stats'; root.appendChild(stats);
      var wpLine = document.createElement('div'); wpLine.className = 'kep-wp'; root.appendChild(wpLine);
      var chart = document.createElement('div'); chart.className = 'kep-chart'; chart.tabIndex = 0;
      chart.setAttribute('role', 'img');
      chart.setAttribute('aria-label', 'Profil elevasi. Gunakan panah kiri dan kanan untuk menjelajah.');
      root.appendChild(chart);

      var leg = document.createElement('div'); leg.className = 'kep-legend';
      [['#2f9e6b', 'landai <5%'], ['#d9a21b', '5–10%'], ['#e8662f', '10–18%'], ['#b3261e', 'curam >18%']]
        .forEach(function (x) {
          var s = document.createElement('span');
          s.innerHTML = '<i style="background:' + x[0] + '"></i>' + x[1];
          leg.appendChild(s);
        });
      root.appendChild(leg);

      function setStats(items) {
        stats.innerHTML = items.map(function (it) {
          return '<div class="kep-stat"><b>' + it[1] + '<small>' + it[2] + '</small></b><span>' + it[0] + '</span></div>';
        }).join('');
      }
      function summary() {
        setStats([
          ['Jarak', fmt(P.total / 1000, 1), 'km'],
          ['Naik', fmt(Math.round(P.totalGain)), 'm'],
          ['Turun', fmt(Math.round(P.totalLoss)), 'm'],
          ['Tertinggi', fmt(Math.round(P.max)), 'm']
        ]);
        wpLine.textContent = '';
      }
      summary();

      var W, H = 176, pl = 38, pr = 10, pt = 10, pb = 22, svgEl, cross, dot;
      var lo, hi, step;

      function build() {
        W = Math.max(280, chart.clientWidth || 340);
        chart.innerHTML = '';
        svgEl = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'aria-hidden': 'true' });
        var rng = P.max - P.min;
        var cands = [50, 100, 200, 250, 500, 1000];
        step = cands.filter(function (c) { return (rng + 40) / c <= 4.5; })[0] || 1000;
        lo = Math.floor((P.min - 15) / step) * step;
        hi = Math.ceil((P.max + 15) / step) * step;
        function X(s) { return pl + s / P.total * (W - pl - pr); }
        function Y(e) { return pt + (hi - e) / (hi - lo) * (H - pt - pb); }
        build.X = X; build.Y = Y;

        // grid + sumbu Y
        for (var v = lo; v <= hi; v += step) {
          svgEl.appendChild(svg('line', { class: 'kep-grid', x1: pl, x2: W - pr, y1: Y(v), y2: Y(v) }));
          var t = svg('text', { class: 'kep-axis', x: pl - 6, y: Y(v) + 4, 'text-anchor': 'end' });
          t.textContent = fmt(v); svgEl.appendChild(t);
        }
        // sumbu X (km)
        var kmStep = P.total > 15000 ? 5 : P.total > 6000 ? 2 : 1;
        for (var km = 0; km * 1000 <= P.total; km += kmStep) {
          var tx = svg('text', { class: 'kep-axis', x: X(km * 1000), y: H - 5,
            'text-anchor': km === 0 ? 'start' : 'middle' });
          tx.textContent = km + ' km'; svgEl.appendChild(tx);
        }

        // area gradien
        var defs = svg('defs', {});
        var grad = svg('linearGradient', { id: 'kep-fill', x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.appendChild(svg('stop', { offset: '0', 'stop-color': '#14532d', 'stop-opacity': '.28' }));
        grad.appendChild(svg('stop', { offset: '1', 'stop-color': '#14532d', 'stop-opacity': '.03' }));
        defs.appendChild(grad); svgEl.appendChild(defs);
        var d = 'M' + X(0) + ',' + Y(lo);
        P.s.forEach(function (s, i) { d += ' L' + X(s).toFixed(1) + ',' + Y(P.ele[i]).toFixed(1); });
        d += ' L' + X(P.total) + ',' + Y(lo) + ' Z';
        svgEl.appendChild(svg('path', { d: d, fill: 'url(#kep-fill)' }));

        // garis berwarna per kemiringan (run dengan warna sama digabung)
        var runColor = null, runD = '';
        function flush() {
          if (runD) svgEl.appendChild(svg('path', { d: runD, fill: 'none', stroke: runColor,
            'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        }
        for (var i = 1; i < P.s.length; i++) {
          var c = gradeColor(P.grade[i]);
          var x0 = X(P.s[i - 1]).toFixed(1), y0 = Y(P.ele[i - 1]).toFixed(1);
          var x1 = X(P.s[i]).toFixed(1), y1 = Y(P.ele[i]).toFixed(1);
          if (c !== runColor) { flush(); runColor = c; runD = 'M' + x0 + ',' + y0; }
          runD += ' L' + x1 + ',' + y1;
        }
        flush();

        // titik pos penting
        state.waypoints.forEach(function (w) {
          var bi = -1, bd = 120;
          for (var k = 0; k < P.s.length; k++) {
            var dd = hav({ lat: P.lat[k], lon: P.lon[k] }, w);
            if (dd < bd) { bd = dd; bi = k; }
          }
          if (bi >= 0) svgEl.appendChild(svg('circle', { class: 'kep-wpdot', cx: X(P.s[bi]), cy: Y(P.ele[bi]), r: 3.5 }));
        });

        cross = svg('line', { class: 'kep-cross', y1: pt, y2: H - pb, x1: 0, x2: 0, visibility: 'hidden' });
        dot = svg('circle', { class: 'kep-dot', r: 5, cx: 0, cy: 0, visibility: 'hidden' });
        svgEl.appendChild(cross); svgEl.appendChild(dot);
        chart.appendChild(svgEl);
        if (state.idx !== null) show(state.idx, true);
      }

      function show(i, silent) {
        i = Math.max(0, Math.min(P.s.length - 1, i));
        state.idx = i;
        var x = build.X(P.s[i]), y = build.Y(P.ele[i]);
        cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
        var g = P.grade[i], wp = nearestWp(i, P);
        setStats([
          ['Jarak', fmt(P.s[i] / 1000, 2), 'km'],
          ['Elevasi', fmt(Math.round(P.ele[i])), 'm'],
          ['Kemiringan', (g > 0 ? '+' : '') + fmt(g, 0), '%'],
          ['Sudah naik', fmt(Math.round(P.gain[i])), 'm']
        ]);
        wpLine.textContent = wp ? '● ' + wp.name : '';
        if (!silent && opts.onHover) {
          opts.onHover({ lat: P.lat[i], lon: P.lon[i], dist: P.s[i], ele: P.ele[i], grade: g,
            gain: P.gain[i], waypoint: wp ? wp.name : null });
        }
      }
      function clear() {
        state.idx = null;
        cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
        summary();
        if (opts.onLeave) opts.onLeave();
      }
      function idxFromEvent(e) {
        var r = svgEl.getBoundingClientRect();
        var px = (e.clientX - r.left) * (W / r.width);
        var f = (px - pl) / (W - pl - pr);
        return Math.round(Math.max(0, Math.min(1, f)) * (P.s.length - 1));
      }

      chart.addEventListener('pointerdown', function (e) { show(idxFromEvent(e)); });
      chart.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'mouse' || e.buttons) show(idxFromEvent(e));
      });
      chart.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') clear(); });
      chart.addEventListener('keydown', function (e) {
        var cur = state.idx === null ? 0 : state.idx, k = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight') { show(cur + k); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { show(cur - k); e.preventDefault(); }
        else if (e.key === 'Escape') clear();
      });

      build();
      if (global.ResizeObserver) {
        if (state.ro) state.ro.disconnect();
  
