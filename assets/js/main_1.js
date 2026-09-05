
(function(){
  const KEY = 'jsm_consent_v1';
  const BANNER = document.getElementById('consent-banner');
  function get(){ try { return localStorage.getItem(KEY); } catch(e){ return null; } }
  function setGranted(){
    try {
      localStorage.setItem(KEY, 'granted');
      document.cookie = KEY + '=granted; path=/; max-age=' + (365*24*3600) + '; SameSite=Lax; Secure';
    } catch(e){}
  }
  function setDenied(){
    try {
      localStorage.setItem(KEY, 'denied');
      document.cookie = KEY + '=denied; path=/; max-age=' + (24*3600) + '; SameSite=Lax; Secure';
    } catch(e){}
  }
  function show(){ if(BANNER) BANNER.style.display='flex'; }
  function hide(){ if(BANNER) BANNER.style.display='none'; }

  window.acceptConsent = function(){
    setGranted();
    if(typeof gtag === 'function'){
      gtag('consent','update',{
        analytics_storage:'granted',
        ad_storage:'denied',
        ad_user_data:'denied',
        ad_personalization:'denied'
      });
      gtag('config','G-64EC8JJF7Q',{anonymize_ip:true});
      gtag('event','page_view');
    }
    hide();
  };
  window.rejectConsent = function(){
    setDenied();
    hide();
    // Per request: ask until Accept - show again after short delay
    setTimeout(show, 1500);
  };

  var c = get();
  if(c === 'granted'){
    if(typeof gtag === 'function'){
      gtag('consent','update',{analytics_storage:'granted'});
      gtag('config','G-64EC8JJF7Q',{anonymize_ip:true});
    }
    hide();
  } else {
    setTimeout(show, 600);
  }
})();
