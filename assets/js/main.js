const K='jsm_consent_v1';const S='jsm-session-v2';
function showConsent(){const el=document.getElementById('consent-banner');if(!el)return;if(localStorage.getItem(K)){el.style.display='none';if(window.gtag){gtag('consent','update',{'analytics_storage':'granted'});}return;}el.style.display='flex';if(window.gtag){gtag('consent','default',{'analytics_storage':'denied'});}}
function acceptConsent(){localStorage.setItem(K,'1');const el=document.getElementById('consent-banner');if(el)el.style.display='none';if(window.gtag){gtag('consent','update',{'analytics_storage':'granted'});} }
window.acceptConsent=acceptConsent;
function saveSession(d){try{sessionStorage.setItem(S,JSON.stringify(d));}catch(e){}}
function loadSession(){try{return JSON.parse(sessionStorage.getItem(S)||'null');}catch(e){return null;}}
document.addEventListener('DOMContentLoaded',()=>{showConsent();});
