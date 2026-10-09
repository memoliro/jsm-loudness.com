/* shared-audio.js — one loaded audio file shared across jsm-loudness.com pages.
   Used by: trim-audio (Edit), bleep-audio (Bleep), and the Analyzer batch intake.
   The file stays available until replaced, cleared, or a fresh visit (new tab/session).
   Everything stays in the browser (IndexedDB); nothing is uploaded. */
(function () {
'use strict';

var DB = 'jsmAudio', STORE = 'files';
var dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise(function (res) {
    if (!('indexedDB' in window)) return res(null);
    var rq;
    try { rq = indexedDB.open(DB, 1); } catch (e) { return res(null); }
    rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
    rq.onsuccess = function () { res(rq.result); };
    rq.onerror = function () { res(null); };
  });
  return dbp;
}

function op(mode, key, val, isDelete) {
  return open().then(function (db) {
    return new Promise(function (res) {
      if (!db) return res(null);
      try {
        var t = db.transaction(STORE, mode), st = t.objectStore(STORE);
        var r = isDelete ? st.delete(key) : (val === undefined ? st.get(key) : st.put(val, key));
        r.onsuccess = function () { res(isDelete ? true : (r.result === undefined ? true : r.result)); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  });
}

window.SharedAudio = {
  /* the current shared audio file */
  saveFile: function (f) { return op('readwrite', 'current', f); },
  loadFile: function () { return op('readonly', 'current'); },
  clearFile: function () { return op('readwrite', 'current', null, true); },
  /* generic keys (e.g. the Join tab's file list) */
  put: function (k, v) { return op('readwrite', k, v); },
  get: function (k) { return op('readonly', k); },
  del: function (k) { return op('readwrite', k, null, true); },
  /* Fresh visit (new tab/session, no sessionStorage flag) -> wipe keys first.
     Returns a promise of true when the caller should restore, false on fresh visit. */
  wipeIfFresh: function (keys) {
    var fresh = false;
    try {
      fresh = !sessionStorage.getItem('jsmAudioSession');
      sessionStorage.setItem('jsmAudioSession', '1');
    } catch (e) { fresh = false; }
    if (!fresh) return Promise.resolve(true);
    var p = Promise.resolve();
    (keys || ['current']).forEach(function (k) {
      p = p.then(function () { return op('readwrite', k, null, true); });
    });
    return p.then(function () { return false; });
  }
};

})();
