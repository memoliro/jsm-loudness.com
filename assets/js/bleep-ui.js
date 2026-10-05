/* bleep-ui.js — waveform region editor + offline render for the bleep-audio tool.
   Depends on: window.BleepAudio (assets/js/bleep-audio.js) and
   window.BLEEP_STRINGS (defined per-page: EN on bleep-audio.html, FR on fr/bleep-audio.html).
   All user-visible text comes from BLEEP_STRINGS. */
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
   'bleepPlay', 'bleepStop', 'bleepDownload', 'bleepReplace',
   'bleepModeBleep', 'bleepModeMute', 'bleepRegionList'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var decoded = null;          // AudioBuffer
  var fileName = '';
  var regions = [];            // {id, start, end, mode}
  var regionSeq = 0;
  var selectedId = null;
  var defaultMode = 'bleep';
  var peaks = null;
  var playing = null;          // {ctx, src, raf}
  var BLEEP_FREQ = 1000, BLEEP_LEVEL = 0.5, FADE = 0.005;

  function fmt(s) { return BA.formatTime(s); }
  function dur() { return decoded ? decoded.duration : 0; }

  function setHint(msg) { if (el.bleepHint) el.bleepHint.textContent = msg || ''; }

  /* ---------- file loading ---------- */

  function loadFile(f) {
    if (!f) return;
    if (!/^audio\//.test(f.type) && !/\.(mp3|wav|m4a|aac|ogg|oga|flac|webm)$/i.test(f.name)) {
      alert(t('notAudio')); return;
    }
    stopPlayback();
    setHint(t('decoding'));
    fileName = f.name;
    // Decode via a throwaway OfflineAudioContext (no autoplay-policy issues).
    var off = new OfflineAudioContext(1, 1, 44100);
    f.arrayBuffer().then(function (buf) { return off.decodeAudioData(buf); })
      .then(function (ab) {
        decoded = ab;
        regions = []; selectedId = null;
        var chs = [];
        for (var c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c));
        peaks = BA.computePeaks(BA.mixToMono(chs), 1500);
        el.bleepDrop.style.display = 'none';
        el.bleepStage.style.display = 'block';
        el.bleepFileInfo.textContent = fileName + ' — ' + fmt(ab.duration) + ' · ' +
          ab.numberOfChannels + (ab.numberOfChannels > 1 ? t('chStereo') : t('chMono')) + ' · ' + ab.sampleRate + ' Hz';
        drawWave(); renderRegions(); renderList(); updateButtons();
        setHint(t('hintDraw'));
        el.bleepStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function () { alert(t('decodeFail')); setHint(''); });
  }

  /* ---------- waveform ---------- */

  function drawWave() {
    var canvas = el.bleepWave, wrap = el.bleepWaveWrap;
    if (!canvas || !peaks) return;
    var dpr = window.devicePixelRatio || 1;
    var w = wrap.clientWidth, h = 160;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var g = canvas.getContext('2d');
    g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    g.fillStyle = '#D6FF57';
    var n = peaks.length, bw = w / n;
    for (var i = 0; i < n; i++) {
      var ph = Math.max(1, peaks[i] * (h / 2 - 6));
      g.fillRect(i * bw, h / 2 - ph, Math.max(1, bw * 0.8), ph * 2);
    }
    g.fillStyle = 'rgba(230,232,236,0.25)';
    g.fillRect(0, h / 2, w, 1);
  }

  function xToTime(x) {
    var r = el.bleepWaveWrap.getBoundingClientRect();
    var frac = Math.max(0, Math.min(1, (x - r.left) / r.width));
    return frac * dur();
  }
  function timeToPct(s) { return (s / dur()) * 100; }

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
    renderRegions(); renderList(); updateButtons();
  }

  function renderRegions() {
    var layer = el.bleepRegions;
    layer.innerHTML = '';
    regions.forEach(function (r) {
      var d = document.createElement('div');
      d.className = 'bleep-region bleep-' + r.mode + (r.id === selectedId ? ' sel' : '');
      d.style.left = timeToPct(r.start) + '%';
      d.style.width = Math.max(0.4, timeToPct(r.end) - timeToPct(r.start)) + '%';
      d.dataset.id = r.id;
      d.innerHTML = '<div class="bhandle hl"></div><div class="bhandle hr"></div>' +
        '<span class="blabel">' + fmt(r.start) + '–' + fmt(r.end) + '</span>' +
        '<button type="button" class="bx" aria-label="' + t('delete') + '">×</button>';
      d.querySelector('.bx').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      d.querySelector('.bx').addEventListener('click', function (e) {
        e.stopPropagation(); removeRegion(r.id);
      });
      d.addEventListener('pointerdown', function (e) { onRegionPointerDown(e, r, d); });
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
    var sorted = regions.slice().sort(function (a, b) { return a.start - b.start; });
    sorted.forEach(function (r, i) {
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
    el.bleepPlay.disabled = !decoded;
    el.bleepModeBleep.classList.toggle('on', defaultMode === 'bleep');
    el.bleepModeMute.classList.toggle('on', defaultMode === 'mute');
    if (!has) setHint(t('hintDraw'));
  }

  /* ---------- pointer interactions ---------- */

  var drag = null;

  el.bleepWaveWrap.addEventListener('pointerdown', function (e) {
    if (!decoded || e.target.closest('.bleep-region')) return;
    e.preventDefault();
    var startT = xToTime(e.clientX);
    drag = { kind: 'new', startT: startT, el: null };
    var d = document.createElement('div');
    d.className = 'bleep-region bleep-' + defaultMode + ' drawing';
    el.bleepRegions.appendChild(d);
    drag.el = d;
    el.bleepWaveWrap.setPointerCapture(e.pointerId);
  });

  function onRegionPointerDown(e, r, d) {
    if (!decoded) return;
    e.preventDefault(); e.stopPropagation();
    selectedId = r.id; renderRegions(); renderList();
    var kind = 'move';
    if (e.target.classList.contains('hl')) kind = 'resize-l';
    else if (e.target.classList.contains('hr')) kind = 'resize-r';
    drag = { kind: kind, r: r, startX: e.clientX, origStart: r.start, origEnd: r.end };
    el.bleepWaveWrap.setPointerCapture(e.pointerId);
  }

  el.bleepWaveWrap.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var rect = el.bleepWaveWrap.getBoundingClientRect();
    var dt = ((e.clientX - rect.left) / rect.width) * dur();
    if (drag.kind === 'new') {
      var a = Math.min(drag.startT, dt), b = Math.max(drag.startT, dt);
      drag.el.style.left = timeToPct(a) + '%';
      drag.el.style.width = Math.max(0.2, timeToPct(b) - timeToPct(a)) + '%';
      drag.curA = a; drag.curB = b;
    } else {
      var dx = (e.clientX - drag.startX) / rect.width * dur();
      var r = drag.r, len = drag.origEnd - drag.origStart;
      if (drag.kind === 'move') {
        var ns = Math.max(0, Math.min(dur() - len, drag.origStart + dx));
        r.start = ns; r.end = ns + len;
      } else if (drag.kind === 'resize-l') {
        r.start = Math.max(0, Math.min(drag.origEnd - 0.05, drag.origStart + dx));
      } else {
        r.end = Math.min(dur(), Math.max(drag.origStart + 0.05, drag.origEnd + dx));
      }
      renderRegions();
    }
  });

  function endDrag() {
    if (!drag) return;
    if (drag.kind === 'new') {
      var r = addRegion(drag.curA == null ? drag.startT : drag.curA, drag.curB == null ? drag.startT : drag.curB, defaultMode);
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId != null &&
        !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); removeRegion(selectedId);
    }
    if (e.key === 'Escape') { selectedId = null; renderRegions(); renderList(); }
  });

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
      function at(fn, time) { time = Math.max(time, lastT); lastT = time; fn(time); }
      build(at);
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

  /* ---------- preview playback ---------- */

  function stopPlayback() {
    if (!playing) return;
    try { playing.src.stop(); } catch (e) {}
    try { playing.ctx.close(); } catch (e) {}
    cancelAnimationFrame(playing.raf);
    playing = null;
    el.bleepPlayhead.style.display = 'none';
    el.bleepPlay.disabled = false;
    el.bleepPlay.textContent = '▶ ' + t('play');
  }

  el.bleepPlay.addEventListener('click', function () {
    if (!decoded || playing) return;
    el.bleepPlay.disabled = true;
    el.bleepPlay.textContent = t('rendering');
    renderCensored().then(function (buf) {
      var ctx = new AC();
      var src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      var t0 = ctx.currentTime + 0.05;
      src.start(t0);
      el.bleepPlayhead.style.display = 'block';
      el.bleepPlay.textContent = '⏸ ' + t('playing');
      var ph = el.bleepPlayhead;
      function tick() {
        if (!playing) return;
        var pos = (ctx.currentTime - t0) / buf.duration;
        if (pos >= 1) { stopPlayback(); return; }
        ph.style.left = (pos * 100) + '%';
        playing.raf = requestAnimationFrame(tick);
      }
      playing = { ctx: ctx, src: src, raf: requestAnimationFrame(tick) };
      src.onended = function () { stopPlayback(); };
    }).catch(function () {
      alert(t('renderFail'));
      el.bleepPlay.disabled = false;
      el.bleepPlay.textContent = '▶ ' + t('play');
    });
  });
  el.bleepStop.addEventListener('click', stopPlayback);

  /* ---------- download / replace ---------- */

  el.bleepDownload.addEventListener('click', function () {
    if (!decoded || !regions.length) return;
    el.bleepDownload.disabled = true;
    var label = el.bleepDownload.textContent;
    el.bleepDownload.textContent = t('rendering');
    renderCensored().then(function (buf) {
      var chs = [];
      for (var c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
      var wav = BA.encodeWav(chs, buf.sampleRate);
      var blob = new Blob([wav], { type: 'audio/wav' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (fileName.replace(/\.[^.]+$/, '') || 'audio') + '-bleeped.wav';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      el.bleepDownload.disabled = false;
      el.bleepDownload.textContent = label;
    }).catch(function () {
      alert(t('renderFail'));
      el.bleepDownload.disabled = false;
      el.bleepDownload.textContent = label;
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
    if (decoded) { drawWave(); renderRegions(); }
  });

  // Public: lets the page show the tool if it wants (not used by default).
  window.BleepUI = { loadFile: loadFile };
})();
