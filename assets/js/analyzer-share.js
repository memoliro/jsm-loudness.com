/* analyzer-share.js — one-way sharing FROM the Analyzer to the Bleep/Edit pages,
   plus Analyzer persistence across in-site navigation.
   - Original file: captured (read-only) whenever the user picks an audio file
     in the Analyzer UI (browse or drag-drop; capture-phase, never interferes).
   - Normalized file: clicking "Normalize to -14 LUFS" recomputes the normalized
     file with the app's exact formula (gain = 10^((-14-integrated)/20), clamp
     +/-0.89) and shares THAT, so other tabs play the loudness the user heard.
   - Export: the "-14 LUFS" WAV download blob becomes the shared file as-is.
   - Persistence: on boot, if this page view hasn't loaded a file yet, the shared
     file is injected back into the Analyzer input (React picks it up via change).
   The Analyzer never auto-loads from other tabs mid-session (one-way by design).
   Requires: assets/js/shared-audio.js loaded before this file. */
(function () {
'use strict';
if (!window.SharedAudio) return;

function isAudioFile(f) {
  return !!f && (/^audio\//.test(f.type) ||
    /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|wma)$/i.test(f.name || ''));
}

/* 1. original file, whenever picked in the Analyzer UI (browse or drop) */
document.addEventListener('change', function (e) {
  try {
    var t = e.target;
    if (t && t.type === 'file' && t.files && t.files[0] && isAudioFile(t.files[0])) {
      window.__analyzerSawPick = true;
      window.SharedAudio.saveFile(t.files[0]);
    }
  } catch (err) {}
}, true);
document.addEventListener('drop', function (e) {
  try {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0] && isAudioFile(dt.files[0])) {
      window.__analyzerSawPick = true;
      window.SharedAudio.saveFile(dt.files[0]);
    }
  } catch (err) {}
}, true);

/* 2. "Normalize to -14 LUFS" click -> share the normalized file.
   Mirrors the app's DSP exactly: m = -14 - integrated; z = 10^(m/20);
   per-sample: clamp(sample * z, -0.89, 0.89). The integrated value comes
   from the app's own session (jsm-session-v2). */
function encodeWavWithGain(buf, gain) {
  var nCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
  var bytes = 44 + len * nCh * 2;
  var ab = new ArrayBuffer(bytes), v = new DataView(ab);
  function ws(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
  ws(0, 'RIFF'); v.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, len * nCh * 2, true);
  var off = 44, ch = [], c, i;
  for (c = 0; c < nCh; c++) ch.push(buf.getChannelData(c));
  for (i = 0; i < len; i++) {
    for (c = 0; c < nCh; c++) {
      var s2 = ch[c][i] * gain;
      s2 = Math.max(-0.89, Math.min(0.89, s2));
      v.setInt16(off, Math.max(-1, Math.min(1, s2)) * 32767, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
function shareNormalized() {
  var integrated = null;
  try {
    var raw = sessionStorage.getItem('jsm-session-v2');
    if (raw) {
      var sess = JSON.parse(raw);
      if (sess && sess.analysis && typeof sess.analysis.integrated === 'number') {
        integrated = sess.analysis.integrated;
      }
    }
  } catch (e) {}
  if (integrated === null) return;
  var gain = Math.pow(10, (-14 - integrated) / 20);
  window.SharedAudio.loadFile().then(function (file) {
    if (!file) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = new AC();
    function done() { try { ctx.close(); } catch (e) {} }
    file.arrayBuffer().then(function (ab) { return ctx.decodeAudioData(ab); })
      .then(function (buf) {
        var wav = encodeWavWithGain(buf, gain);
        var base = (file.name || 'audio').replace(/\.[^.]+$/, '');
        return window.SharedAudio.saveFile(new File([wav], base + '_-14LUFS.wav', { type: 'audio/wav' }));
      })
      .then(done, done);
  }).catch(function () {});
}
document.addEventListener('click', function (e) {
  var el = e.target && e.target.closest ? e.target.closest('button') : null;
  var txt = el ? (el.textContent || '') : '';
  if (txt.indexOf('Normalize to -14') !== -1) {
    setTimeout(shareNormalized, 800);
  }
}, true);

/* 3. normalized "-14 LUFS" WAV export -> share that exact blob */
try {
  var wavBlobs = {};
  var origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    var url = origCreate(blob);
    try { if (blob && blob.type === 'audio/wav') wavBlobs[url] = blob; } catch (e) {}
    return url;
  };
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      var dl = this.download || '', href = this.href || '';
      var blob = (dl.indexOf('-14LUFS') !== -1) ? wavBlobs[href] : null;
      if (blob) {
        window.SharedAudio.loadFile().then(function (prev) {
          var base = (prev && prev.name ? prev.name : 'loudness').replace(/\.[^/.]+$/, '');
          window.SharedAudio.saveFile(new File([blob], base + '_-14LUFS.wav', { type: 'audio/wav' }));
        });
      }
    } catch (e) {}
    return origClick.apply(this, arguments);
  };
} catch (e) {}

/* 4. boot: put the shared file back into the Analyzer after navigation.
   Only when this page view hasn't loaded a file yet (flag set by 1. above),
   and only into an empty main input (multiple = the main analyzer).
   Respects the fresh-visit rule: a brand-new session starts clean. */
window.SharedAudio.wipeIfFresh(['current']).then(function (restore) {
  if (!restore) return;
  return window.SharedAudio.loadFile();
}).then(function (file) {
  if (!file || window.__analyzerSawPick) return;
  var tries = 0;
  var timer = setInterval(function () {
    if (window.__analyzerSawPick) { clearInterval(timer); return; }
    var inputs = document.querySelectorAll('input[type="file"][accept*="audio"]');
    var target = null, i;
    for (i = 0; i < inputs.length; i++) {
      if (inputs[i].multiple) { target = inputs[i]; break; }
    }
    if (target && !target.files.length) {
      try {
        var dt = new DataTransfer();
        dt.items.add(file);
        target.files = dt.files;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        window.__analyzerSawPick = true;
      } catch (e) {}
      clearInterval(timer);
    }
    if (++tries > 60) clearInterval(timer);
  }, 250);
}).catch(function () {});
})();
