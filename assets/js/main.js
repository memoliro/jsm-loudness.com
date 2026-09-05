// assets/js/main.js - FIXED for jsm-loudness.com
// Fixes consent persistence - saves to localStorage + cookie for 180 days
(function(){
  const KEY = 'jsm_consent_v1';
  const BANNER_ID = 'consent-banner';

  function getConsent(){
    try{
      const ls = localStorage.getItem(KEY);
      if(ls) return ls;
      const m = document.cookie.match(new RegExp('(?:^|;\\s*)'+KEY+'=([^;]+)'));
      return m ? decodeURIComponent(m[1]) : null;
    }catch{ return null; }
  }

  function setConsent(value){
    try{ localStorage.setItem(KEY, value); }catch{}
    try{
      document.cookie = `${KEY}=${encodeURIComponent(value)}; max-age=${60*60*24*180}; path=/; SameSite=Lax`;
    }catch{}
  }

  function updateGtag(isGranted){
    try{
      if(!window.gtag) return;
      window.gtag('consent','update',{
        ad_storage: isGranted ? 'granted' : 'denied',
        analytics_storage: isGranted ? 'granted' : 'denied',
        ad_user_data: isGranted ? 'granted' : 'denied',
        ad_personalization: isGranted ? 'granted' : 'denied'
      });
      if(isGranted){
        window.gtag('event','page_view');
      }
    }catch{}
  }

  function hideBanner(){
    const b = document.getElementById(BANNER_ID);
    if(b) b.style.display = 'none';
  }
  function showBanner(){
    const b = document.getElementById(BANNER_ID);
    if(b) b.style.display = 'flex';
  }

  window.acceptConsent = function(){
    setConsent('accepted');
    updateGtag(true);
    hideBanner();
  };
  window.rejectConsent = function(){
    setConsent('rejected');
    updateGtag(false);
    hideBanner();
  };

  document.addEventListener('DOMContentLoaded', function(){
    const saved = getConsent();
    if(!saved){
      showBanner();
      return;
    }
    const isGranted = saved === 'accepted' || saved === 'granted';
    hideBanner();
    updateGtag(isGranted);
  });
})();
