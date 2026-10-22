/* JSM Loudness — Stem Splitter DSP core
 *
 * Faithful port of the demucs-web reference implementation (MIT License,
 * (c) timcsy — https://github.com/timcsy/demucs-web), which wraps Meta's
 * HTDemucs model (also MIT). The embedded ONNX model takes TWO inputs —
 * the raw waveform segment and its STFT spectrogram — and returns a
 * time-domain stem tensor plus a frequency-domain tensor that must be
 * inverse-STFT'd and added. This file implements exactly that recipe:
 * radix-2 FFT/iFFT, STFT/iSTFT with the model's padding conventions,
 * trapezoid-window overlap-add across 7.8 s segments (25% overlap).
 *
 * Exposed as a classic-script global (STEM_CORE) so the same file runs in
 * the Web Worker and in offline verification harnesses.
 */
'use strict';

var STEM_CORE = (function () {
  var SAMPLE_RATE = 44100;
  var FFT_SIZE = 4096;
  var HOP_SIZE = 1024;
  var TRAINING_SAMPLES = 343980;
  var MODEL_SPEC_BINS = 2048;
  var MODEL_SPEC_FRAMES = 336;
  var SEGMENT_OVERLAP = 0.25;
  var TRACKS = ['drums', 'bass', 'other', 'vocals'];

  /* ---------------- FFT (Cooley–Tukey radix-2) ---------------- */
  var fftTwiddles = new Map();
  var ifftTwiddles = new Map();
  var hannWindows = new Map();

  function getFFTTwiddles(n) {
    if (fftTwiddles.has(n)) return fftTwiddles.get(n);
    var real = new Float32Array(n / 2), imag = new Float32Array(n / 2);
    for (var k = 0; k < n / 2; k++) {
      var angle = -2 * Math.PI * k / n;
      real[k] = Math.cos(angle); imag[k] = Math.sin(angle);
    }
    var t = { real: real, imag: imag };
    fftTwiddles.set(n, t);
    return t;
  }
  function getIFFTTwiddles(n) {
    if (ifftTwiddles.has(n)) return ifftTwiddles.get(n);
    var real = new Float32Array(n / 2), imag = new Float32Array(n / 2);
    for (var k = 0; k < n / 2; k++) {
      var angle = 2 * Math.PI * k / n;
      real[k] = Math.cos(angle); imag[k] = Math.sin(angle);
    }
    var t = { real: real, imag: imag };
    ifftTwiddles.set(n, t);
    return t;
  }
  function getHannWindow(size) {
    if (hannWindows.has(size)) return hannWindows.get(size);
    var window = new Float32Array(size);
    for (var i = 0; i < size; i++) window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / size));
    hannWindows.set(size, window);
    return window;
  }
  function bitReverse(n, bits) {
    var result = 0;
    for (var i = 0; i < bits; i++) { result = (result << 1) | (n & 1); n >>= 1; }
    return result;
  }
  function fft(realOut, imagOut, realIn, n) {
    var bits = Math.log2(n) | 0;
    var twiddles = getFFTTwiddles(n);
    for (var i = 0; i < n; i++) {
      var j = bitReverse(i, bits);
      realOut[i] = realIn[j]; imagOut[i] = 0;
    }
    for (var size = 2; size <= n; size *= 2) {
      var halfSize = size / 2, step = n / size;
      for (var a = 0; a < n; a += size) {
        for (var b = 0; b < halfSize; b++) {
          var k = b * step;
          var tReal = twiddles.real[k], tImag = twiddles.imag[k];
          var idx1 = a + b, idx2 = a + b + halfSize;
          var eReal = realOut[idx1], eImag = imagOut[idx1];
          var oReal = realOut[idx2] * tReal - imagOut[idx2] * tImag;
          var oImag = realOut[idx2] * tImag + imagOut[idx2] * tReal;
          realOut[idx1] = eReal + oReal; imagOut[idx1] = eImag + oImag;
          realOut[idx2] = eReal - oReal; imagOut[idx2] = eImag - oImag;
        }
      }
    }
  }
  function ifft(realOut, imagOut, realIn, imagIn, n) {
    var bits = Math.log2(n) | 0;
    var twiddles = getIFFTTwiddles(n);
    for (var i = 0; i < n; i++) {
      var j = bitReverse(i, bits);
      realOut[i] = realIn[j]; imagOut[i] = imagIn[j];
    }
    for (var size = 2; size <= n; size *= 2) {
      var halfSize = size / 2, step = n / size;
      for (var a = 0; a < n; a += size) {
        for (var b = 0; b < halfSize; b++) {
          var k = b * step;
          var tReal = twiddles.real[k], tImag = twiddles.imag[k];
          var idx1 = a + b, idx2 = a + b + halfSize;
          var eReal = realOut[idx1], eImag = imagOut[idx1];
          var oReal = realOut[idx2] * tReal - imagOut[idx2] * tImag;
          var oImag = realOut[idx2] * tImag + imagOut[idx2] * tReal;
          realOut[idx1] = eReal + oReal; imagOut[idx1] = eImag + oImag;
          realOut[idx2] = eReal - oReal; imagOut[idx2] = eImag - oImag;
        }
      }
    }
    for (var q = 0; q < n; q++) { realOut[q] /= n; imagOut[q] /= n; }
  }
  function stft(signal, fftSize, hopSize) {
    var numFrames = Math.floor((signal.length - fftSize) / hopSize) + 1;
    var numBins = fftSize / 2 + 1;
    var window = getHannWindow(fftSize);
    var scale = 1.0 / Math.sqrt(fftSize);
    var specReal = new Float32Array(numFrames * numBins);
    var specImag = new Float32Array(numFrames * numBins);
    var frameReal = new Float32Array(fftSize);
    var frameImag = new Float32Array(fftSize);
    var windowedFrame = new Float32Array(fftSize);
    for (var frame = 0; frame < numFrames; frame++) {
      var start = frame * hopSize;
      for (var i = 0; i < fftSize; i++) windowedFrame[i] = signal[start + i] * window[i];
      fft(frameReal, frameImag, windowedFrame, fftSize);
      var outOffset = frame * numBins;
      for (var k = 0; k < numBins; k++) {
        specReal[outOffset + k] = frameReal[k] * scale;
        specImag[outOffset + k] = frameImag[k] * scale;
      }
    }
    return { real: specReal, imag: specImag, numFrames: numFrames, numBins: numBins };
  }
  function istft(specReal, specImag, numFrames, numBins, fftSize, hopSize, length) {
    var outputLength = length || (numFrames - 1) * hopSize + fftSize;
    var output = new Float32Array(outputLength);
    var windowSum = new Float32Array(outputLength);
    var window = getHannWindow(fftSize);
    var scale = Math.sqrt(fftSize);
    var fullReal = new Float32Array(fftSize), fullImag = new Float32Array(fftSize);
    var outReal = new Float32Array(fftSize), outImag = new Float32Array(fftSize);
    for (var frame = 0; frame < numFrames; frame++) {
      fullReal.fill(0); fullImag.fill(0);
      for (var k = 0; k < numBins; k++) {
        fullReal[k] = specReal[frame * numBins + k];
        fullImag[k] = specImag[frame * numBins + k];
      }
      for (var m = 1; m < numBins - 1; m++) {
        fullReal[fftSize - m] = fullReal[m];
        fullImag[fftSize - m] = -fullImag[m];
      }
      ifft(outReal, outImag, fullReal, fullImag, fftSize);
      var start = frame * hopSize;
      for (var i = 0; i < fftSize && start + i < outputLength; i++) {
        output[start + i] += outReal[i] * window[i] * scale;
        windowSum[start + i] += window[i] * window[i];
      }
    }
    for (var j = 0; j < outputLength; j++) {
      if (windowSum[j] > 1e-8) output[j] /= windowSum[j];
    }
    return output;
  }
  function reflectPad(signal, padLeft, padRight) {
    var length = signal.length;
    var output = new Float32Array(padLeft + length + padRight);
    for (var i = 0; i < padLeft; i++) {
      var srcIdx = Math.min(padLeft - i, length - 1);
      output[i] = signal[srcIdx];
    }
    output.set(signal, padLeft);
    for (var j = 0; j < padRight; j++) {
      var srcIdx2 = Math.max(0, length - 2 - j);
      output[padLeft + length + j] = signal[srcIdx2];
    }
    return output;
  }

  /* ---------------- Model input/output conventions ---------------- */
  function prepareModelInput(leftChannel, rightChannel) {
    var inputLength = TRAINING_SAMPLES;
    var paddedLeft = new Float32Array(inputLength);
    var paddedRight = new Float32Array(inputLength);
    var copyLen = Math.min(leftChannel.length, inputLength);
    paddedLeft.set(leftChannel.subarray(0, copyLen));
    paddedRight.set(rightChannel.subarray(0, copyLen));

    var le = Math.ceil(inputLength / HOP_SIZE);
    var pad = Math.floor(HOP_SIZE / 2) * 3;
    var padRight = pad + le * HOP_SIZE - inputLength;

    var stftInputLeft = reflectPad(paddedLeft, pad, padRight);
    var stftInputRight = reflectPad(paddedRight, pad, padRight);

    var centerPad = FFT_SIZE / 2;
    var centeredLeft = reflectPad(stftInputLeft, centerPad, centerPad);
    var centeredRight = reflectPad(stftInputRight, centerPad, centerPad);

    var stftLeft = stft(centeredLeft, FFT_SIZE, HOP_SIZE);
    var stftRight = stft(centeredRight, FFT_SIZE, HOP_SIZE);

    var numBins = MODEL_SPEC_BINS, numFrames = MODEL_SPEC_FRAMES;
    var frameOffset = 2;
    var magSpec = new Float32Array(4 * numBins * numFrames);
    for (var f = 0; f < numFrames; f++) {
      var srcFrame = f + frameOffset;
      for (var b = 0; b < numBins; b++) {
        var srcIdx = srcFrame * stftLeft.numBins + b;
        magSpec[0 * numBins * numFrames + b * numFrames + f] = stftLeft.real[srcIdx];
        magSpec[1 * numBins * numFrames + b * numFrames + f] = stftLeft.imag[srcIdx];
        magSpec[2 * numBins * numFrames + b * numFrames + f] = stftRight.real[srcIdx];
        magSpec[3 * numBins * numFrames + b * numFrames + f] = stftRight.imag[srcIdx];
      }
    }
    var waveform = new Float32Array(2 * inputLength);
    waveform.set(paddedLeft, 0);
    waveform.set(paddedRight, inputLength);
    return { waveform: waveform, magSpec: magSpec };
  }

  function standaloneMask(freqOutput) {
    var numTracks = 4, numChannels = 4;
    var numBins = MODEL_SPEC_BINS, numFrames = MODEL_SPEC_FRAMES;
    var result = [];
    for (var t = 0; t < numTracks; t++) {
      var trackSpec = {
        leftReal: new Float32Array(numBins * numFrames),
        leftImag: new Float32Array(numBins * numFrames),
        rightReal: new Float32Array(numBins * numFrames),
        rightImag: new Float32Array(numBins * numFrames)
      };
      for (var f = 0; f < numFrames; f++) {
        for (var b = 0; b < numBins; b++) {
          var baseIdx = t * numChannels * numBins * numFrames;
          var outIdx = b * numFrames + f;
          trackSpec.leftReal[outIdx] = freqOutput[baseIdx + 0 * numBins * numFrames + b * numFrames + f];
          trackSpec.leftImag[outIdx] = freqOutput[baseIdx + 1 * numBins * numFrames + b * numFrames + f];
          trackSpec.rightReal[outIdx] = freqOutput[baseIdx + 2 * numBins * numFrames + b * numFrames + f];
          trackSpec.rightImag[outIdx] = freqOutput[baseIdx + 3 * numBins * numFrames + b * numFrames + f];
        }
      }
      result.push(trackSpec);
    }
    return result;
  }

  function standaloneIspec(trackSpec, targetLength) {
    var numBins = MODEL_SPEC_BINS, numFrames = MODEL_SPEC_FRAMES;
    var hopLength = HOP_SIZE;
    var paddedBins = numBins + 1;
    var paddedFrames = numFrames + 4;
    function padChannel(real, imag) {
      var paddedReal = new Float32Array(paddedFrames * paddedBins);
      var paddedImag = new Float32Array(paddedFrames * paddedBins);
      for (var f = 0; f < numFrames; f++) {
        for (var b = 0; b < numBins; b++) {
          var srcIdx = b * numFrames + f;
          var dstFrame = f + 2;
          var dstIdx = dstFrame * paddedBins + b;
          paddedReal[dstIdx] = real[srcIdx];
          paddedImag[dstIdx] = imag[srcIdx];
        }
      }
      return { real: paddedReal, imag: paddedImag };
    }
    var leftPadded = padChannel(trackSpec.leftReal, trackSpec.leftImag);
    var rightPadded = padChannel(trackSpec.rightReal, trackSpec.rightImag);
    var centerPad = FFT_SIZE / 2;
    var pad = Math.floor(hopLength / 2) * 3;
    var istftLength = (paddedFrames - 1) * hopLength + FFT_SIZE;
    var leftOut = istft(leftPadded.real, leftPadded.imag, paddedFrames, paddedBins, FFT_SIZE, hopLength, istftLength);
    var rightOut = istft(rightPadded.real, rightPadded.imag, paddedFrames, paddedBins, FFT_SIZE, hopLength, istftLength);
    var totalOffset = centerPad + pad;
    var left = leftOut.subarray(totalOffset, totalOffset + targetLength);
    var right = rightOut.subarray(totalOffset, totalOffset + targetLength);
    return { left: new Float32Array(left), right: new Float32Array(right) };
  }

  /* ---------------- Separation (segment loop + overlap-add) ---------------- */
  function separateTracks(ort, session, leftChannel, rightChannel, onProgress) {
    var totalSamples = leftChannel.length;
    var stride = Math.floor(TRAINING_SAMPLES * (1 - SEGMENT_OVERLAP));
    var numSegments = Math.ceil((totalSamples - TRAINING_SAMPLES) / stride) + 1;
    var outputs = TRACKS.map(function () {
      return { left: new Float32Array(totalSamples), right: new Float32Array(totalSamples) };
    });
    var weights = new Float32Array(totalSamples);
    var segmentIdx = 0;

    function runSegment(start) {
      var end = Math.min(start + TRAINING_SAMPLES, totalSamples);
      var segmentLength = end - start;
      var segLeft = new Float32Array(TRAINING_SAMPLES);
      var segRight = new Float32Array(TRAINING_SAMPLES);
      for (var i = 0; i < segmentLength; i++) {
        segLeft[i] = leftChannel[start + i];
        segRight[i] = rightChannel[start + i];
      }
      var input = prepareModelInput(segLeft, segRight);
      var waveformTensor = new ort.Tensor('float32', input.waveform, [1, 2, TRAINING_SAMPLES]);
      var magSpecTensor = new ort.Tensor('float32', input.magSpec, [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES]);
      var feeds = {};
      feeds[session.inputNames[0]] = waveformTensor;
      if (session.inputNames.length > 1) feeds[session.inputNames[1]] = magSpecTensor;

      return session.run(feeds).then(function (inferResults) {
        var timeData = null, timeShape = null, freqData = null;
        session.outputNames.forEach(function (name) {
          var tensor = inferResults[name];
          if (tensor.dims.length === 4 && tensor.dims[2] === 2) { timeData = tensor.data; timeShape = tensor.dims; }
          else if (tensor.dims.length === 5 && tensor.dims[2] === 4) { freqData = tensor.data; }
        });
        if (!timeData) throw new Error('Could not find time-domain output tensor');

        var combinedOutputs = null;
        if (freqData) {
          var trackSpecs = standaloneMask(freqData);
          combinedOutputs = [];
          for (var t = 0; t < 4; t++) {
            var freqOutput = standaloneIspec(trackSpecs[t], TRAINING_SAMPLES);
            var numChannels = timeShape[2], samples = timeShape[3];
            var combined = { left: new Float32Array(samples), right: new Float32Array(samples) };
            for (var i2 = 0; i2 < samples; i2++) {
              combined.left[i2] = timeData[t * numChannels * samples + 0 * samples + i2] + (freqOutput.left[i2] || 0);
              combined.right[i2] = timeData[t * numChannels * samples + 1 * samples + i2] + (freqOutput.right[i2] || 0);
            }
            combinedOutputs.push(combined);
          }
        }

        var numTracks = timeShape[1], numChannels2 = timeShape[2], samples2 = timeShape[3];
        var overlapWindow = new Float32Array(segmentLength);
        for (var w = 0; w < segmentLength; w++) {
          var fadeIn = Math.min(w / (stride * 0.5), 1);
          var fadeOut = Math.min((segmentLength - w) / (stride * 0.5), 1);
          overlapWindow[w] = Math.min(fadeIn, fadeOut);
        }
        for (var t2 = 0; t2 < numTracks; t2++) {
          for (var j = 0; j < segmentLength && start + j < totalSamples; j++) {
            var leftVal, rightVal;
            if (combinedOutputs) {
              leftVal = combinedOutputs[t2].left[j];
              rightVal = combinedOutputs[t2].right[j];
            } else {
              leftVal = timeData[t2 * numChannels2 * samples2 + 0 * samples2 + j];
              rightVal = timeData[t2 * numChannels2 * samples2 + 1 * samples2 + j];
            }
            outputs[t2].left[start + j] += leftVal * overlapWindow[j];
            outputs[t2].right[start + j] += rightVal * overlapWindow[j];
          }
        }
        for (var k = 0; k < segmentLength && start + k < totalSamples; k++) {
          weights[start + k] += overlapWindow[k];
        }
        segmentIdx++;
        if (onProgress) onProgress({ done: segmentIdx, total: numSegments });
        var next = start + stride;
        if (next < totalSamples) return runSegment(next);
        return null;
      });
    }

    return runSegment(0).then(function () {
      for (var t = 0; t < TRACKS.length; t++) {
        for (var i = 0; i < totalSamples; i++) {
          if (weights[i] > 0) {
            outputs[t].left[i] /= weights[i];
            outputs[t].right[i] /= weights[i];
          }
        }
      }
      return { drums: outputs[0], bass: outputs[1], other: outputs[2], vocals: outputs[3] };
    });
  }

  return {
    SAMPLE_RATE: SAMPLE_RATE,
    TRAINING_SAMPLES: TRAINING_SAMPLES,
    TRACKS: TRACKS,
    separateTracks: separateTracks,
    _internals: { stft: stft, istft: istft, reflectPad: reflectPad, prepareModelInput: prepareModelInput }
  };
})();
