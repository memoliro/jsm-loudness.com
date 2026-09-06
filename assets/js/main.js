// JSM Loudness - Clean consent handler (no translation, no duplicate)
// Handles GA4 Consent Mode v2, restores saved choice, sends page_view
(function(){
  const MEASUREMENT_ID = 'G-64EC8JJF7Q';
  const CONSENT_KEY = 'jsm_consent_v1';

  function getSavedConsent(){
    try{
      return localStorage.getItem(CONSENT_KEY) || (document.cookie.match(new RegExp(CONSENT_KEY+'=([^;]+)'))||[])[1] || null;
    }catch(e){return null;}
  }

  function setCookieConsent(val){
    try{
      localStorage.setItem(CONSENT_KEY, val);
    }catch(e){}
    try{
      document.cookie = CONSENT_KEY + '=' + val + '; max-age=' + (60*60*24*180) + '; path=/; SameSite=Lax';
    }catch(e){}
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
        // Send page_view after granting
        window.gtag('config', MEASUREMENT_ID, { anonymize_ip: true });
      }
    }catch(e){}
  }

  function hideBanner(){
    try{
      var b=document.getElementById('consent-banner');
      if(b){ b.style.display='none'; }
      var b2=document.getElementById('cookie-banner');
      if(b2){ b2.style.display='none'; }
    }catch(e){}
  }

  // Public functions called by banner buttons
  window.acceptConsent = function(){
    setCookieConsent('granted');
    updateGtag(true);
    hideBanner();
    console.log('[JSM] Consent granted');
  };
  window.rejectConsent = function(){
    setCookieConsent('denied');
    updateGtag(false);
    hideBanner();
    console.log('[JSM] Consent denied');
  };

  // Init on load
  function init(){
    var saved = getSavedConsent();
    var banner = document.getElementById('consent-banner');
    if(saved){
      var ok = saved === 'granted' || saved === 'accepted';
      // Apply saved consent
      if(window.gtag){
        try{
          window.gtag('consent','update',{
            ad_storage: ok ? 'granted' : 'denied',
            ad_user_data: ok ? 'granted' : 'denied',
            ad_personalization: ok ? 'granted' : 'denied',
            analytics_storage: ok ? 'granted' : 'denied'
          });
        }catch(e){}
      }
      hideBanner();
      // If granted, ensure config sent
      if(ok && window.gtag){
        try{ window.gtag('config', MEASUREMENT_ID, { anonymize_ip: true }); }catch(e){}
      }
    }else{
      // No choice yet -> show banner
      if(banner){
        banner.style.display='flex';
      }
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
