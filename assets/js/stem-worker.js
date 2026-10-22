/* JSM Loudness — Stem Splitter engine worker
 * Runs Meta's HTDemucs (ONNX export, MIT) entirely on the visitor's device
 * via onnxruntime-web. No audio ever leaves the browser tab; the only
 * network fetch is the one-time model download from Hugging Face, cached
 * in the Cache API afterwards.
 *
 * Model: htdemucs_embedded.onnx (~172 MB) — 4 stems: drums, bass, other,
 * vocals. The DSP recipe (dual waveform+spectrogram inputs, combined
 * time/frequency outputs, segment overlap-add) lives in stem-core.js, a
 * port of the demucs-web reference implementation (MIT, (c) timcsy).
 */
'use strict';

importScripts(new URL('stem-core.js?v=20261022-1', self.location.href).href);

var MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
var CACHE_NAME = 'jsm-stems-model-v1';

var session = null;
var initPromise = null;

function ortBase() {
  return new URL('../vendor/ort/', self.location.href).href;
}

function post(msg, transfer) {
  if (transfer && transfer.length) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}

/* Fetch the model with progress, storing it in the Cache API so repeat
 * visits skip the download entirely. */
function fetchModel() {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(MODEL_URL).then(function (hit) {
      if (hit) {
        post({ type: 'model-progress', loaded: 1, total: 1, cached: true });
        return hit.arrayBuffer();
      }
      return fetch(MODEL_URL).then(function (resp) {
        if (!resp.ok) throw new Error('Model download failed (HTTP ' + resp.status + ')');
        var total = parseInt(resp.headers.get('content-length') || '0', 10);
        var reader = resp.body.getReader();
        var chunks = [];
        var loaded = 0;
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            chunks.push(r.value);
            loaded += r.value.byteLength;
            post({ type: 'model-progress', loaded: loaded, total: total, cached: false });
            return pump();
          });
        }
        return pump().then(function () {
          var blob = new Blob(chunks);
          try {
            cache.put(MODEL_URL, new Response(blob.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })).catch(function () {});
          } catch (e) { /* caching is best-effort */ }
          return blob.arrayBuffer();
        });
      });
    });
  });
}

function init() {
  if (initPromise) return initPromise;
  initPromise = (async function () {
    importScripts(new URL('../vendor/ort/ort.min.js', self.location.href).href);
    ort.env.wasm.wasmPaths = ortBase();
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency || 2)))
      : 1;
    var buf = await fetchModel();
    try {
      session = await ort.InferenceSession.create(buf, {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'basic'
      });
      post({ type: 'ready', backend: 'auto (WebGPU if available, else WASM)' });
    } catch (e) {
      session = await ort.InferenceSession.create(buf, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'basic'
      });
      post({ type: 'ready', backend: 'WASM' });
    }
  })();
  return initPromise;
}

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type === 'init') {
    init().catch(function (err) {
      post({ type: 'error', message: 'Engine failed to start: ' + (err && err.message ? err.message : err) });
    });
  } else if (msg.type === 'separate') {
    init()
      .then(function () {
        return STEM_CORE.separateTracks(ort, session, msg.left, msg.right, function (p) {
          post({ type: 'progress', done: p.done, total: p.total });
        });
      })
      .then(function (result) {
        var stems = {};
        var transfer = [];
        STEM_CORE.TRACKS.forEach(function (name) {
          stems[name] = [result[name].left, result[name].right];
          transfer.push(result[name].left.buffer, result[name].right.buffer);
        });
        post({ type: 'stems', stems: stems }, transfer);
      })
      .catch(function (err) {
        post({ type: 'error', message: 'Separation failed: ' + (err && err.message ? err.message : err) });
      });
  }
};
