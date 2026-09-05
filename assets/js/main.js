
(function(){
  const KEY = 'jsm_consent_v1';
  function getLS(){ try { return localStorage.getItem(KEY); } catch(e){ return null; } }
  function setLS(v){ try { localStorage.setItem(KEY, v); } catch(e){} }
  function getCookie(){
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + KEY + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch(e){ return null; }
  }
  function setCookie(v, days){
    try {
      var expires = '';
      if(days){
        var d = new Date();
        d.setTime(d.getTime() + (days*24*60*60*1000));
        expires = '; expires=' + d.toUTCString();
      }
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = KEY + '=' + encodeURIComponent(v) + expires + '; path=/' + '; SameSite=Lax' + secure;
    } catch(e){}
  }
  function getConsent(){
    return getLS() || getCookie();
  }
  function setGranted(){
    setLS('granted');
    setCookie('granted', 365);
  }
  function setDenied(){
    setLS('denied');
    setCookie('denied', 1);
  }
  function getBanner(){ return document.getElementById('consent-banner'); }
  function showBanner(){
    var b = getBanner();
    if(b) b.style.display = 'flex';
  }
  function hideBanner(){
    var b = getBanner();
    if(b) b.style.display = 'none';
  }
  function enableGA(){
    if(typeof gtag === 'function'){
      gtag('consent','update',{
        analytics_storage:'granted',
        ad_storage:'denied',
        ad_user_data:'denied',
        ad_personalization:'denied'
      });
      gtag('config','G-64EC8JJF7Q',{anonymize_ip:true});
    }
  }

  window.acceptConsent = function(){
    setGranted();
    enableGA();
    if(typeof gtag === 'function'){ try { gtag('event','page_view'); } catch(e){} }
    hideBanner();
    console.log('[JSM] consent granted, will never ask again');
  };
  window.rejectConsent = function(){
    setDenied();
    hideBanner();
    // As per your request: ask until Accept - show again after 2 sec
    setTimeout(showBanner, 2000);
    console.log('[JSM] consent denied, will ask again');
  };

  function init(){
    var c = getConsent();
    console.log('[JSM] consent check:', c);
    if(c === 'granted'){
      enableGA();
      hideBanner();
    } else {
      // not granted -> show until accepted
      showBanner();
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // also try again after 800ms in case banner injected late (React)
  setTimeout(init, 800);
})();
