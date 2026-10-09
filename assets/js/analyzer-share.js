/* analyzer-share.js — one-way sharing FROM the Analyzer to the Bleep/Edit pages.
   - Original file: captured (read-only) whenever the user picks an audio file
     in the Analyzer UI (capture-phase listener; never interferes with the app).
   - Normalized file: when the user exports the "-14 LUFS" WAV, that exact
     blob becomes the shared file (named after the original).
   The Analyzer never auto-loads the shared file (one-way by design).
   Requires: assets/js/shared-audio.js loaded before this file. */
(function () {
'use strict';
if (!window.SharedAudio) return;

function isAudioFile(f) {
  return !!f && (/^audio\//.test(f.type) ||
    /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm)$/i.test(f.name || ''));
}

/* 1. original file, whenever picked in the Analyzer UI */
document.addEventListener('change', function (e) {
  try {
    var t = e.target;
    if (t && t.type === 'file' && t.files && t.files[0] && isAudioFile(t.files[0])) {
      window.SharedAudio.saveFile(t.files[0]);
    }
  } catch (err) {}
}, true);

/* 2. normalized "-14 LUFS" WAV export -> share that exact blob */
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
})();
