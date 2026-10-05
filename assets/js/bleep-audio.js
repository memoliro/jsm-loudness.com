/* BleepAudio — pure audio helpers for the bleep-audio tool.
   No DOM, no AudioContext here: everything is data-in/data-out so this file
   is unit-testable in Node. The page wires it up via assets/js/bleep-ui.js. */
(function (root) {
  'use strict';

  // Mix multi-channel data down to mono for waveform display.
  // channels: Array<Float32Array> (same length). Returns Float32Array.
  function mixToMono(channels) {
    if (!channels || !channels.length) return new Float32Array(0);
    if (channels.length === 1) return channels[0];
    var len = channels[0].length, out = new Float32Array(len), n = channels.length;
    for (var i = 0; i < len; i++) {
      var s = 0;
      for (var c = 0; c < n; c++) s += channels[c][i] || 0;
      out[i] = s / n;
    }
    return out;
  }

  // Peak-abs per bucket for waveform drawing. Returns Float32Array(buckets) in 0..1.
  function computePeaks(mono, buckets) {
    buckets = Math.max(1, Math.floor(buckets) || 1);
    var out = new Float32Array(buckets);
    if (!mono || !mono.length) return out;
    var per = mono.length / buckets;
    for (var b = 0; b < buckets; b++) {
      var start = Math.floor(b * per), end = Math.floor((b + 1) * per), peak = 0;
      if (end <= start) end = start + 1;
      for (var i = start; i < end && i < mono.length; i++) {
        var a = Math.abs(mono[i]);
        if (a > peak) peak = a;
      }
      out[b] = peak > 1 ? 1 : peak;
    }
    return out;
  }

  // Normalize user regions: clamp to [0, duration], drop empties, sort,
  // merge overlaps (earliest region's mode wins). Pure.
  // regions: [{start, end, mode:'bleep'|'mute'}]
  function normalizeRegions(regions, duration) {
    duration = Math.max(0, +duration || 0);
    var list = [];
    (regions || []).forEach(function (r) {
      var s = Math.max(0, Math.min(duration, +r.start || 0));
      var e = Math.max(0, Math.min(duration, r.end == null ? s : +r.end));
      if (e < s) { var tmp = s; s = e; e = tmp; } // tolerate reversed bounds
      if (e - s < 0.02) return; // ignore slivers
      list.push({ start: s, end: e, mode: r.mode === 'mute' ? 'mute' : 'bleep' });
    });
    list.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    var merged = [];
    list.forEach(function (r) {
      var prev = merged[merged.length - 1];
      if (prev && r.start <= prev.end) {
        if (r.end > prev.end) prev.end = r.end; // earliest mode wins
      } else merged.push(r);
    });
    return merged;
  }

  // Build the render plan the UI feeds to OfflineAudioContext.
  // Returns {segments:[{start,end,mode}], totalRegions} with normalized segments.
  function planRender(regions, duration) {
    var segments = normalizeRegions(regions, duration);
    return { segments: segments, totalRegions: segments.length };
  }

  // Encode channels to 16-bit PCM WAV. channels: Array<Float32Array>.
  // Returns Uint8Array (page wraps in Blob). Pure.
  function encodeWav(channels, sampleRate) {
    sampleRate = Math.floor(sampleRate) || 44100;
    var nCh = channels.length, len = nCh ? channels[0].length : 0;
    var bytesPerSample = 2, blockAlign = nCh * bytesPerSample;
    var dataSize = len * blockAlign;
    var buf = new ArrayBuffer(44 + dataSize), dv = new DataView(buf), p = 0;
    function wstr(s) { for (var i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); }
    wstr('RIFF'); dv.setUint32(p, 36 + dataSize, true); p += 4;
    wstr('WAVE'); wstr('fmt '); dv.setUint32(p, 16, true); p += 4;
    dv.setUint16(p, 1, true); p += 2;            // PCM
    dv.setUint16(p, nCh, true); p += 2;
    dv.setUint32(p, sampleRate, true); p += 4;
    dv.setUint32(p, sampleRate * blockAlign, true); p += 4;
    dv.setUint16(p, blockAlign, true); p += 2;
    dv.setUint16(p, 16, true); p += 2;
    wstr('data'); dv.setUint32(p, dataSize, true); p += 4;
    for (var i = 0; i < len; i++) {
      for (var c = 0; c < nCh; c++) {
        var v = Math.max(-1, Math.min(1, channels[c][i] || 0));
        dv.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7FFF, true); p += 2;
      }
    }
    return new Uint8Array(buf);
  }

  // Minimal WAV parser for tests: returns {sampleRate, channels, nCh} or null.
  function parseWav(u8) {
    try {
      var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      function rs(o, n) { var s = ''; for (var i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(o + i)); return s; }
      if (rs(0, 4) !== 'RIFF' || rs(8, 4) !== 'WAVE') return null;
      var fmt = dv.getUint16(20, true), nCh = dv.getUint16(22, true);
      var sr = dv.getUint32(24, true), bits = dv.getUint16(34, true);
      if (fmt !== 1 || bits !== 16) return null;
      var dataSize = dv.getUint32(40, true), len = dataSize / (nCh * 2), channels = [];
      for (var c = 0; c < nCh; c++) channels.push(new Float32Array(len));
      var p = 44;
      for (var i = 0; i < len; i++) for (var c2 = 0; c2 < nCh; c2++) {
        channels[c2][i] = dv.getInt16(p, true) / 0x8000; p += 2;
      }
      return { sampleRate: sr, channels: channels, nCh: nCh };
    } catch (e) { return null; }
  }

  function formatTime(sec) {
    var total = Math.round(Math.max(0, +sec || 0) * 10) / 10;
    var m = Math.floor(total / 60), s = total - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  var api = {
    mixToMono: mixToMono,
    computePeaks: computePeaks,
    normalizeRegions: normalizeRegions,
    planRender: planRender,
    encodeWav: encodeWav,
    parseWav: parseWav,
    formatTime: formatTime
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BleepAudio = api;
})(typeof self !== 'undefined' ? self : this);
