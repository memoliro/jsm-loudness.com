/* Internal GPU field test worker — Kim Mel-Band RoFormer FP16 (NOT production).
 * Loads the model from same-origin parts, opens a session WebGPU-first,
 * runs the posted windows, reports timings + finiteness per window. */
'use strict';
importScripts(new URL('../vendor/ort2/ort.min.js', self.location.href).href);

var MODEL_PARTS = 21;
var MODEL_BYTES = 497530495;
var BASE = new URL('../models/kim-fp16/', self.location.href).href;

function post(line) { self.postMessage({ line: line }); }

async function fetchModel() {
  var chunks = [];
  var total = 0;
  for (var i = 0; i < MODEL_PARTS; i++) {
    var url = BASE + 'part-' + String(i).padStart(2, '0');
    var res = await fetch(url);
    if (!res.ok) throw new Error('model part ' + i + ' HTTP ' + res.status);
    var buf = await res.arrayBuffer();
    chunks.push(new Uint8Array(buf));
    total += buf.byteLength;
    if (i % 5 === 4 || i === MODEL_PARTS - 1) post('Model download: ' + (i + 1) + ' / ' + MODEL_PARTS + ' parts (' + Math.round(total / 1048576) + ' MB)');
  }
  if (total !== MODEL_BYTES) throw new Error('model size mismatch: got ' + total + ', expected ' + MODEL_BYTES);
  var whole = new Uint8Array(total);
  var off = 0;
  for (var c of chunks) { whole.set(c, off); off += c.length; }
  post('Model assembled: ' + Math.round(total / 1048576) + ' MB, size verified.');
  return whole.buffer;
}

self.onmessage = async function (e) {
  var m = e.data;
  if (!m || m.type !== 'go') return;
  try {
    post('Worker up. crossOriginIsolated = ' + self.crossOriginIsolated + ', cores = ' + (navigator.hardwareConcurrency || '?'));
    var ortBase = new URL('../vendor/ort2/', self.location.href).href;
    ort.env.wasm.wasmPaths = ortBase;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    var t0 = Date.now();
    var buf = await fetchModel();
    post('Fetch+assemble took ' + ((Date.now() - t0) / 1000).toFixed(1) + 's.');

    var session = null, used = '';
    var t1 = Date.now();
    try {
      session = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'], graphOptimizationLevel: 'basic' });
      used = 'WebGPU';
    } catch (gpuErr) {
      post('WebGPU-only session failed: ' + String(gpuErr && gpuErr.message || gpuErr).slice(0, 200));
      session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'basic' });
      used = 'WASM (fallback)';
    }
    post('Session created on ' + used + ' in ' + ((Date.now() - t1) / 1000).toFixed(1) + 's. Running windows…');

    var N = 352800;
    var times = [];
    for (var wi = 0; wi < m.windows.length; wi++) {
      var wn = m.windows[wi];
      var data = new Float32Array(2 * N);
      data.set(wn.l, 0); data.set(wn.r, N);
      var t2 = Date.now();
      var out = await session.run({ mix: new ort.Tensor('float32', data, [1, 2, N]) });
      var ms = Date.now() - t2;
      times.push(ms);
      var d = out.sources.data;
      var s = 0, finite = true;
      for (var i = 0; i < N; i += 7) { var v = d[i]; if (!isFinite(v)) { finite = false; break; } s += v * v; }
      var rms = Math.sqrt(s / Math.ceil(N / 7));
      post('Window ' + (wi + 1) + ': ' + (ms / 1000).toFixed(1) + 's | vocals RMS(sampled) ' + rms.toFixed(4) + ' | finite ' + finite);
      if (!finite) throw new Error('non-finite output on window ' + (wi + 1));
    }
    var avg = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
    post('PASS — ' + times.length + ' windows completed on ' + used + ', avg ' + (avg / 1000).toFixed(1) + 's per 8s window (' + (avg / 8000).toFixed(2) + 'x realtime). A 4-minute song at 50% overlap ≈ ' + Math.round(59 * avg / 60000) + ' min.');
  } catch (err) {
    post('FAIL — ' + String(err && err.message || err));
  }
};
