/* JSM Loudness — Stem Splitter UI
 * Decodes the visitor's file locally, hands the samples to stem-worker.js
 * (HTDemucs ONNX), then provides a 4-stem mixer with per-stem WAV/MP3
 * downloads. Nothing is uploaded — the file never leaves the device.
 * UI strings can be overridden per language via window.STEM_STRINGS
 * (same pattern as the trim tool's TRIM_STRINGS).
 */
(function () {
  'use strict';

  var S = {
    stems: {
      vocals: { label: 'Vocals', hint: 'Lead & backing vocals' },
      drums: { label: 'Drums', hint: 'Kick, snare, hats, percussion' },
      bass: { label: 'Bass', hint: 'Bass guitar, synth bass, 808s' },
      other: { label: 'Other', hint: 'Guitars, keys, synths, strings' }
    },
    mute: 'Mute', solo: 'Solo', volume: 'volume',
    decoding: 'Decoding {name}…',
    tooLong: 'That track is {dur} — for reliability in the browser, please use a song up to 12 minutes.',
    decodeFail: 'Could not decode that file. Try MP3, WAV, M4A, OGG or FLAC.',
    fileInfo: '{name} — {dur}, {ch}, resampled to 44.1 kHz for the model.',
    stereo: 'stereo', mono: 'mono',
    modelCached: 'AI model loaded from cache.',
    modelDl: 'Downloading the AI model (one time, {total}) — {pct}%',
    modelDlUnknown: 'Downloading the AI model (one time, ~172 MB)…',
    ready: 'Engine ready — {backend}. Your audio stays on this device.',
    engineError: 'Engine error: {msg}',
    separating: 'Separating… {done} / {total} segments ({pct}%)',
    starting: 'Starting the AI engine… (the first visit downloads the model once)',
    done: 'Done — four stems, separated on your device. Nothing was uploaded.',
    mp3Loading: 'Loading the MP3 encoder…',
    mp3Fail: 'MP3 encoder failed to load — WAV works.',
    mp3Unavailable: 'MP3 encoder unavailable in this browser — WAV works.',
    share: 'Share', copied: '✓ Copied',
    shareText: 'Split any song into vocals, drums, bass & other with AI — free, in your browser:'
  };
  if (window.STEM_STRINGS) {
    for (var k in window.STEM_STRINGS) {
      if (k === 'stems') {
        for (var sk in window.STEM_STRINGS.stems) S.stems[sk] = window.STEM_STRINGS.stems[sk];
      } else S[k] = window.STEM_STRINGS[k];
    }
  }
  function T(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (m, key) { return vars && vars[key] !== undefined ? vars[key] : m; });
  }

  /* Asset base derived from this script's own URL, so the same file works
   * from / and /fr/ (the trim tool's lameUrl trick). */
  var BASE = '';
  (function () {
    var sc = document.currentScript;
    var src = sc ? sc.getAttribute('src') : 'assets/js/stem-ui.js';
    BASE = src.split('?')[0].replace(/stem-ui\.js$/, '');
  })();

  var SR = 44100;
  var MAX_SECONDS = 12 * 60;
  var STEM_ORDER = ['vocals', 'drums', 'bass', 'other'];

  function $(id) { return document.getElementById(id); }
  var el = {
    drop: $('stemDrop'), file: $('stemFile'), stage: $('stemStage'),
    fileInfo: $('stemFileInfo'), status: $('stemStatus'), warn: $('stemWarn'),
    modelWrap: $('stemModelWrap'), modelBar: $('stemModelBar'), modelText: $('stemModelText'),
    progWrap: $('stemProgWrap'), progBar: $('stemProgBar'), progText: $('stemProgText'),
    mixer: $('stemMixer'), play: $('stemPlay'), time: $('stemTime'),
    seek: $('stemSeek'), seekFill: $('stemSeekFill'),
    cards: $('stemCards'), dlAll: $('stemDlAll'), dlInst: $('stemDlInst'), shareInst: $('stemShareInst'), shareTool: $('stemShareTool'),
    reset: $('stemReset'), engine: $('stemEngine')
  };
  if (!el.drop) return;

  var worker = null;
  var baseName = 'track';
  var mixLen = 0;
  var stems = null;
  var buffers = {};
  var actx = null;
  var gains = {};
  var sources = {};
  var state = {};
  var playing = false;
  var soloPlay = null;
  var startCtxTime = 0;
  var startOffset = 0;
  var rafId = 0;
  var busy = false;

  STEM_ORDER.forEach(function (s) { state[s] = { mute: false, solo: false, vol: 1 }; });

  function fmtTime(sec) {
    sec = Math.max(0, sec || 0);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtMB(bytes) { return (bytes / 1048576).toFixed(0) + ' MB'; }
  function setStatus(t) { if (el.status) el.status.textContent = t || ''; }

  /* ---------- worker ---------- */
  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(BASE + 'stem-worker.js?v=20261022-4');
    worker.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === 'model-progress') {
        el.modelWrap.style.display = 'block';
        if (m.cached) {
          el.modelBar.style.width = '100%';
          el.modelText.textContent = S.modelCached;
        } else if (m.total > 0) {
          var pct = Math.round((m.loaded / m.total) * 100);
          el.modelBar.style.width = pct + '%';
          el.modelText.textContent = T(S.modelDl, { total: fmtMB(m.total), pct: pct });
        } else {
          el.modelText.textContent = S.modelDlUnknown;
        }
      } else if (m.type === 'ready') {
        el.modelWrap.style.display = 'none';
        if (el.engine) el.engine.textContent = T(S.ready, { backend: m.backend });
      } else if (m.type === 'progress') {
        el.progWrap.style.display = 'block';
        var p = Math.round((m.done / m.total) * 100);
        el.progBar.style.width = p + '%';
        el.progText.textContent = T(S.separating, { done: m.done, total: m.total, pct: p });
      } else if (m.type === 'stems') {
        onStems(m.stems);
      } else if (m.type === 'error') {
        busy = false;
        el.progWrap.style.display = 'none';
        el.modelWrap.style.display = 'none';
        setStatus(m.message);
        killWorker();
      }
    };
    worker.onerror = function (err) {
      busy = false;
      var detail = err.message || 'worker failed to load';
      if (err.filename) detail += ' [' + err.filename.split('/').pop() + (err.lineno ? ':' + err.lineno : '') + ']';
      setStatus(T(S.engineError, { msg: detail }));
      killWorker();
    };
    return worker;
  }
  function killWorker() {
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
  }

  /* ---------- file intake ---------- */
  function handleFile(file) {
    if (!file || busy) return;
    baseName = (file.name || 'track').replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim() || 'track';
    setStatus(T(S.decoding, { name: file.name }));
    var rd = new FileReader();
    rd.onload = function () {
      var tmp = new (window.AudioContext || window.webkitAudioContext)();
      tmp.decodeAudioData(rd.result.slice(0), function (decoded) {
        tmp.close();
        if (decoded.duration > MAX_SECONDS) {
          setStatus(T(S.tooLong, { dur: fmtTime(decoded.duration) }));
          return;
        }
        resample(decoded).then(function (lr) {
          if (window.SharedAudio) window.SharedAudio.saveFile(file);
          mixLen = lr[0].length;
          el.fileInfo.textContent = T(S.fileInfo, {
            name: file.name, dur: fmtTime(decoded.duration),
            ch: decoded.numberOfChannels > 1 ? S.stereo : S.mono
          });
          el.stage.style.display = 'block';
          startSeparation(lr[0], lr[1]);
        });
      }, function () {
        setStatus(S.decodeFail);
      });
    };
    rd.readAsArrayBuffer(file);
  }

  function resample(decoded) {
    if (decoded.sampleRate === SR && decoded.numberOfChannels === 2) {
      return Promise.resolve([decoded.getChannelData(0).slice(0), decoded.getChannelData(1).slice(0)]);
    }
    var len = Math.ceil(decoded.duration * SR);
    var off = new OfflineAudioContext(2, len, SR);
    var src = off.createBufferSource();
    src.buffer = decoded;
    if (decoded.numberOfChannels === 1) {
      var merger = off.createChannelMerger(2);
      src.connect(merger); merger.connect(off.destination);
    } else {
      src.connect(off.destination);
    }
    src.start();
    return off.startRendering().then(function (buf) {
      return [buf.getChannelData(0).slice(0), buf.getChannelData(1).slice(0)];
    });
  }

  function startSeparation(l, r) {
    busy = true;
    stems = null;
    el.mixer.style.display = 'none';
    el.cards.innerHTML = '';
    setStatus('');
    el.progWrap.style.display = 'block';
    el.progBar.style.width = '0%';
    el.progText.textContent = S.starting;
    var w = ensureWorker();
    var lt = new Float32Array(l), rt = new Float32Array(r);
    w.postMessage({ type: 'separate', left: lt, right: rt }, [lt.buffer, rt.buffer]);
  }

  /* ---------- results ---------- */
  function onStems(result) {
    busy = false;
    soloPlay = null;
    stems = result;
    el.progWrap.style.display = 'none';
    setStatus(S.done);
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    buffers = {};
    STEM_ORDER.forEach(function (s) {
      var buf = actx.createBuffer(2, stems[s][0].length, SR);
      buf.copyToChannel(stems[s][0], 0);
      buf.copyToChannel(stems[s][1], 1);
      buffers[s] = buf;
      gains[s] = actx.createGain();
      gains[s].connect(actx.destination);
    });
    buildCards();
    el.mixer.style.display = 'block';
    updateTransport();
  }

  var STEM_COLORS = { vocals: '#D6FF57', drums: '#57A6FF', bass: '#FF9F57', other: '#C792FF' };
  function buildCards() {
    el.cards.innerHTML = '';
    STEM_ORDER.forEach(function (s) {
      var meta = S.stems[s];
      var card = document.createElement('div');
      card.className = 'stem-card';
      card.innerHTML =
        '<div class="stem-head"><span class="stem-dot" style="background:' + STEM_COLORS[s] + '"></span>' +
        '<b>' + meta.label + '</b><span class="stem-hint">' + meta.hint + '</span></div>' +
        '<canvas class="stem-wave" width="640" height="56"></canvas>' +
        '<div class="stem-controls">' +
        '<button type="button" class="btn-ghost stem-play-one" data-stem="' + s + '" title="Play this stem alone">&#9654;</button>' +
        '<button type="button" class="btn-ghost stem-mute" data-stem="' + s + '">' + S.mute + '</button>' +
        '<button type="button" class="btn-ghost stem-solo" data-stem="' + s + '">' + S.solo + '</button>' +
        '<input type="range" class="stem-vol" data-stem="' + s + '" min="0" max="1.25" step="0.01" value="1" aria-label="' + meta.label + ' ' + S.volume + '">' +
        '<span class="stem-dl"><button type="button" class="btn-lime stem-wav" data-stem="' + s + '">WAV</button>' +
        '<button type="button" class="btn-ghost stem-mp3" data-stem="' + s + '">MP3</button>' +
        '<button type="button" class="btn-ghost stem-share" data-stem="' + s + '"' + (canShareFiles() ? '' : ' style="display:none"') + '>&#11014; ' + S.share + '</button></span>' +
        '</div>';
      el.cards.appendChild(card);
      drawWave(card.querySelector('.stem-wave'), stems[s], STEM_COLORS[s]);
    });
    el.cards.querySelectorAll('.stem-mute').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = b.getAttribute('data-stem');
        state[s].mute = !state[s].mute;
        b.classList.toggle('on', state[s].mute);
        applyGains();
      });
    });
    el.cards.querySelectorAll('.stem-solo').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = b.getAttribute('data-stem');
        state[s].solo = !state[s].solo;
        b.classList.toggle('on', state[s].solo);
        applyGains();
      });
    });
    el.cards.querySelectorAll('.stem-vol').forEach(function (inp) {
      inp.addEventListener('input', function () {
        state[inp.getAttribute('data-stem')].vol = parseFloat(inp.value);
        applyGains();
      });
    });
    el.cards.querySelectorAll('.stem-wav').forEach(function (b) {
      b.addEventListener('click', function () { downloadStem(b.getAttribute('data-stem'), 'wav'); });
    });
    el.cards.querySelectorAll('.stem-mp3').forEach(function (b) {
      b.addEventListener('click', function () { downloadStem(b.getAttribute('data-stem'), 'mp3'); });
    });
    el.cards.querySelectorAll('.stem-play-one').forEach(function (b) {
      b.addEventListener('click', function () {
        var st = b.getAttribute('data-stem');
        if (soloPlay === st) {
          if (playing) { pauseAt(currentPos()); return; }
          soloPlay = null; applyGains(); updateTransport(); return;
        }
        soloPlay = st; applyGains();
        if (!playing) playFrom(startOffset); else updateTransport();
      });
    });
    el.cards.querySelectorAll('.stem-share').forEach(function (b) {
      b.addEventListener('click', function () {
        var st = b.getAttribute('data-stem');
        if (!stems) return;
        shareFile(encodeWAV(stems[st][0], stems[st][1]), baseName + '-' + st + '.wav', baseName + ' — ' + S.stems[st].label);
      });
    });
  }

  function drawWave(canvas, lr, color) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height, mid = H / 2;
    var buckets = 240, step = Math.floor(lr[0].length / buckets);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color;
    var bw = W / buckets;
    for (var i = 0; i < buckets; i++) {
      var peak = 0;
      for (var j = 0; j < step; j += 97) {
        var v = Math.abs(lr[0][i * step + j]) + Math.abs(lr[1][i * step + j]);
        if (v > peak) peak = v;
      }
      var h = Math.max(1, (peak / 2) * mid);
      ctx.fillRect(i * bw, mid - h, Math.max(1, bw - 0.5), h * 2);
    }
  }

  /* ---------- transport ---------- */
  function anySolo() { return STEM_ORDER.some(function (s) { return state[s].solo; }); }
  function applyGains() {
    if (!actx) return;
    var solo = anySolo();
    STEM_ORDER.forEach(function (s) {
      if (!gains[s]) return;
      var audible = soloPlay ? (s === soloPlay) : (solo ? state[s].solo : !state[s].mute);
      gains[s].gain.value = audible ? state[s].vol : 0;
    });
  }
  function duration() { return mixLen / SR; }

  function playFrom(offset) {
    if (!buffers.vocals) return;
    stopSources();
    if (actx.state === 'suspended') actx.resume();
    STEM_ORDER.forEach(function (s) {
      var src = actx.createBufferSource();
      src.buffer = buffers[s];
      src.connect(gains[s]);
      src.start(0, offset);
      sources[s] = src;
    });
    startCtxTime = actx.currentTime;
    startOffset = offset;
    playing = true;
    sources.vocals.onended = function () { if (playing) pauseAt(duration()); };
    tick();
    updateTransport();
  }
  function stopSources() {
    STEM_ORDER.forEach(function (s) {
      if (sources[s]) { try { sources[s].onended = null; sources[s].stop(); } catch (e) {} sources[s] = null; }
    });
  }
  function currentPos() {
    if (!playing) return startOffset;
    var p = startOffset + (actx.currentTime - startCtxTime);
    return p >= duration() ? duration() : p;
  }
  function pauseAt(pos) {
    stopSources();
    playing = false;
    startOffset = pos >= duration() ? 0 : pos;
    cancelAnimationFrame(rafId);
    updateTransport();
    drawSeek();
  }
  function tick() {
    drawSeek();
    if (playing) rafId = requestAnimationFrame(tick);
  }
  function drawSeek() {
    var d = duration();
    var p = d > 0 ? currentPos() / d : 0;
    el.seekFill.style.width = (p * 100).toFixed(2) + '%';
    el.time.textContent = fmtTime(currentPos()) + ' / ' + fmtTime(d);
  }
  function updateTransport() {
    el.play.innerHTML = playing ? '&#10073;&#10073;' : '&#9654;';
    drawSeek();
    el.cards.querySelectorAll('.stem-play-one').forEach(function (b) {
      var active = soloPlay === b.getAttribute('data-stem');
      b.innerHTML = (active && playing) ? '&#10073;&#10073;' : '&#9654;';
      b.classList.toggle('on', active);
    });
  }

  el.play.addEventListener('click', function () {
    if (!buffers.vocals) return;
    if (playing) pauseAt(currentPos());
    else playFrom(startOffset);
  });
  el.seek.addEventListener('click', function (e) {
    if (!buffers.vocals) return;
    var rect = el.seek.getBoundingClientRect();
    var p = (e.clientX - rect.left) / rect.width;
    var pos = Math.max(0, Math.min(duration() - 0.05, p * duration()));
    if (playing) playFrom(pos); else { startOffset = pos; drawSeek(); }
  });

  /* ---------- sharing ---------- */
  function canShareFiles() {
    try {
      if (!navigator.canShare) return false;
      var probe = new File([new Blob(['x'], { type: 'audio/wav' })], 'x.wav', { type: 'audio/wav' });
      return navigator.canShare({ files: [probe] });
    } catch (e) { return false; }
  }
  function shareFile(blob, name, title) {
    var f = new File([blob], name, { type: blob.type });
    if (navigator.share && canShareFiles()) {
      navigator.share({ files: [f], title: title }).catch(function (e) {
        if (e && e.name !== 'AbortError') saveBlob(blob, name);
      });
    } else saveBlob(blob, name);
  }
  if (el.shareInst) {
    if (canShareFiles()) el.shareInst.style.display = '';
    el.shareInst.addEventListener('click', function () {
      if (!stems) return;
      var m = mixStems(['drums', 'bass', 'other']);
      shareFile(encodeWAV(m[0], m[1]), baseName + '-instrumental.wav', baseName + ' — Instrumental');
    });
  }
  if (el.shareTool) {
    el.shareTool.addEventListener('click', function () {
      var url = location.href.split('#')[0];
      if (navigator.share) {
        navigator.share({ title: document.title, text: S.shareText, url: url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          var old = el.shareTool.innerHTML;
          el.shareTool.innerHTML = S.copied;
          setTimeout(function () { el.shareTool.innerHTML = old; }, 1600);
        });
      }
    });
  }

  /* ---------- downloads ---------- */
  function encodeWAV(l, r) {
    var len = l.length;
    var buf = new ArrayBuffer(44 + len * 4);
    var v = new DataView(buf);
    function ws(off, str) { for (var i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
    ws(0, 'RIFF'); v.setUint32(4, 36 + len * 4, true); ws(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true);
    v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, len * 4, true);
    for (var i = 0; i < len; i++) {
      v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i])) * 32767, true);
      v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i])) * 32767, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function encodeMP3(l, r) {
    if (!window.lamejs || !window.lamejs.Mp3Encoder) return null;
    var enc = new window.lamejs.Mp3Encoder(2, SR, 192);
    var parts = [];
    var block = 1152;
    var li = new Int16Array(block), ri = new Int16Array(block);
    for (var i = 0; i < l.length; i += block) {
      var n = Math.min(block, l.length - i);
      for (var j = 0; j < n; j++) {
        li[j] = Math.max(-1, Math.min(1, l[i + j])) * 32767;
        ri[j] = Math.max(-1, Math.min(1, r[i + j])) * 32767;
      }
      var d = enc.encodeBuffer(li.subarray(0, n), ri.subarray(0, n));
      if (d.length) parts.push(new Uint8Array(d));
    }
    var end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    return new Blob(parts, { type: 'audio/mpeg' });
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  function downloadStem(s, fmt) {
    if (!stems) return;
    if (fmt === 'mp3' && !(window.lamejs && window.lamejs.Mp3Encoder)) {
      setStatus(S.mp3Loading);
      var sc = document.createElement('script');
      sc.src = BASE + 'lame.min.js';
      sc.onload = function () { setStatus(''); downloadStem(s, fmt); };
      sc.onerror = function () { setStatus(S.mp3Fail); };
      document.head.appendChild(sc);
      return;
    }
    var blob = fmt === 'wav' ? encodeWAV(stems[s][0], stems[s][1]) : encodeMP3(stems[s][0], stems[s][1]);
    if (!blob) { setStatus(S.mp3Unavailable); return; }
    saveBlob(blob, baseName + '-' + s + '.' + fmt);
  }
  function mixStems(list) {
    var l = new Float32Array(mixLen), r = new Float32Array(mixLen);
    list.forEach(function (s) {
      for (var i = 0; i < mixLen; i++) { l[i] += stems[s][0][i]; r[i] += stems[s][1][i]; }
    });
    return [l, r];
  }
  el.dlInst.addEventListener('click', function () {
    if (!stems) return;
    var m = mixStems(['drums', 'bass', 'other']);
    saveBlob(encodeWAV(m[0], m[1]), baseName + '-instrumental.wav');
  });
  el.dlAll.addEventListener('click', function () {
    if (!stems) return;
    STEM_ORDER.forEach(function (s, i) {
      setTimeout(function () { downloadStem(s, 'wav'); }, i * 350);
    });
  });
  el.reset.addEventListener('click', function () {
    pauseAt(0);
    soloPlay = null;
    stems = null; buffers = {};
    el.stage.style.display = 'none';
    el.mixer.style.display = 'none';
    el.cards.innerHTML = '';
    el.file.value = '';
    setStatus('');
  });

  /* ---------- intake wiring ---------- */
  el.drop.addEventListener('click', function () { el.file.click(); });
  el.file.addEventListener('change', function () { if (el.file.files[0]) handleFile(el.file.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    el.drop.addEventListener(ev, function (e) { e.preventDefault(); el.drop.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    el.drop.addEventListener(ev, function (e) { e.preventDefault(); el.drop.classList.remove('drag'); });
  });
  el.drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  document.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.files;
    if (items && items[0]) handleFile(items[0]);
  });

  /* Shared audio pool: pick up the file loaded in the Analyzer / Edit /
   * Bleep pages (assets/js/shared-audio.js), unless this is a fresh visit. */
  if (window.SharedAudio) {
    window.SharedAudio.wipeIfFresh(['current']).then(function (restore) {
      if (!restore) return;
      window.SharedAudio.loadFile().then(function (f) { if (f && f.size && !busy) handleFile(f); });
    });
  }

  /* Phone honesty: the model + a song need real RAM. Warn, never block. */
  if (el.warn) {
    var lowMem = navigator.deviceMemory && navigator.deviceMemory < 4;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (lowMem || (coarse && window.innerWidth < 820)) {
      el.warn.style.display = 'block';
    }
  }
})();
