// Empfehlungs-Code aus Partner-Links (?ref=CODE) für die spätere Albumanlage merken.
(() => { const ref = new URLSearchParams(location.search).get('ref'); if (ref && /^[A-Za-z0-9-]{4,20}$/.test(ref)) try { localStorage.setItem('finalsnap_ref', ref.toUpperCase()); } catch {} })();
fetch('/api/plans').then(response => response.json()).then(plans => {
      for (const [key, plan] of Object.entries(plans)) {
        if (plan.legacy) continue;
        const card = document.createElement('article');
        card.className = 'plan-card';
        const title = document.createElement('h3');
        title.textContent = plan.label;
        const price = document.createElement('p');
        price.className = 'plan-price';
        price.textContent = new Intl.NumberFormat('de-DE', {style:'currency', currency:'EUR'}).format(plan.priceCents / 100);
        const tax = document.createElement('p');
        tax.className = 'plan-tax';
        tax.textContent = 'inkl. 19 % USt. · Endpreis für Privat- und Geschäftskunden';
        const billing = document.createElement('p');
        billing.className = 'plan-billing';
        billing.textContent = 'einmalig pro Veranstaltung';
        const details = document.createElement('p');
        details.className = 'plan-details';
        details.textContent = `Keine feste Fotoanzahl · bis zu ${plan.storageLimitGB.toLocaleString('de-DE', {maximumFractionDigits:1})} GB Fotospeicher`;
        const features = document.createElement('ul');
        features.className = 'plan-features';
        for (const feature of ['QR-Code, Gästebuch und 12 Fotoaufgaben', 'Persönliche Gästegalerien und Veranstalterübersicht', 'Live-Diashow und Downloads']) {
          const item = document.createElement('li');
          item.textContent = feature;
          features.append(item);
        }
        const period = document.createElement('p');
        period.className = 'plan-period';
        period.textContent = '90 Tage ab Veranstaltungsdatum · danach automatische Löschung';
        const choose = document.createElement('a');
        choose.className = 'button primary';
        choose.href = '/register?plan=' + encodeURIComponent(key);
        choose.textContent = 'Event anlegen';
        card.append(title, price, tax, billing, details, features, period, choose);
        document.getElementById('plan-grid').append(card);
      }
    }).catch(() => {});

const consentCookieName = 'finalsnap_cookie_consent';
const consentBanner = document.getElementById('cookie-consent-banner');
const consentContext = document.getElementById('cookie-consent-context');
const trustpilotWidget = document.querySelector('.trustpilot-widget');
const trustpilotConsentHint = document.getElementById('trustpilot-consent-hint');

function readConsent() {
  const escapedName = consentCookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return document.cookie.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`))?.[1] || '';
}

function showConsentBanner(message = '') {
  if (!consentBanner) return;
  consentBanner.hidden = false;
  if (consentContext) {
    consentContext.textContent = message;
    consentContext.hidden = !message;
  }
}

function loadTrustpilot() {
  if (!trustpilotWidget || trustpilotWidget.dataset.loaded === 'true') return;
  trustpilotWidget.dataset.loaded = 'true';
  if (trustpilotConsentHint) trustpilotConsentHint.hidden = true;
  const script = document.createElement('script');
  script.src = 'https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js';
  script.async = true;
  script.onload = () => window.Trustpilot?.loadFromElement?.(trustpilotWidget, true);
  document.head.append(script);
}

function saveConsent(value) {
  const previousConsent = readConsent();
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${consentCookieName}=${value}; Max-Age=15552000; Path=/; SameSite=Lax${secure}`;
  if (value === 'necessary' && previousConsent === 'all') {
    location.reload();
    return;
  }
  if (consentBanner) consentBanner.hidden = true;
  if (consentContext) {
    consentContext.textContent = '';
    consentContext.hidden = true;
  }
  if (value === 'all') loadTrustpilot();
  else if (trustpilotConsentHint) trustpilotConsentHint.hidden = false;
}

consentBanner?.querySelectorAll('[data-cookie-choice]').forEach(button => {
  button.addEventListener('click', () => saveConsent(button.dataset.cookieChoice));
});

const savedConsent = readConsent();
if (savedConsent === 'all') loadTrustpilot();
else if (trustpilotConsentHint) trustpilotConsentHint.hidden = false;
const openCookieSettings = new URLSearchParams(location.search).get('cookies') === '1';
if (!savedConsent || openCookieSettings) showConsentBanner();
if (openCookieSettings) history.replaceState(null, '', `${location.pathname}${location.hash}`);

const landingNav = document.getElementById('landing-nav');
const landingMenuToggle = document.getElementById('landing-menu-toggle');
const navBreakpoint = window.matchMedia('(max-width: 760px)');
function setLandingMenuMode() {
  if (!landingNav || !landingMenuToggle) return;
  landingNav.hidden = navBreakpoint.matches;
  landingMenuToggle.hidden = !navBreakpoint.matches;
  landingMenuToggle.setAttribute('aria-expanded', 'false');
}
setLandingMenuMode();
navBreakpoint.addEventListener?.('change', setLandingMenuMode);
landingMenuToggle?.addEventListener('click', () => {
  const open = landingMenuToggle.getAttribute('aria-expanded') !== 'true';
  landingNav.hidden = !open;
  landingMenuToggle.setAttribute('aria-expanded', String(open));
  landingMenuToggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
});
landingNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  if (navBreakpoint.matches) { landingNav.hidden = true; landingMenuToggle?.setAttribute('aria-expanded', 'false'); }
}));

fetch('/api/auth/me').then(response => response.ok ? response.json() : null).then(account => {
  if (!account?.user) return;
  const destinations = [
    [document.getElementById('landing-header-cta'), 'Zu meinen Veranstaltungen'],
    [document.getElementById('landing-nav-login'), 'Meine Veranstaltungen'],
    [document.getElementById('landing-hero-cta'), 'Zu meinen Veranstaltungen'],
  ];
  for (const [link, label] of destinations) if (link) { link.href = '/dashboard'; link.textContent = label; }
}).catch(() => {});

const demoGrid = document.querySelector('.phone-photo-grid');
const demoCount = document.getElementById('demo-photo-count');
const demoAdd = document.getElementById('demo-add-photo');
const demoSlideshow = document.getElementById('demo-slideshow');
const demoNext = document.getElementById('hero-demo-next');
let demoSlideTimer = null;
demoAdd?.addEventListener('click', () => {
  if (!demoGrid || demoGrid.children.length >= 8) return;
  const source = demoGrid.children[(demoGrid.children.length - 4) % 4] || demoGrid.firstElementChild;
  const copy = source.cloneNode(true);
  copy.classList.add('demo-photo-added');
  const caption = copy.querySelector('span');
  if (caption) caption.textContent = 'Neu hinzugefügt';
  demoGrid.append(copy);
  demoGrid.classList.add('demo-expanded');
  demoCount.textContent = `${demoGrid.children.length} Fotos im Album`;
  demoNext.hidden = false;
});
demoSlideshow?.addEventListener('click', () => {
  if (demoSlideTimer) {
    clearInterval(demoSlideTimer); demoSlideTimer = null;
    demoGrid?.classList.remove('is-slideshow');
    demoGrid?.querySelectorAll('.demo-slide-active').forEach(photo => photo.classList.remove('demo-slide-active'));
    demoSlideshow.textContent = '▶ Diashow starten';
    return;
  }
  let index = 0;
  demoGrid?.classList.add('is-slideshow');
  const show = () => {
    const photos = [...(demoGrid?.children || [])];
    photos.forEach(photo => photo.classList.toggle('demo-slide-active', photos.indexOf(photo) === index));
    index = (index + 1) % Math.max(photos.length, 1);
  };
  show(); demoSlideTimer = setInterval(show, 1200);
  demoSlideshow.textContent = '■ Diashow beenden';
});

document.querySelectorAll('.why-video-frame[data-youtube-id]').forEach(frame => {
  const button = frame.querySelector('.why-video-launch');
  button?.addEventListener('click', () => {
    if (readConsent() !== 'all') {
      showConsentBanner('Zum Abspielen des Erklärvideos musst du externe Medien erlauben. Du kannst auch ohne Video weiternutzen.');
      return;
    }
    const player = document.createElement('iframe');
    player.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(frame.dataset.youtubeId)}?autoplay=1&rel=0`;
    player.title = 'FinalSnap: Warum FinalSnap?';
    player.loading = 'lazy';
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    player.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    player.allowFullscreen = true;
    frame.replaceChildren(player);
    frame.classList.add('is-playing');
  }, { once: true });
});

const supportingVideos = document.querySelectorAll('.mascot-motion-video');
const activateVideo = video => {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.play().catch(() => {
    const playButton = video.closest('.mascot-motion-stage')?.querySelector('.mascot-motion-play');
    if (playButton) playButton.hidden = false;
  });
};

supportingVideos.forEach(video => {
  const playButton = video.closest('.mascot-motion-stage')?.querySelector('.mascot-motion-play');
  video.addEventListener('playing', () => { if (playButton) playButton.hidden = true; });
  video.addEventListener('error', () => { if (playButton) playButton.hidden = false; });
  playButton?.addEventListener('click', () => activateVideo(video));
});

if ('IntersectionObserver' in window) {
  const motionObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) activateVideo(entry.target);
    else entry.target.pause();
  }), { rootMargin: '80px' });
  supportingVideos.forEach(video => motionObserver.observe(video));
} else {
  supportingVideos.forEach(activateVideo);
}
