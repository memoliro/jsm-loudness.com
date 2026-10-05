/* JSM Loudness landing — upload window bridge.
   Forwards dropped / browsed / pasted audio files into the React analyzer's
   hidden file input, so the big landing drop zone drives the same engine. */
(function(){
  "use strict";

  var STR = null; // set in init() from the drop zone's data attributes

  function status(msg){
    var el = document.getElementById('dropStatus');
    if(el) el.textContent = msg;
  }

  // Feed files to the analyzer by populating its file input and firing change.
  function forwardFiles(files, attempt){
    if(!files || !files.length) return;
    var input = document.querySelector('#root input[type="file"]');
    if(!input){
      // React still booting — retry briefly, then tell the user.
      if((attempt||0) < 6){
        setTimeout(function(){ forwardFiles(files, (attempt||0)+1); }, 400);
      } else {
        status(STR.loading);
      }
      return;
    }
    try{
      var dt = new DataTransfer();
      for(var i=0;i<files.length;i++){
        var f = files[i];
        if(f && f.size) dt.items.add(f);
      }
      if(dt.files.length === 0) return;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
      var names = [];
      for(var j=0;j<Math.min(files.length,3);j++) names.push(files[j].name);
      status(STR.analyzing + names.join(', ') + (files.length>3 ? STR.more.replace('{n}', files.length-3) : '') + ' …');
    }catch(e){
      status(STR.fallback);
    }
    // Multi-file drops also feed the batch table, like a native drop on the card.
    if(files.length > 1 && window.__jsmBatchAdd){
      try{ window.__jsmBatchAdd(files); }catch(e){}
    }
  }

  function audioFilesFrom(event){
    var out = [];
    var dt = event.dataTransfer || (event.clipboardData ? event.clipboardData : null);
    if(dt && dt.files){
      for(var i=0;i<dt.files.length;i++){
        var f = dt.files[i];
        if(f && (f.type.indexOf('audio') === 0 || /\.(wav|mp3|flac|ogg|oga|m4a|aac|opus|webm)$/i.test(f.name))) out.push(f);
      }
    }
    return out;
  }

  function init(){
    var dz = document.getElementById('dropWindow');
    var fi = document.getElementById('dropFile');
    if(!dz || !fi) return;
    STR = {
      analyzing: dz.getAttribute('data-str-analyzing') || 'Analyzing ',
      more: dz.getAttribute('data-str-more') || ' (+{n} more)',
      loading: dz.getAttribute('data-str-loading') || 'Analyzer is still loading — please try again in a moment.',
      nofile: dz.getAttribute('data-str-nofile') || 'That did not look like an audio file — try WAV, MP3, FLAC, OGG or M4A.',
      fallback: dz.getAttribute('data-str-fallback') || 'Could not hand the file to the analyzer — please use its own Choose file button below.'
    };

    dz.addEventListener('click', function(e){
      // Let the inner button's own click work; zone click opens the picker.
      fi.click();
    });
    dz.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fi.click(); }
    });
    fi.addEventListener('change', function(){
      forwardFiles(fi.files);
      fi.value = '';
    });

    ['dragenter','dragover'].forEach(function(ev){
      dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave','drop'].forEach(function(ev){
      dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function(e){
      var files = audioFilesFrom(e);
      if(files.length) forwardFiles(files);
      else status(STR.nofile);
    });

    // Never navigate away when a file misses the zone.
    window.addEventListener('dragover', function(e){ e.preventDefault(); });
    window.addEventListener('drop', function(e){ e.preventDefault(); });

    // Paste support, like the Bleep tool.
    document.addEventListener('paste', function(e){
      var files = audioFilesFrom(e);
      if(files.length){ e.preventDefault(); forwardFiles(files); }
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
