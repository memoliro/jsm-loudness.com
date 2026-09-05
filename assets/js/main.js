
(function(){
  const CONSENT_KEY = 'jsm_consent_v1';
  const BANNER = document.getElementById('consent-banner');
  
  function getConsent(){ try { return localStorage.getItem(CONSENT_KEY); } catch(e){ return null; } }
  
  function setConsent(value){
    try {
      localStorage.setItem(CONSENT_KEY, value);
      document.cookie = CONSENT_KEY + '=' + value + '; path=/; max-age=' + (6*30*24*3600) + '; SameSite=Lax';
    } catch(e){}
  }
  
  function showBanner(){ if(BANNER) BANNER.style.display='flex'; }
  function hideBanner(){ if(BANNER) BANNER.style.display='none'; }
  
  window.acceptConsent = function(){
    setConsent('granted');
    gtag('consent','update',{
      analytics_storage:'granted',
      ad_storage:'denied',
      ad_user_data:'denied',
      ad_personalization:'denied'
    });
    gtag('config','G-64EC8JJF7Q',{anonymize_ip:true});
    gtag('event','page_view');
    hideBanner();
  };
  
  window.rejectConsent = function(){
    setConsent('denied');
    gtag('consent','update',{
      analytics_storage:'denied',
      ad_storage:'denied',
      ad_user_data:'denied',
      ad_personalization:'denied'
    });
    // No GA page_view sent
    hideBanner();
  };
  
  // Init
  var c = getConsent();
  if(!c){
    // No choice yet -> show banner after 400ms, keep analytics denied (default already set in head)
    setTimeout(showBanner, 400);
  } else if(c==='granted'){
    gtag('consent','update',{analytics_storage:'granted'});
    gtag('config','G-64EC8JJF7Q',{anonymize_ip:true});
    gtag('event','page_view');
  } else {
    // denied -> keep denied, no page_view
  }
})();
