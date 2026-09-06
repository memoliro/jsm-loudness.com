// JSM Loudness - Consent handler (Consent Mode v2)
// Behavior: Remember ONLY if Accepted. If Rejected or no choice → ask again every visit.
(function(){
  const MEASUREMENT_ID = 'G-64EC8JJF7Q';
  const CONSENT_KEY = 'jsm_consent_v1';

  function getSavedConsent(){
    try{
      return localStorage.getItem(CONSENT_KEY) || (document.cookie.match(new RegExp(CONSENT_KEY+'=([^;]+)'))||[])[1] || null;
    }catch(e){return null;}
  }

  function setCookieConsent(val){
    try{ localStorage.setItem(CONSENT_KEY, val); }catch(e){}
    try{
      document.cookie = CONSENT_KEY + '=' + val + '; max-age=' + (60*60*24*365) + '; path=/; SameSite=Lax';
    }catch(e){}
  }

  function clearConsent(){
    try{ localStorage.removeItem(CONSENT_KEY); }catch(e){}
    try{ document.cookie = CONSENT_KEY + '=; max-age=0; path=/; SameSite=Lax'; }catch(e){}
  }

  function updateGtag(granted){
    if(!window.gtag) return;
    try{
      window.gtag('consent','update',{
        ad_storage: granted ? 'granted' : 'denied',
        ad_user_data: granted ? 'granted' : 'denied',
        ad_personalization: granted ? 'granted' : 'denied',
        analytics_storage: granted ? 'granted' : 'denied'
      });
      if(granted){
        window.gtag('event','consent_granted');
        window.gtag('config', MEASUREMENT_ID, { anonymize_ip: true });
      }
    }catch(e){}
  }

  function hideBanner(){
    try{
      var b = document.getElementById('consent-banner');
      if(b) b.style.display = 'none';
      var b2 = document.getElementById('cookie-banner');
      if(b2) b2.style.display = 'none';
    }catch(e){}
  }

  function showBanner(){
    try{
      var b = document.getElementById('consent-banner');
      if(b) b.style.display = 'flex';
    }catch(e){}
  }

  // Public API
  window.acceptConsent = function(){
    setCookieConsent('granted');
    updateGtag(true);
    hideBanner();
  };
  window.rejectConsent = function(){
    // Do NOT persist reject — ask again on next visit
    clearConsent();
    updateGtag(false);
    hideBanner();
  };

  function init(){
    var saved = getSavedConsent();
    if(saved === 'granted' || saved === 'accepted'){
      // Only remember Accept
      if(window.gtag){
        try{
          window.gtag('consent','update',{
            ad_storage: 'granted',
            ad_user_data: 'granted',
            ad_personalization: 'granted',
            analytics_storage: 'granted'
          });
          window.gtag('config', MEASUREMENT_ID, { anonymize_ip: true });
        }catch(e){}
      }
      hideBanner();
    } else {
      // No consent or previously rejected → show banner every visit
      clearConsent(); // clean any old 'denied' value
      showBanner();
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
