/* bleep-ui.js — waveform region editor + offline render for the bleep-audio tool.
   Depends on: window.BleepAudio (assets/js/bleep-audio.js) and
   window.BLEEP_STRINGS (defined per-page: EN on bleep-audio.html, FR on fr/bleep-audio.html).
   All user-visible text comes from BLEEP_STRINGS.

   Features: drag-to-create regions, move/resize, per-region bleep/mute,
   zoomable waveform (buttons + wheel + double-click reset), transport bar
   (back 5s / play-pause / stop / forward 5s), persistent playhead,
   OfflineAudioContext censored render, 16-bit WAV download. */
(function () {
  'use strict';

  var S = window.BLEEP_STRINGS || {};
  function t(key) { return S[key] || key; }

  var BA = window.BleepAudio;
  var AC = window.AudioContext || window.webkitAudioContext;

  // Element ids (provided by the page)
  var el = {};
  ['bleepDrop', 'bleepFile', 'bleepStage', 'bleepFileInfo', 'bleepWaveWrap',
   'bleepWave', 'bleepRegions', 'bleepPlayhead', 'bleepHint',
   'bleepPlay', 'bleepStop', 'bleepBack', 'bleepFwd',
   'bleepZoomIn', 'bleepZoomOut', 'bleepViewRange',
   'bleepDownload', 'bleepReplace',
   'bleepModeBleep', 'bleepModeMute', 'bleepRegionList'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var decoded = null;          // AudioBuffer
  var fileName = '';
  var regions = [];            // {id, start, end, mode}
  var regionSeq = 0;
  var selectedId = null;
  var defaultMode = 'bleep';
  var peaks = null;

  // Zoom view window (seconds)
  var viewStart = 0, viewEnd = 0;

  // Playback state
  var previewBuf = null, previewKey = '';
  var transport = null;        // {ctx, src, t0, offset}
  var paused = false;
  var playheadTime = 0;        // seconds; the playhead NEVER hides once audio is loaded
  var rendering = false;

  var BLEEP_FREQ = 1000, BLEEP_LEVEL = 0.5, FADE = 0.005;

  function fmt(s) { return BA.formatTime(s); }
  function dur() { return decoded ? decoded.duration : 0; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function viewLen() { return Math.max(0.001, viewEnd - viewStart); }

  function setHint(msg) { if (el.bleepHint) el.bleepHint.textContent = msg || ''; }

  /* ---------- file loading ---------- */

  function loadFile(f) {
    if (!f) return;
    if (!/^audio\//.test(f.type) && !/\.(mp3|wav|m4a|aac|ogg|oga|flac|webm)$/i.test(f.name)) {
      alert(t('notAudio')); return;
    }
    teardownTransport();
    previewBuf = null; previewKey = '';
    setHint(t('decoding'));
    fileName = f.name;
    var off = new OfflineAudioContext(1, 1, 44100);
    f.arrayBuffer().then(function (buf) { return off.decodeAudioData(buf); })
      .then(function (ab) {
        decoded = ab;
        regions = []; selectedId = null;
        viewStart = 0; viewEnd = ab.duration;
        playheadTime = 0;
        var chs = [];
        for (var c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c));
        peaks = BA.computePeaks(BA.mixToMono(chs), 1500);
        el.bleepDrop.style.display = 'none';
        el.bleepStage.style.display = 'block';
        el.bleepFileInfo.textContent = fileName + ' — ' + fmt(ab.duration) + ' · ' +
          ab.numberOfChannels + (ab.numberOfChannels > 1 ? t('chStereo') : t('chMono')) + ' · ' + ab.sampleRate + ' Hz';
        drawWave(); renderRegions(); renderList(); updateButtons();
        positionPlayhead(); updateViewRange();
        setHint(t('hintDraw'));
        if (window.SharedAudio) window.SharedAudio.saveFile(f);
        el.bleepStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function () { alert(t('decodeFail')); setHint(''); });
  }

  /* ---------- zoom ---------- */

  function setView(a, b) {
    var D = dur();
    a = clamp(a, 0, D); b = clamp(b, 0, D);
    if (b - a < 0.5) { var mid = (a + b) / 2; a = mid - 0.25; b = mid + 0.25; }
    a = clamp(a, 0, D); b = clamp(b, 0, D);
    if (b - a < 0.25) return;
    viewStart = a; viewEnd = b;
    drawWave(); renderRegions(); positionPlayhead(); updateViewRange();
  }

  function zoomBy(factor, centerT) {
    var D = dur(); if (!D) return;
    var c = (centerT == null) ? (viewStart + viewEnd) / 2 : clamp(centerT, 0, D);
    var nl = clamp(viewLen() * factor, 0.5, D);
    var frac = (c - viewStart) / viewLen();
    var ns = clamp(c - nl * frac, 0, D - nl);
    setView(ns, ns + nl);
  }

  function updateViewRange() {
    if (el.bleepViewRange) el.bleepViewRange.textContent = fmt(viewStart) + ' – ' + fmt(viewEnd);
  }

  /* ---------- waveform ---------- */

  function drawWave() {
    var canvas = el.bleepWave, wrap = el.bleepWaveWrap;
    if (!canvas || !peaks || !dur()) return;
    var dpr = window.devicePixelRatio || 1;
    var w = wrap.clientWidth, h = 160;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var g = canvas.getContext('2d');
    g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    var n = peaks.length;
    var i0 = Math.floor(viewStart / dur() * n), i1 = Math.ceil(viewEnd / dur() * n);
    i0 = clamp(i0, 0, n - 1); i1 = clamp(i1, i0 + 1, n);
    g.fillStyle = '#D6FF57';
    for (var x = 0; x < w; x++) {
      var bi = i0 + Math.floor(x / w * (i1 - i0));
      var pk = peaks[clamp(bi, 0, n - 1)];
      if (!isFinite(pk) || pk < 0) pk = 0;
      if (pk > 1) pk = 1;
      var ph = Math.max(1, pk * (h / 2 - 6));
      g.fillRect(x, h / 2 - ph, 1, ph * 2);
    }
    g.fillStyle = 'rgba(230,232,236,0.25)';
    g.fillRect(0, h / 2, w, 1);
  }

  function xToTime(x) {
    var r = el.bleepWaveWrap.getBoundingClientRect();
    var frac = clamp((x - r.left) / r.width, 0, 1);
    return viewStart + frac * viewLen();
  }

  /* ---------- regions ---------- */

  function addRegion(start, end, mode) {
    if (end - start < 0.05) return null;
    var r = { id: ++regionSeq, start: Math.min(start, end), end: Math.max(start, end), mode: mode || defaultMode };
    regions.push(r);
    selectedId = r.id;
    afterRegionsChanged();
    return r;
  }

  function afterRegionsChanged() {
    teardownTransport(); // preview cache is stale now
    renderRegions(); renderList(); updateButtons();
  }

  function renderRegions() {
    var layer = el.bleepRegions;
    layer.innerHTML = '';
    if (!dur()) return;
    regions.forEach(function (r) {
      var a = Math.max(r.start, viewStart), b = Math.min(r.end, viewEnd);
      if (b - a <= 0) return; // outside the zoomed view
      var d = document.createElement('div');
      d.className = 'bleep-region bleep-' + r.mode + (r.id === selectedId ? ' sel' : '');
      d.style.left = ((a - viewStart) / viewLen() * 100) + '%';
      d.style.width = Math.max(0.4, (b - a) / viewLen() * 100) + '%';
      d.innerHTML = '<div class="bhandle hl"></div><div class="bhandle hr"></div>' +
        '<span class="blabel">' + fmt(r.start) + '–' + fmt(r.end) + '</span>' +
        '<button type="button" class="bx" aria-label="' + t('delete') + '">×</button>';
      d.querySelector('.bx').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      d.querySelector('.bx').addEventListener('click', function (e) {
        e.stopPropagation(); removeRegion(r.id);
      });
      d.addEventListener('pointerdown', function (e) { onRegionPointerDown(e, r); });
      layer.appendChild(d);
    });
  }

  function removeRegion(id) {
    regions = regions.filter(function (r) { return r.id !== id; });
    if (selectedId === id) selectedId = null;
    afterRegionsChanged();
  }

  function renderList() {
    var box = el.bleepRegionList;
    box.innerHTML = '';
    if (!regions.length) {
      box.innerHTML = '<div class="bleep-empty">' + t('noRegions') + '</div>';
      return;
    }
    regions.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'bleep-row' + (r.id === selectedId ? ' sel' : '');
      row.innerHTML =
        '<button type="button" class="bnum">#' + (i + 1) + '</button>' +
        '<span class="btime">' + fmt(r.start) + ' – ' + fmt(r.end) + '</span>' +
        '<span class="seg">' +
        '<button type="button" data-m="bleep" class="' + (r.mode === 'bleep' ? 'on' : '') + '">🔊 ' + t('modeBleep') + '</button>' +
        '<button type="button" data-m="mute" class="' + (r.mode === 'mute' ? 'on' : '') + '">🔇 ' + t('modeMute') + '</button>' +
        '</span>' +
        '<button type="button" class="bx2" aria-label="' + t('delete') + '">×</button>';
      row.querySelector('.bnum').addEventListener('click', function () {
        selectedId = r.id; renderRegions(); renderList();
      });
      row.querySelectorAll('.seg button').forEach(function (b) {
        b.addEventListener('click', function () {
          r.mode = b.getAttribute('data-m'); afterRegionsChanged();
        });
      });
      row.querySelector('.bx2').addEventListener('click', function () { removeRegion(r.id); });
      box.appendChild(row);
    });
  }

  function updateButtons() {
    var has = regions.length > 0;
    el.bleepDownload.disabled = !has;
    el.bleepModeBleep.classList.toggle('on', defaultMode === 'bleep');
    el.bleepModeMute.classList.toggle('on', defaultMode === 'mute');
    updateTransportUI();
    if (!has) setHint(t('hintDraw'));
  }

  /* ---------- pointer interactions ---------- */

  var drag = null;

  el.bleepWaveWrap.addEventListener('pointerdown', function (e) {
    if (!decoded || e.target.closest('.bleep-region')) return;
    e.preventDefault();
    var startT = xToTime(e.clientX);
    drag = { kind: 'new', startT: startT, curA: startT, curB: startT, el: null };
    var d = document.createElement('div');
    d.className = 'bleep-region bleep-' + defaultMode + ' drawing';
    d.style.left = ((startT - viewStart) / viewLen() * 100) + '%';
    d.style.width = '0.4%';
    el.bleepRegions.appendChild(d);
    drag.el = d;
    try { el.bleepWaveWrap.setPointerCapture(e.pointerId); } catch (err) {}
  });

  el.bleepWaveWrap.addEventListener('dblclick', function (e) {
    if (e.target.closest('.bleep-region')) return;
    setView(0, dur()); // reset zoom
  });

  el.bleepWaveWrap.addEventListener('wheel', function (e) {
    if (!decoded) return;
    e.preventDefault();
    zoomBy(e.deltaY > 0 ? 1.3 : 1 / 1.3, xToTime(e.clientX));
  }, { passive: false });

  function onRegionPointerDown(e, r) {
    if (!decoded) return;
    e.preventDefault(); e.stopPropagation();
    selectedId = r.id; renderRegions(); renderList();
    var kind = 'move';
    if (e.target.classList.contains('hl')) kind = 'resize-l';
    else if (e.target.classList.contains('hr')) kind = 'resize-r';
    drag = { kind: kind, r: r, startX: e.clientX, origStart: r.start, origEnd: r.end };
    try { el.bleepWaveWrap.setPointerCapture(e.pointerId); } catch (err) {}
  }

  el.bleepWaveWrap.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var rect = el.bleepWaveWrap.getBoundingClientRect();
    if (drag.kind === 'new') {
      var dt = xToTime(e.clientX);
      var a = Math.min(drag.startT, dt), b = Math.max(drag.startT, dt);
      drag.curA = a; drag.curB = b;
      drag.el.style.left = ((a - viewStart) / viewLen() * 100) + '%';
      drag.el.style.width = Math.max(0.4, (b - a) / viewLen() * 100) + '%';
    } else {
      var dx = (e.clientX - drag.startX) / rect.width * viewLen();
      var r = drag.r, len = drag.origEnd - drag.origStart, D = dur();
      if (drag.kind === 'move') {
        var ns = clamp(drag.origStart + dx, 0, D - len);
        r.start = ns; r.end = ns + len;
      } else if (drag.kind === 'resize-l') {
        r.start = clamp(drag.origStart + dx, 0, drag.origEnd - 0.05);
      } else {
        r.end = clamp(drag.origEnd + dx, drag.origStart + 0.05, D);
      }
      renderRegions();
    }
  });

  function endDrag() {
    if (!drag) return;
    if (drag.kind === 'new') {
      var r = addRegion(drag.curA, drag.curB, defaultMode);
      if (!r && drag.el) drag.el.remove();
      else setHint(t('hintEdit'));
    } else {
      renderList(); updateButtons();
    }
    drag = null;
  }
  el.bleepWaveWrap.addEventListener('pointerup', endDrag);
  el.bleepWaveWrap.addEventListener('pointercancel', endDrag);

  document.addEventListener('keydown', function (e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId != null && !/INPUT|TEXTAREA/.test(tag)) {
      e.preventDefault(); removeRegion(selectedId);
    }
    if (e.key === 'Escape') { selectedId = null; renderRegions(); renderList(); }
  });

  /* ---------- playhead (never hidden once audio is loaded) ---------- */

  function positionPlayhead() {
    var ph = el.bleepPlayhead;
    if (!decoded) { ph.style.display = 'none'; return; }
    var p = clamp(playheadTime, 0, dur());
    if (p < viewStart || p > viewEnd) {
      ph.style.left = (p < viewStart ? 0 : 100) + '%';
      ph.style.opacity = '0.35'; // pinned at the edge while out of the zoomed view
    } else {
      ph.style.left = ((p - viewStart) / viewLen() * 100) + '%';
      ph.style.opacity = '1';
    }
    ph.style.display = 'block';
  }

  /* ---------- offline render ---------- */

  function renderCensored() {
    var plan = BA.planRender(regions, dur());
    var sr = decoded.sampleRate;
    var len = Math.max(1, Math.ceil(dur() * sr));
    var off = new OfflineAudioContext(decoded.numberOfChannels, len, sr);
    var src = off.createBufferSource(); src.buffer = decoded;
    var master = off.createGain(); src.connect(master); master.connect(off.destination);

    // Chronological guard: automation events must never go backwards in time.
    function auto(param, build) {
      var lastT = 0;
      build(function (fn, time) {
        time = Math.max(time, lastT); lastT = time; fn(time);
      });
    }

    var D = dur();
    auto(master.gain, function (at) {
      at(function (tm) { master.gain.setValueAtTime(1, tm); }, 0);
      plan.segments.forEach(function (s) {
        at(function (tm) { master.gain.setValueAtTime(1, tm); }, Math.max(0, s.start - FADE));
        at(function (tm) { master.gain.linearRampToValueAtTime(0, tm); }, s.start);
        at(function (tm) { master.gain.setValueAtTime(0, tm); }, s.end);
        at(function (tm) { master.gain.linearRampToValueAtTime(1, tm); }, Math.min(D, s.end + FADE));
      });
    });

    plan.segments.forEach(function (s) {
      if (s.mode !== 'bleep') return;
      var osc = off.createOscillator(); osc.type = 'sine'; osc.frequency.value = BLEEP_FREQ;
      var bg = off.createGain(); bg.gain.setValueAtTime(0, 0);
      osc.connect(bg); bg.connect(off.destination);
      auto(bg.gain, function (at) {
        at(function (tm) { bg.gain.setValueAtTime(0, tm); }, Math.max(0, s.start - FADE));
        at(function (tm) { bg.gain.linearRampToValueAtTime(BLEEP_LEVEL, tm); }, s.start);
        at(function (tm) { bg.gain.setValueAtTime(BLEEP_LEVEL, tm); }, s.end);
        at(function (tm) { bg.gain.linearRampToValueAtTime(0, tm); }, Math.min(D, s.end + FADE));
      });
      osc.start(0); osc.stop(D);
    });

    src.start(0);
    return off.startRendering();
  }

  function regionsKey() {
    return regions.map(function (r) {
      return r.id + ':' + r.start.toFixed(2) + '-' + r.end.toFixed(2) + r.mode;
    }).join('|');
  }

  function ensurePreview() {
    var key = regionsKey();
    if (previewBuf && previewKey === key) return Promise.resolve(previewBuf);
    return renderCensored().then(function (buf) {
      previewBuf = buf; previewKey = key;
      return buf;
    });
  }

  /* ---------- transport ---------- */

  function updateTransportUI() {
    var playing = transport && !paused;
    el.bleepPlay.textContent = playing ? '⏸' : '▶';
    el.bleepPlay.setAttribute('aria-label', playing ? t('pause') : t('play'));
    el.bleepPlay.disabled = rendering || !decoded;
    var canSeek = !!decoded;
    el.bleepBack.disabled = !canSeek;
    el.bleepFwd.disabled = !canSeek;
    el.bleepStop.disabled = !transport;
  }

  function teardownTransport() {
    if (transport) {
      try { transport.src.onended = null; transport.src.stop(); } catch (e) {}
      try { transport.ctx.close(); } catch (e) {}
      transport = null;
    }
    paused = false;
    rendering = false;
    if (decoded) { positionPlayhead(); updateTransportUI(); }
  }

  function startTransportAt(buf, offset) {
    teardownTransport();
    offset = clamp(offset, 0, Math.max(0, buf.duration - 0.02));
    var ctx = new AC();
    var src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    var t0 = ctx.currentTime + 0.05;
    try { src.start(t0, offset); } catch (e) { try { ctx.close(); } catch (e2) {} updateTransportUI(); return; }
    transport = { ctx: ctx, src: src, t0: t0, offset: offset };
    paused = false;
    playheadTime = offset;
    src.onended = function () {
      if (transport && transport.src === src) {
        playheadTime = buf.duration;
        teardownTransport();
      }
    };
    updateTransportUI();
    tick();
  }

  function tick() {
    if (!transport || paused) return;
    playheadTime = transport.offset + (transport.ctx.currentTime - transport.t0);
    if (playheadTime >= dur()) {
      playheadTime = dur();
      teardownTransport();
      return;
    }
    // follow the playhead when it leaves the zoomed view
    if (playheadTime > viewEnd || playheadTime < viewStart) {
      var L = viewLen(), ns = clamp(playheadTime - L * 0.3, 0, Math.max(0, dur() - L));
      setView(ns, ns + L);
    } else {
      positionPlayhead();
    }
    requestAnimationFrame(tick);
  }

  function onPlayToggle() {
    if (!decoded || rendering) return;
    if (transport && !paused) { // pause
      playheadTime = transport.offset + (transport.ctx.currentTime - transport.t0);
      paused = true;
      transport.ctx.suspend();
      positionPlayhead(); updateTransportUI();
      return;
    }
    if (transport && paused) { // resume
      paused = false;
      transport.ctx.resume();
      updateTransportUI();
      tick();
      return;
    }
    // start fresh from the playhead
    rendering = true; updateTransportUI();
    el.bleepPlay.textContent = '…';
    ensurePreview().then(function (buf) {
      rendering = false;
      startTransportAt(buf, playheadTime);
    }).catch(function () {
      rendering = false;
      alert(t('renderFail'));
      updateTransportUI();
    });
  }

  function onStop() {
    if (transport && !paused) {
      playheadTime = clamp(transport.offset + (transport.ctx.currentTime - transport.t0), 0, dur());
    }
    teardownTransport(); // playhead stays where it stopped — it never disappears
  }

  function onSeek(dSec) {
    if (!decoded) return;
    var nt = clamp(playheadTime + dSec, 0, dur());
    if (transport && !paused) {
      var buf = previewBuf;
      playheadTime = nt;
      startTransportAt(buf, nt); // restart playing from the new position
    } else {
      teardownTransport();
      playheadTime = nt;
      positionPlayhead();
    }
  }

  el.bleepPlay.addEventListener('click', onPlayToggle);
  el.bleepStop.addEventListener('click', onStop);
  el.bleepBack.addEventListener('click', function () { onSeek(-5); });
  el.bleepFwd.addEventListener('click', function () { onSeek(5); });
  el.bleepZoomIn.addEventListener('click', function () { zoomBy(0.5); });
  el.bleepZoomOut.addEventListener('click', function () { zoomBy(2); });

  /* ---------- download / replace ---------- */

  el.bleepDownload.addEventListener('click', function () {
    if (!decoded || !regions.length || rendering) return;
    rendering = true; updateTransportUI();
    var label = el.bleepDownload.textContent;
    el.bleepDownload.textContent = t('rendering');
    ensurePreview().then(function (buf) {
      var chs = [];
      for (var c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
      var wav = BA.encodeWav(chs, buf.sampleRate);
      var blob = new Blob([wav], { type: 'audio/wav' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (fileName.replace(/\.[^.]+$/, '') || 'audio') + '-bleeped.wav';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      rendering = false;
      el.bleepDownload.disabled = false;
      el.bleepDownload.textContent = label;
      updateTransportUI();
    }).catch(function () {
      rendering = false;
      alert(t('renderFail'));
      el.bleepDownload.disabled = false;
      el.bleepDownload.textContent = label;
      updateTransportUI();
    });
  });

  el.bleepReplace.addEventListener('click', function () { el.bleepFile.click(); });

  /* ---------- mode default ---------- */

  el.bleepModeBleep.addEventListener('click', function () { defaultMode = 'bleep'; updateButtons(); });
  el.bleepModeMute.addEventListener('click', function () { defaultMode = 'mute'; updateButtons(); });

  /* ---------- inputs ---------- */

  el.bleepDrop.addEventListener('click', function () { el.bleepFile.click(); });
  el.bleepFile.addEventListener('change', function () {
    if (el.bleepFile.files[0]) loadFile(el.bleepFile.files[0]);
    el.bleepFile.value = '';
  });
  ['dragover', 'dragenter'].forEach(function (ev) {
    el.bleepDrop.addEventListener(ev, function (e) { e.preventDefault(); });
  });
  el.bleepDrop.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  document.addEventListener('paste', function (e) {
    var f = (e.clipboardData && e.clipboardData.files || [])[0];
    if (f && /^audio\//.test(f.type)) loadFile(f);
  });

  window.addEventListener('resize', function () {
    if (decoded) { drawWave(); renderRegions(); positionPlayhead(); }
  });

  window.BleepUI = { loadFile: loadFile };

  // Shared audio: pick up the file loaded on another page (Analyzer/Edit),
  // unless this is a fresh visit (then start clean).
  if (window.SharedAudio) {
    window.SharedAudio.wipeIfFresh(['current']).then(function (restore) {
      if (!restore) return;
      window.SharedAudio.loadFile().then(function (f) { if (f && f.size) loadFile(f); });
    });
  }
})();
