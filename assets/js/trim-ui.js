/* trim-ui.js — Audio trimmer / splitter / joiner for jsm-loudness.com.
   Depends on: window.BleepAudio (assets/js/bleep-audio.js) and
   window.TRIM_STRINGS (defined per-page: EN on trim-audio.html, FR on fr/trim-audio.html).
   All user-visible text comes from TRIM_STRINGS.

   Tabs:
   - Trim: single drag-select region, Keep / Delete, typed start/end times, WAV download.
   - Split: cut points (button at playhead or click on waveform), draggable markers,
     per-segment download + download-all.
   - Join: multiple files, reorder, merge to one WAV (all decoded at 44100 Hz).
   Everything runs client-side; downloads are 16-bit WAV. */
(function () {
'use strict';

var S = window.TRIM_STRINGS || {};
function t(k) { return S[k] || k; }
var BA = window.BleepAudio;
var AC = window.AudioContext || window.webkitAudioContext;

function fmt(s) { return BA.formatTime(s); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function $(id) { return document.getElementById(id); }

/* ---------- shared audio helpers ---------- */

function isAudioFile(f) {
  return !!f && (/^audio\//.test(f.type) || /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm)$/i.test(f.name));
}

// Decode via OfflineAudioContext (resamples to 44100 Hz) — same as the bleep tool.
function decodeFile(file) {
  var off = new OfflineAudioContext(1, 1, 44100);
  return file.arrayBuffer().then(function (buf) { return off.decodeAudioData(buf); });
}

function bufferChannels(buf) {
  var chs = [];
  for (var c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  return chs;
}

function baseName(name) { return ((name || 'audio').replace(/\.[^.]+$/, '') || 'audio'); }

function downloadWav(channels, sampleRate, filename) {
  var wav = BA.encodeWav(channels, sampleRate);
  var blob = new Blob([wav], { type: 'audio/wav' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
}

// Slice channel arrays to [start, end) seconds. Returns null when empty.
function sliceChannels(channels, sampleRate, start, end) {
  var len = channels[0].length;
  var s0 = clamp(Math.floor(start * sampleRate), 0, len);
  var s1 = clamp(Math.ceil(end * sampleRate), 0, len);
  if (s1 <= s0) return null;
  return channels.map(function (ch) { return ch.slice(s0, s1); });
}

// Build an AudioBuffer from channel arrays (for preview playback).
// The throwaway context is closed immediately; the buffer data survives.
function channelsToBuffer(channels, sampleRate) {
  var ctx = new AC();
  var buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach(function (ch, i) { buf.getChannelData(i).set(ch); });
  try { ctx.close(); } catch (e) {}
  return buf;
}

function parseTime(str) {
  str = String(str == null ? '' : str).trim().replace(',', '.');
  if (!str) return NaN;
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  var m = str.match(/^(?:(\d+):)?([0-5]?\d(?:\.\d+)?)$/);
  if (!m) return NaN;
  return parseInt(m[1] || '0', 10) * 60 + parseFloat(m[2]);
}

/* ---------- tabs ---------- */

var tabBtns = Array.prototype.slice.call(document.querySelectorAll('[data-ttab]'));
function showTab(name) {
  tabBtns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-ttab') === name); });
  ['trim', 'split', 'join'].forEach(function (k) {
    var p = $('trimPanel-' + k);
    if (p) p.hidden = (k !== name);
  });
  if (window.TrimUI && window.TrimUI.refresh) window.TrimUI.refresh();
}
tabBtns.forEach(function (b) {
  b.addEventListener('click', function () { showTab(b.getAttribute('data-ttab')); });
});

/* ---------- waveform view (zoomable canvas + playhead) ---------- */

function Waveform(wrapId, canvasId, phId) {
  var wrap = $(wrapId), canvas = $(canvasId), ph = $(phId);
  var W = {
    peaks: null, duration: 0, viewStart: 0, viewEnd: 0, playheadTime: 0,
    setAudio: function (peaks, duration) {
      this.peaks = peaks; this.duration = duration;
      this.viewStart = 0; this.viewEnd = duration; this.playheadTime = 0;
      this.draw(); this.positionPlayhead();
    },
    viewLen: function () { return Math.max(0.001, this.viewEnd - this.viewStart); },
    draw: function () {
      if (!canvas || !wrap || !this.peaks || !this.duration) return;
      var dpr = window.devicePixelRatio || 1;
      var w = wrap.clientWidth, h = 160;
      if (!w) return;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      var g = canvas.getContext('2d');
      g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
      var n = this.peaks.length;
      var i0 = clamp(Math.floor(this.viewStart / this.duration * n), 0, n - 1);
      var i1 = clamp(Math.ceil(this.viewEnd / this.duration * n), i0 + 1, n);
      g.fillStyle = '#D6FF57';
      for (var x = 0; x < w; x++) {
        var bi = i0 + Math.floor(x / w * (i1 - i0));
        var pk = this.peaks[clamp(bi, 0, n - 1)] || 0;
        if (pk > 1) pk = 1;
        var phh = Math.max(1, pk * (h / 2 - 6));
        g.fillRect(x, h / 2 - phh, 1, phh * 2);
      }
      g.fillStyle = 'rgba(230,232,236,0.25)';
      g.fillRect(0, h / 2, w, 1);
    },
    setView: function (a, b) {
      var D = this.duration; if (!D) return;
      a = clamp(a, 0, D); b = clamp(b, 0, D);
      if (b - a < 0.5) { var mid = (a + b) / 2; a = mid - 0.25; b = mid + 0.25; }
      a = clamp(a, 0, D); b = clamp(b, 0, D);
      if (b - a < 0.25) return;
      this.viewStart = a; this.viewEnd = b;
      this.draw(); this.positionPlayhead();
      if (this.onView) this.onView();
    },
    zoomBy: function (factor, centerT) {
      var D = this.duration; if (!D) return;
      var c = (centerT == null) ? (this.viewStart + this.viewEnd) / 2 : clamp(centerT, 0, D);
      var nl = clamp(this.viewLen() * factor, 0.5, D);
      var frac = (c - this.viewStart) / this.viewLen();
      var ns = clamp(c - nl * frac, 0, D - nl);
      this.setView(ns, ns + nl);
    },
    xToTime: function (clientX) {
      var r = wrap.getBoundingClientRect();
      var frac = clamp((clientX - r.left) / r.width, 0, 1);
      return this.viewStart + frac * this.viewLen();
    },
    setPlayhead: function (time) { this.playheadTime = time; this.positionPlayhead(); },
    positionPlayhead: function () {
      if (!ph) return;
      if (!this.duration) { ph.style.display = 'none'; return; }
      var p = clamp(this.playheadTime, 0, this.duration);
      if (p < this.viewStart || p > this.viewEnd) {
        ph.style.left = (p < this.viewStart ? 0 : 100) + '%';
        ph.style.opacity = '0.35';
      } else {
        ph.style.left = ((p - this.viewStart) / this.viewLen() * 100) + '%';
        ph.style.opacity = '1';
      }
      ph.style.display = 'block';
    },
    refresh: function () { this.draw(); this.positionPlayhead(); },
    onView: null,
    wrapEl: wrap
  };
  // wheel zoom + double-click reset (same as the bleep tool)
  wrap.addEventListener('wheel', function (e) {
    if (!W.duration) return;
    e.preventDefault();
    W.zoomBy(e.deltaY > 0 ? 1.3 : 1 / 1.3, W.xToTime(e.clientX));
  }, { passive: false });
  wrap.addEventListener('dblclick', function (e) {
    if (e.target.closest('.trim-region') || e.target.closest('.trim-cut')) return;
    W.setView(0, W.duration);
  });
  return W;
}

/* ---------- transport (play / pause / stop / seek with rAF playhead) ---------- */

function Transport(wave, updateUI) {
  var T = {
    ctx: null, src: null, t0: 0, offset: 0, paused: false, buf: null,
    playing: function () { return !!(this.ctx && !this.paused); },
    play: function (buf, offset) {
      this.stop(true);
      offset = clamp(offset, 0, Math.max(0, buf.duration - 0.02));
      var ctx = new AC();
      var src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination);
      var t0 = ctx.currentTime + 0.05;
      try { src.start(t0, offset); }
      catch (e) { try { ctx.close(); } catch (e2) {} updateUI(); return; }
      this.ctx = ctx; this.src = src; this.t0 = t0; this.offset = offset;
      this.paused = false; this.buf = buf;
      wave.setPlayhead(offset);
      var self = this;
      src.onended = function () {
        if (self.src === src) { wave.setPlayhead(buf.duration); self.stop(true); updateUI(); }
      };
      updateUI(); this.tick();
    },
    pause: function () {
      if (!this.ctx || this.paused) return;
      this.offset = this.now();
      this.paused = true;
      try { this.ctx.suspend(); } catch (e) {}
      wave.setPlayhead(this.offset);
      updateUI();
    },
    resume: function () {
      if (!this.ctx || !this.paused) return;
      this.paused = false;
      try { this.ctx.resume(); } catch (e) {}
      updateUI(); this.tick();
    },
    toggle: function (buf, offset) {
      if (this.playing()) this.pause();
      else if (this.ctx && this.paused) this.resume();
      else {
        var off = (offset == null) ? wave.playheadTime : offset;
        if (buf && off >= buf.duration - 0.25) off = 0;
        this.play(buf, off);
      }
    },
    stop: function (silent) {
      if (this.src) {
        try { this.src.onended = null; this.src.stop(); } catch (e) {}
      }
      if (this.ctx) { try { this.ctx.close(); } catch (e) {} }
      this.ctx = null; this.src = null; this.paused = false; this.buf = null;
      if (!silent) { wave.setPlayhead(0); updateUI(); }
    },
    now: function () {
      if (!this.ctx) return this.offset;
      return this.offset + (this.ctx.currentTime - this.t0);
    },
    seek: function (dSec, dur) {
      if (!dur) return;
      var nt = clamp(wave.playheadTime + dSec, 0, dur);
      if (this.playing() && this.buf) {
        var buf = this.buf;
        this.play(buf, nt);
      } else {
        this.stop(true);
        wave.setPlayhead(nt);
      }
      updateUI();
    },
    tick: function () {
      if (!this.ctx || this.paused) return;
      var tm = this.now();
      var D = this.buf ? this.buf.duration : 0;
      if (D && tm >= D) { wave.setPlayhead(D); this.stop(true); updateUI(); return; }
      // follow the playhead when it leaves the zoomed view
      if (tm > wave.viewEnd || tm < wave.viewStart) {
        var L = wave.viewLen();
        var ns = clamp(tm - L * 0.3, 0, Math.max(0, wave.duration - L));
        wave.setView(ns, ns + L);
      } else {
        wave.positionPlayhead();
      }
      wave.playheadTime = tm;
      var self = this;
      requestAnimationFrame(function () { self.tick(); });
    }
  };
  return T;
}

/* ================= TRIM TAB ================= */

var trim = (function () {
  var wave = Waveform('trimWaveWrap', 'trimWave', 'trimPlayhead');
  var decoded = null, fileName = '', peaks = null;
  var region = null; // {start, end} single selection
  var transport = Transport(wave, updateUI);

  var el = {};
  ['trimDrop', 'trimFile', 'trimStage', 'trimFileInfo', 'trimHint',
   'trimStart', 'trimEnd', 'trimSetTime', 'trimKeep', 'trimDelete', 'trimPreview',
   'trimPlay', 'trimStop', 'trimBack', 'trimFwd',
   'trimZoomIn', 'trimZoomOut', 'trimViewRange',
   'trimDownload', 'trimReplace', 'trimRegionLayer'
  ].forEach(function (id) { el[id] = $(id); });

  function dur() { return decoded ? decoded.duration : 0; }

  function setHint(m) { el.trimHint.textContent = m || ''; }

  function loadFile(f) {
    if (!isAudioFile(f)) { alert(t('notAudio')); return; }
    transport.stop(true);
    setHint(t('decoding'));
    fileName = f.name;
    decodeFile(f).then(function (ab) {
      decoded = ab;
      region = null; pendingOp = null;
      var chs = bufferChannels(ab);
      peaks = BA.computePeaks(BA.mixToMono(chs), 1500);
      el.trimDrop.style.display = 'none';
      el.trimStage.style.display = 'block';
      wave.setAudio(peaks, ab.duration);
      el.trimFileInfo.textContent = fileName + ' — ' + fmt(ab.duration) + ' · ' +
        ab.numberOfChannels + (ab.numberOfChannels > 1 ? t('chStereo') : t('chMono')) + ' · ' + ab.sampleRate + ' Hz';
      renderRegion(); updateUI(); updateViewRange();
      setHint(t('trimHintDraw'));
      el.trimStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }).catch(function () { alert(t('decodeFail')); setHint(''); });
  }

  function updateViewRange() {
    el.trimViewRange.textContent = fmt(wave.viewStart) + ' – ' + fmt(wave.viewEnd);
  }
  wave.onView = function () { renderRegion(); updateViewRange(); };

  /* ----- region ----- */

  function renderRegion() {
    var layer = el.trimRegionLayer;
    layer.innerHTML = '';
    if (!region || !dur()) return;
    var a = Math.max(region.start, wave.viewStart), b = Math.min(region.end, wave.viewEnd);
    if (b - a <= 0) return;
    var d = document.createElement('div');
    d.className = 'trim-region sel';
    d.style.left = ((a - wave.viewStart) / wave.viewLen() * 100) + '%';
    d.style.width = Math.max(0.4, (b - a) / wave.viewLen() * 100) + '%';
    d.innerHTML = '<div class="bhandle hl"></div><div class="bhandle hr"></div>' +
      '<span class="blabel">' + fmt(region.start) + '–' + fmt(region.end) + '</span>';
    d.addEventListener('pointerdown', onRegionDown);
    layer.appendChild(d);
    el.trimStart.value = fmt(region.start);
    el.trimEnd.value = fmt(region.end);
  }

  function setRegion(a, b) {
    var D = dur(); if (!D) return;
    a = clamp(a, 0, D); b = clamp(b, 0, D);
    if (b - a < 0.05) return;
    region = { start: a, end: b };
    pendingOp = null;
    transport.stop(true);
    renderRegion(); updateUI();
    setHint(t('trimHintEdit'));
  }

  var drag = null;

  wave.wrapEl.addEventListener('pointerdown', function (e) {
    if (!decoded || e.target.closest('.trim-region')) return;
    e.preventDefault();
    var startT = wave.xToTime(e.clientX);
    drag = { kind: 'new', startT: startT };
    var d = document.createElement('div');
    d.className = 'trim-region drawing';
    d.style.left = ((startT - wave.viewStart) / wave.viewLen() * 100) + '%';
    d.style.width = '0.4%';
    el.trimRegionLayer.appendChild(d);
    drag.el = d;
    try { wave.wrapEl.setPointerCapture(e.pointerId); } catch (err) {}
  });

  function onRegionDown(e) {
    if (!decoded) return;
    e.preventDefault(); e.stopPropagation();
    var kind = 'move';
    if (e.target.classList.contains('hl')) kind = 'resize-l';
    else if (e.target.classList.contains('hr')) kind = 'resize-r';
    drag = { kind: kind, startX: e.clientX, origStart: region.start, origEnd: region.end };
    try { wave.wrapEl.setPointerCapture(e.pointerId); } catch (err) {}
  }

  wave.wrapEl.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (drag.kind === 'new') {
      var dt = wave.xToTime(e.clientX);
      var a = Math.min(drag.startT, dt), b = Math.max(drag.startT, dt);
      drag.el.style.left = ((a - wave.viewStart) / wave.viewLen() * 100) + '%';
      drag.el.style.width = Math.max(0.4, (b - a) / wave.viewLen() * 100) + '%';
      drag.curA = a; drag.curB = b;
    } else if (region) {
      var rect = wave.wrapEl.getBoundingClientRect();
      var dx = (e.clientX - drag.startX) / rect.width * wave.viewLen();
      var len = drag.origEnd - drag.origStart, D = dur();
      if (drag.kind === 'move') {
        var ns = clamp(drag.origStart + dx, 0, D - len);
        region.start = ns; region.end = ns + len;
      } else if (drag.kind === 'resize-l') {
        region.start = clamp(drag.origStart + dx, 0, drag.origEnd - 0.05);
      } else {
        region.end = clamp(drag.origEnd + dx, drag.origStart + 0.05, D);
      }
      renderRegion();
    }
  });

  function endDrag() {
    if (!drag) return;
    if (drag.kind === 'new') {
      if (drag.curB - drag.curA >= 0.05) setRegion(drag.curA, drag.curB);
      else if (drag.el) drag.el.remove();
      renderRegion();
    } else {
      renderRegion(); updateUI();
    }
    drag = null;
  }
  wave.wrapEl.addEventListener('pointerup', endDrag);
  wave.wrapEl.addEventListener('pointercancel', endDrag);

  /* ----- typed times ----- */

  el.trimSetTime.addEventListener('click', function () {
    if (!decoded) return;
    var a = parseTime(el.trimStart.value), b = parseTime(el.trimEnd.value);
    if (!isFinite(a) || !isFinite(b)) { alert(t('badTime')); return; }
    if (a > b) { var tmp = a; a = b; b = tmp; }
    setRegion(a, b);
  });

  /* ----- actions: keep/delete set a pending op; preview plays it; download saves it ----- */

  var pendingOp = null; // 'keep' | 'delete' | null

  function currentChannels() { return decoded ? bufferChannels(decoded) : null; }

  // Build the result channels for keep/delete; returns {channels, sr} or null.
  function buildResult(mode) {
    if (!decoded || !region) return null;
    var chs = currentChannels(), sr = decoded.sampleRate, D = dur();
    var out;
    if (mode === 'keep') {
      out = sliceChannels(chs, sr, region.start, region.end);
    } else {
      var left = sliceChannels(chs, sr, 0, region.start);
      var right = sliceChannels(chs, sr, region.end, D);
      if (!left) out = right;
      else if (!right) out = left;
      else out = left.map(function (ch, i) {
        var m = new Float32Array(ch.length + right[i].length);
        m.set(ch, 0); m.set(right[i], ch.length);
        return m;
      });
    }
    return out ? { channels: out, sr: sr } : null;
  }

  function setPendingOp(mode) {
    if (!region) { alert(t('trimNoSel')); return; }
    pendingOp = mode;
    transport.stop(true);
    updateUI();
  }

  function doPreview() {
    if (transport.playing()) { transport.stop(); updateUI(); return; }
    if (!decoded) return;
    if (pendingOp) {
      var res = buildResult(pendingOp);
      if (!res) { alert(t('renderFail')); return; }
      transport.play(channelsToBuffer(res.channels, res.sr), 0);
    } else if (region) {
      var chs = currentChannels(), sr = decoded.sampleRate;
      var sel = sliceChannels(chs, sr, region.start, region.end);
      if (!sel) { alert(t('renderFail')); return; }
      transport.play(channelsToBuffer(sel, sr), 0);
    } else {
      alert(t('trimNoSel'));
      return;
    }
    updateUI();
  }

  function doDownload() {
    if (!pendingOp) { alert(t('trimPickOp')); return; }
    var res = buildResult(pendingOp);
    if (!res) { alert(t('renderFail')); return; }
    downloadWav(res.channels, res.sr,
      baseName(fileName) + (pendingOp === 'keep' ? '-trimmed.wav' : '-cut.wav'));
  }

  el.trimKeep.addEventListener('click', function () { setPendingOp('keep'); });
  el.trimDelete.addEventListener('click', function () { setPendingOp('delete'); });
  el.trimPreview.addEventListener('click', doPreview);
  el.trimDownload.addEventListener('click', doDownload);

  /* ----- transport ----- */

  function updateUI() {
    var has = !!decoded, hasRegion = !!region;
    var playing = transport.playing();
    el.trimPlay.textContent = playing ? '⏸' : '▶';
    el.trimPlay.setAttribute('aria-label', playing ? t('pause') : t('play'));
    el.trimPlay.disabled = !has;
    el.trimStop.disabled = !transport.ctx;
    el.trimBack.disabled = !has; el.trimFwd.disabled = !has;
    el.trimKeep.disabled = !hasRegion; el.trimDelete.disabled = !hasRegion;
    el.trimKeep.classList.toggle('on', pendingOp === 'keep');
    el.trimDelete.classList.toggle('on', pendingOp === 'delete');
    el.trimPreview.disabled = !(pendingOp || hasRegion);
    el.trimDownload.disabled = !pendingOp;
  }

  el.trimPlay.addEventListener('click', function () {
    if (!decoded) return;
    if (transport.playing()) { transport.pause(); updateUI(); return; }
    if (transport.ctx && transport.paused) { transport.resume(); updateUI(); return; }
    transport.play(decoded, wave.playheadTime);
    updateUI();
  });
  el.trimStop.addEventListener('click', function () { transport.stop(); updateUI(); });
  el.trimBack.addEventListener('click', function () { transport.seek(-5, dur()); updateUI(); });
  el.trimFwd.addEventListener('click', function () { transport.seek(5, dur()); updateUI(); });
  el.trimZoomIn.addEventListener('click', function () { wave.zoomBy(0.5); renderRegion(); updateViewRange(); });
  el.trimZoomOut.addEventListener('click', function () { wave.zoomBy(2); renderRegion(); updateViewRange(); });
  el.trimReplace.addEventListener('click', function () { el.trimFile.click(); });

  /* ----- inputs ----- */

  el.trimDrop.addEventListener('click', function () { el.trimFile.click(); });
  el.trimFile.addEventListener('change', function () {
    if (el.trimFile.files[0]) loadFile(el.trimFile.files[0]);
    el.trimFile.value = '';
  });
  ['dragover', 'dragenter'].forEach(function (ev) {
    el.trimDrop.addEventListener(ev, function (e) { e.preventDefault(); });
  });
  el.trimDrop.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  document.addEventListener('paste', function (e) {
    if ($('trimPanel-trim').hidden) return;
    var f = (e.clipboardData && e.clipboardData.files || [])[0];
    if (f && isAudioFile(f)) loadFile(f);
  });

  window.addEventListener('resize', function () {
    if (decoded && !$('trimPanel-trim').hidden) { wave.refresh(); renderRegion(); }
  });

  return {
    refresh: function () { if (decoded) { wave.refresh(); renderRegion(); updateViewRange(); } },
    hasAudio: function () { return !!decoded; }
  };
})();

/* ================= SPLIT TAB ================= */

var split = (function () {
  var wave = Waveform('splitWaveWrap', 'splitWave', 'splitPlayhead');
  var decoded = null, fileName = '', peaks = null;
  var cuts = []; // sorted array of seconds
  var transport = Transport(wave, updateUI);

  var el = {};
  ['splitDrop', 'splitFile', 'splitStage', 'splitFileInfo', 'splitHint',
   'splitAddCut', 'splitSegList',
   'splitPlay', 'splitStop', 'splitBack', 'splitFwd',
   'splitZoomIn', 'splitZoomOut', 'splitViewRange',
   'splitDownloadAll', 'splitReplace', 'splitCutLayer'
  ].forEach(function (id) { el[id] = $(id); });

  function dur() { return decoded ? decoded.duration : 0; }
  function setHint(m) { el.splitHint.textContent = m || ''; }

  function loadFile(f) {
    if (!isAudioFile(f)) { alert(t('notAudio')); return; }
    transport.stop(true);
    setHint(t('decoding'));
    fileName = f.name;
    decodeFile(f).then(function (ab) {
      decoded = ab;
      cuts = [];
      var chs = bufferChannels(ab);
      peaks = BA.computePeaks(BA.mixToMono(chs), 1500);
      el.splitDrop.style.display = 'none';
      el.splitStage.style.display = 'block';
      wave.setAudio(peaks, ab.duration);
      el.splitFileInfo.textContent = fileName + ' — ' + fmt(ab.duration) + ' · ' +
        ab.numberOfChannels + (ab.numberOfChannels > 1 ? t('chStereo') : t('chMono')) + ' · ' + ab.sampleRate + ' Hz';
      renderCuts(); renderSegs(); updateUI(); updateViewRange();
      setHint(t('splitHint'));
      el.splitStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }).catch(function () { alert(t('decodeFail')); setHint(''); });
  }

  function updateViewRange() {
    el.splitViewRange.textContent = fmt(wave.viewStart) + ' – ' + fmt(wave.viewEnd);
  }
  wave.onView = function () { renderCuts(); updateViewRange(); };

  /* ----- cuts ----- */

  function addCut(time) {
    var D = dur(); if (!D) return;
    time = clamp(time, 0.05, D - 0.05);
    // avoid duplicates within 0.1s
    for (var i = 0; i < cuts.length; i++) {
      if (Math.abs(cuts[i] - time) < 0.1) return;
    }
    cuts.push(time);
    cuts.sort(function (a, b) { return a - b; });
    transport.stop(true);
    renderCuts(); renderSegs(); updateUI();
  }

  function removeCut(time) {
    cuts = cuts.filter(function (c) { return c !== time; });
    transport.stop(true);
    renderCuts(); renderSegs(); updateUI();
  }

  function renderCuts() {
    var layer = el.splitCutLayer;
    layer.innerHTML = '';
    if (!dur()) return;
    cuts.forEach(function (c) {
      if (c < wave.viewStart || c > wave.viewEnd) return;
      var d = document.createElement('div');
      d.className = 'trim-cut';
      d.style.left = ((c - wave.viewStart) / wave.viewLen() * 100) + '%';
      d.innerHTML = '<button type="button" class="tx" aria-label="' + t('removeCut') + '">×</button>';
      d.querySelector('.tx').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      d.querySelector('.tx').addEventListener('click', function (e) { e.stopPropagation(); removeCut(c); });
      d.addEventListener('pointerdown', function (e) { onCutDown(e, c); });
      layer.appendChild(d);
    });
  }

  var cutDrag = null;
  function onCutDown(e, c) {
    if (!decoded) return;
    e.preventDefault(); e.stopPropagation();
    cutDrag = { c: c, startX: e.clientX };
    try { wave.wrapEl.setPointerCapture(e.pointerId); } catch (err) {}
  }

  // click on empty waveform = seek playhead there (and play if playing)
  var downPos = null;
  wave.wrapEl.addEventListener('pointerdown', function (e) {
    if (!decoded || e.target.closest('.trim-cut')) return;
    downPos = { x: e.clientX, y: e.clientY, t: wave.xToTime(e.clientX) };
  });
  wave.wrapEl.addEventListener('pointerup', function (e) {
    if (cutDrag) {
      cutDrag = null;
      return;
    }
    if (downPos && decoded) {
      var moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (moved < 6) {
        // treat as a click: move playhead (don't add a cut — that's the button's job)
        var nt = wave.xToTime(e.clientX);
        if (transport.playing() && transport.buf) transport.play(transport.buf, nt);
        else { transport.stop(true); wave.setPlayhead(nt); }
        updateUI();
      }
    }
    downPos = null;
  });
  wave.wrapEl.addEventListener('pointermove', function (e) {
    if (!cutDrag) return;
    var rect = wave.wrapEl.getBoundingClientRect();
    var dx = (e.clientX - cutDrag.startX) / rect.width * wave.viewLen();
    var D = dur();
    var nt = clamp(cutDrag.c + dx, 0.05, D - 0.05);
    // keep ordering: don't cross neighbors
    var idx = cuts.indexOf(cutDrag.c);
    var prev = idx > 0 ? cuts[idx - 1] : 0.05;
    var next = idx < cuts.length - 1 ? cuts[idx + 1] : D - 0.05;
    nt = clamp(nt, prev + 0.05, next - 0.05);
    cuts[idx] = nt;
    cutDrag.c = nt;
    renderCuts(); renderSegs();
  });

  /* ----- segments ----- */

  function segments() {
    var D = dur(), segs = [], prev = 0;
    cuts.forEach(function (c) { segs.push([prev, c]); prev = c; });
    segs.push([prev, D]);
    return segs.filter(function (s) { return s[1] - s[0] >= 0.05; });
  }

  function renderSegs() {
    var box = el.splitSegList;
    box.innerHTML = '';
    if (!decoded) return;
    var segs = segments();
    if (!cuts.length) {
      box.innerHTML = '<div class="bleep-empty">' + t('splitNoCuts') + '</div>';
      return;
    }
    segs.forEach(function (s, i) {
      var row = document.createElement('div');
      row.className = 'bleep-row';
      row.innerHTML =
        '<button type="button" class="bnum">#' + (i + 1) + '</button>' +
        '<span class="btime">' + fmt(s[0]) + ' – ' + fmt(s[1]) + ' <span style="opacity:.6">(' + fmt(s[1] - s[0]) + ')</span></span>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="btn-ghost split-play-seg">▶</button>' +
        '<button type="button" class="btn-lime split-dl-seg">⬇ ' + t('segDownload') + '</button>';
      row.querySelector('.split-play-seg').addEventListener('click', function () {
        previewSeg(s[0], s[1]);
      });
      row.querySelector('.split-dl-seg').addEventListener('click', function () {
        downloadSeg(s[0], s[1], i);
      });
      box.appendChild(row);
    });
  }

  function segChannels(a, b) {
    if (!decoded) return null;
    return sliceChannels(bufferChannels(decoded), decoded.sampleRate, a, b);
  }

  function previewSeg(a, b) {
    var chs = segChannels(a, b);
    if (!chs) return;
    transport.play(channelsToBuffer(chs, decoded.sampleRate), 0);
    updateUI();
  }

  function downloadSeg(a, b, i) {
    var chs = segChannels(a, b);
    if (!chs) { alert(t('renderFail')); return; }
    downloadWav(chs, decoded.sampleRate,
      baseName(fileName) + '-part' + (i + 1) + '.wav');
  }

  el.splitAddCut.addEventListener('click', function () {
    if (!decoded) return;
    addCut(wave.playheadTime);
  });

  el.splitDownloadAll.addEventListener('click', function () {
    if (!decoded || !cuts.length) return;
    var segs = segments(), i = 0;
    el.splitDownloadAll.disabled = true;
    (function next() {
      if (i >= segs.length) { el.splitDownloadAll.disabled = false; updateUI(); return; }
      downloadSeg(segs[i][0], segs[i][1], i);
      i++;
      setTimeout(next, 700); // stagger so the browser doesn't block multiples
    })();
  });

  /* ----- transport ----- */

  function updateUI() {
    var has = !!decoded;
    var playing = transport.playing();
    el.splitPlay.textContent = playing ? '⏸' : '▶';
    el.splitPlay.setAttribute('aria-label', playing ? t('pause') : t('play'));
    el.splitPlay.disabled = !has;
    el.splitStop.disabled = !transport.ctx;
    el.splitBack.disabled = !has; el.splitFwd.disabled = !has;
    el.splitAddCut.disabled = !has;
    el.splitDownloadAll.disabled = !has || !cuts.length;
  }

  el.splitPlay.addEventListener('click', function () {
    if (!decoded) return;
    if (transport.playing()) { transport.pause(); updateUI(); return; }
    if (transport.ctx && transport.paused) { transport.resume(); updateUI(); return; }
    transport.play(decoded, wave.playheadTime);
    updateUI();
  });
  el.splitStop.addEventListener('click', function () { transport.stop(); updateUI(); });
  el.splitBack.addEventListener('click', function () { transport.seek(-5, dur()); updateUI(); });
  el.splitFwd.addEventListener('click', function () { transport.seek(5, dur()); updateUI(); });
  el.splitZoomIn.addEventListener('click', function () { wave.zoomBy(0.5); renderCuts(); updateViewRange(); });
  el.splitZoomOut.addEventListener('click', function () { wave.zoomBy(2); renderCuts(); updateViewRange(); });
  el.splitReplace.addEventListener('click', function () { el.splitFile.click(); });

  /* ----- inputs ----- */

  el.splitDrop.addEventListener('click', function () { el.splitFile.click(); });
  el.splitFile.addEventListener('change', function () {
    if (el.splitFile.files[0]) loadFile(el.splitFile.files[0]);
    el.splitFile.value = '';
  });
  ['dragover', 'dragenter'].forEach(function (ev) {
    el.splitDrop.addEventListener(ev, function (e) { e.preventDefault(); });
  });
  el.splitDrop.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  document.addEventListener('paste', function (e) {
    if ($('trimPanel-split').hidden) return;
    var f = (e.clipboardData && e.clipboardData.files || [])[0];
    if (f && isAudioFile(f)) loadFile(f);
  });

  document.addEventListener('keydown', function (e) {
    if ($('trimPanel-split').hidden || !decoded) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (/INPUT|TEXTAREA/.test(tag)) return;
    if (e.key === 'c' || e.key === 'C') { addCut(wave.playheadTime); } // quick cut key
  });

  window.addEventListener('resize', function () {
    if (decoded && !$('trimPanel-split').hidden) { wave.refresh(); renderCuts(); }
  });

  return {
    refresh: function () { if (decoded) { wave.refresh(); renderCuts(); updateViewRange(); } }
  };
})();

/* ================= JOIN TAB ================= */

var join = (function () {
  var files = []; // {id, name, buffer, duration}
  var seq = 0;
  var merged = null; // {channels, sr, buffer}
  var transport = null; // lightweight: reuse Transport with a dummy wave
  var dummyWave = {
    playheadTime: 0, viewStart: 0, viewEnd: 0,
    viewLen: function () { return 1; },
    setPlayhead: function (tm) { this.playheadTime = tm; },
    positionPlayhead: function () {},
    setView: function () {},
    duration: 0
  };
  var player = Transport(dummyWave, updateUI);

  var el = {};
  ['joinDrop', 'joinFile', 'joinFileList', 'joinHint', 'joinEmpty',
   'joinMerge', 'joinPlay', 'joinStop', 'joinDownload', 'joinClear', 'joinInfo'
  ].forEach(function (id) { el[id] = $(id); });

  function setHint(m) { el.joinHint.textContent = m || ''; }

  function addFiles(list) {
    var news = Array.prototype.filter.call(list, isAudioFile);
    if (!news.length) { alert(t('notAudio')); return; }
    setHint(t('decoding'));
    var done = 0;
    news.forEach(function (f) {
      decodeFile(f).then(function (ab) {
        files.push({ id: ++seq, name: f.name, buffer: ab, duration: ab.duration });
        merged = null;
        done++;
        if (done === news.length) {
          renderList(); updateUI();
          setHint(t('joinHint2'));
        }
      }).catch(function () {
        done++;
        alert(t('decodeFail') + ' (' + f.name + ')');
        if (done === news.length) { renderList(); updateUI(); }
      });
    });
  }

  function renderList() {
    var box = el.joinFileList;
    box.innerHTML = '';
    el.joinEmpty.style.display = files.length ? 'none' : 'block';
    files.forEach(function (f, i) {
      var row = document.createElement('div');
      row.className = 'bleep-row';
      row.innerHTML =
        '<button type="button" class="bnum">#' + (i + 1) + '</button>' +
        '<span class="btime" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          escapeHtml(f.name) + ' <span style="opacity:.6">(' + fmt(f.duration) + ')</span></span>' +
        '<button type="button" class="btn-ghost j-up" aria-label="' + t('moveUp') + '">↑</button>' +
        '<button type="button" class="btn-ghost j-dn" aria-label="' + t('moveDown') + '">↓</button>' +
        '<button type="button" class="bx2" aria-label="' + t('remove') + '">×</button>';
      row.querySelector('.j-up').addEventListener('click', function () { move(f.id, -1); });
      row.querySelector('.j-dn').addEventListener('click', function () { move(f.id, 1); });
      row.querySelector('.bx2').addEventListener('click', function () { remove(f.id); });
      box.appendChild(row);
    });
    updateTotal();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function move(id, dir) {
    var i = files.findIndex(function (f) { return f.id === id; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= files.length) return;
    var tmp = files[i]; files[i] = files[j]; files[j] = tmp;
    merged = null;
    player.stop(true);
    renderList(); updateUI();
  }

  function remove(id) {
    files = files.filter(function (f) { return f.id !== id; });
    merged = null;
    player.stop(true);
    renderList(); updateUI();
  }

  function updateTotal() {
    var total = files.reduce(function (s, f) { return s + f.duration; }, 0);
    el.joinInfo.textContent = files.length
      ? t('joinTotal').replace('{n}', files.length).replace('{d}', fmt(total))
      : '';
  }

  // Merge: all buffers are 44100 Hz (decoded that way). Upmix mono → stereo
  // when any file is stereo; cap at 2 channels.
  function buildMerged() {
    if (files.length < 2) { alert(t('joinNeed2')); return null; }
    var sr = 44100;
    var nCh = 1;
    files.forEach(function (f) { nCh = Math.max(nCh, Math.min(2, f.buffer.numberOfChannels)); });
    var per = files.map(function (f) {
      var src = bufferChannels(f.buffer);
      var out = [];
      for (var c = 0; c < nCh; c++) out.push(src[Math.min(c, src.length - 1)]);
      return out;
    });
    var totalLen = per.reduce(function (s, chs) { return s + chs[0].length; }, 0);
    var mergedChs = [];
    for (var c = 0; c < nCh; c++) {
      var m = new Float32Array(totalLen), o = 0;
      per.forEach(function (chs) { m.set(chs[c], o); o += chs[c].length; });
      mergedChs.push(m);
    }
    return { channels: mergedChs, sr: sr };
  }

  el.joinMerge.addEventListener('click', function () {
    var res = buildMerged();
    if (!res) return;
    merged = res;
    dummyWave.duration = res.channels[0].length / res.sr;
    player.play(channelsToBuffer(res.channels, res.sr), 0);
    updateUI();
    setHint(t('joinMergedHint'));
  });

  el.joinPlay.addEventListener('click', function () {
    if (player.playing()) { player.pause(); updateUI(); return; }
    if (player.ctx && player.paused) { player.resume(); updateUI(); return; }
    var res = merged || buildMerged();
    if (!res) return;
    merged = res;
    dummyWave.duration = res.channels[0].length / res.sr;
    player.play(channelsToBuffer(res.channels, res.sr), dummyWave.playheadTime);
    updateUI();
  });
  el.joinStop.addEventListener('click', function () { player.stop(); updateUI(); });

  el.joinDownload.addEventListener('click', function () {
    var res = merged || buildMerged();
    if (!res) return;
    merged = res;
    downloadWav(res.channels, res.sr, 'joined.wav');
  });

  el.joinClear.addEventListener('click', function () {
    files = []; merged = null;
    player.stop(true);
    dummyWave.playheadTime = 0;
    renderList(); updateUI(); setHint('');
  });

  function updateUI() {
    var has = files.length >= 2;
    var playing = player.playing();
    el.joinPlay.textContent = playing ? '⏸ ' + t('pause') : '▶ ' + t('play');
    el.joinPlay.disabled = !has;
    el.joinStop.disabled = !player.ctx;
    el.joinMerge.disabled = !has;
    el.joinDownload.disabled = !has;
    el.joinClear.disabled = !files.length;
  }

  /* ----- inputs ----- */

  el.joinDrop.addEventListener('click', function () { el.joinFile.click(); });
  el.joinFile.addEventListener('change', function () {
    if (el.joinFile.files.length) addFiles(el.joinFile.files);
    el.joinFile.value = '';
  });
  ['dragover', 'dragenter'].forEach(function (ev) {
    el.joinDrop.addEventListener(ev, function (e) { e.preventDefault(); });
  });
  el.joinDrop.addEventListener('drop', function (e) {
    e.preventDefault();
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  document.addEventListener('paste', function (e) {
    if ($('trimPanel-join').hidden) return;
    var fs = e.clipboardData && e.clipboardData.files;
    if (fs && fs.length) addFiles(fs);
  });

  renderList(); updateUI();

  return {
    refresh: function () { updateUI(); }
  };
})();

/* ---------- global refresh on tab switch / resize ---------- */

window.TrimUI = {
  refresh: function () {
    if (!$('trimPanel-trim').hidden && trim.refresh) trim.refresh();
    if (!$('trimPanel-split').hidden && split.refresh) split.refresh();
    if (!$('trimPanel-join').hidden && join.refresh) join.refresh();
  }
};

})();
