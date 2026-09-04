
(function(){
  const KEY='ss_consent_v1';
  function show(){ const el=document.getElementById('consent-banner'); if(!el) return; if(localStorage.getItem(KEY)) {el.style.display='none'; return;} el.style.display='flex'; }
  function accept(){ localStorage.setItem(KEY,'1'); const el=document.getElementById('consent-banner'); if(el) el.style.display='none'; }
  window.acceptConsent=accept;
  document.addEventListener('DOMContentLoaded', show);
})();
