function loadGA4() {
  if (window.gaLoaded) return;
  window.gaLoaded = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-64EC8JJF7Q';
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', 'G-64EC8JJF7Q');
}

function acceptConsent() {
  localStorage.setItem('jsm_consent_v1', 'accepted');
  const banner = document.getElementById('consent-banner');
  if (banner) banner.style.display = 'none';
  loadGA4();
}

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('jsm_consent_v1') === 'accepted') {
    loadGA4();
  } else {
    const banner = document.getElementById('consent-banner');
    if (banner) banner.style.display = 'flex';
  }
});