/**
 * FinalSnap Startseite – Ergänzungen (landing-enhance.js)
 * Gestaltet von Claude, 26.11.2026.
 *
 * Arbeitet mit der bestehenden landing.html und lässt landing.js unberührt:
 *  1. Schmaler Header auf dem Handy mit Menü-Button (statt 6 großer Buttons)
 *  2. Angemeldete Kunden sehen „Meine Feiern“ statt „Anmelden“ / „Kostenlos testen“
 *  3. Mitmach-Demo: „Foto hinzufügen“ im Handy-Bild ist anklickbar
 * Ohne JavaScript bleibt die Seite wie bisher (alles ist nur eine Ergänzung).
 */
(function () {
  'use strict';

  var body = document.body;
  var DEMO_IMAGES = [
    { src: '/preview-assets/fotos-sammeln.webp', alt: 'Gäste sammeln gemeinsam Fotos' },
    { src: '/preview-assets/qr-einladung.webp', alt: 'Ein Gast scannt den QR-Code auf einer Einladung' },
    { src: '/preview-assets/live-diashow.webp', alt: 'Freigegebene Fotos laufen als Diashow' },
    { src: '/preview-assets/hochzeit-party.webp', alt: 'Hochzeitsgäste halten einen Moment fest' },
    { src: '/preview-assets/party.webp', alt: 'Freunde fotografieren gemeinsam auf einer Party' }
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ---------- 1. Header & Menü ---------- */
  function initHeader() {
    var header = document.querySelector('.site-header');
    var nav = header && header.querySelector('.landing-nav');
    if (!header || !nav) return;
    if (!nav.id) nav.id = 'fs-main-nav';

    var tools = el('div', 'fs-lp-tools');
    var cta = el('a', 'fs-lp-cta', 'Kostenlos testen');
    cta.href = '/register';
    var toggle = el('button', 'fs-lp-menu');
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', nav.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Menü öffnen');
    toggle.insertAdjacentHTML('beforeend', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path class="fs-lp-menu__a" d="M4 7h16"></path><path class="fs-lp-menu__b" d="M4 12h16"></path><path class="fs-lp-menu__c" d="M4 17h16"></path></svg>');
    tools.append(cta, toggle);
    header.insertBefore(tools, nav);

    var setOpen = function (open) {
      body.classList.toggle('fs-lp-menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
    };
    toggle.addEventListener('click', function () { setOpen(!body.classList.contains('fs-lp-menu-open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && body.classList.contains('fs-lp-menu-open')) { setOpen(false); toggle.focus(); }
    });
    window.addEventListener('resize', function () { if (window.innerWidth > 760) setOpen(false); });
  }

  /* ---------- 2. Angemeldet? ---------- */
  function initAccount() {
    if (!window.fetch) return;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (me) {
        if (!me || !me.user) return;
        var name = me.user.displayName ? ', ' + me.user.displayName : '';
        document.querySelectorAll('a[href="/login"]').forEach(function (a) { a.textContent = 'Meine Feiern'; a.href = '/dashboard'; });
        document.querySelectorAll('a[href="/register"], a[href^="/register?"]').forEach(function (a) {
          if (a.classList.contains('fs-lp-cta')) { a.textContent = 'Meine Feiern'; a.href = '/dashboard'; return; }
          a.href = '/dashboard';
          if (a.closest('.hero')) { a.textContent = 'Zu meinen Feiern'; a.append(el('span', null, ' →')); }
        });
        var heroCopy = document.querySelector('.hero-copy .actions');
        if (heroCopy) {
          var hello = el('p', 'fs-lp-hello', 'Schön, dass du wieder da bist' + name + '!');
          heroCopy.before(hello);
        }
      })
      .catch(function () { /* nicht angemeldet oder offline: Seite bleibt wie sie ist */ });
  }

  /* ---------- 3. Mitmach-Demo ---------- */
  function initDemo() {
    var phone = document.querySelector('.hero .phone');
    var grid = phone && phone.querySelector('.phone-photo-grid');
    var addBox = phone && phone.querySelector('.phone-upload');
    if (!grid || !addBox) return;

    // „Foto hinzufügen“ wird ein echter Button
    var add = el('button', addBox.className + ' fs-lp-add');
    add.type = 'button';
    add.setAttribute('aria-label', 'Beispiel: ein Foto zur Galerie hinzufügen');
    while (addBox.firstChild) add.appendChild(addBox.firstChild);
    addBox.replaceWith(add);

    var dateLine = phone.querySelector('.phone-date');
    var chip = phone.querySelector('.upload-chip');
    if (chip) {
      chip.classList.add('fs-lp-chip');
      chip.replaceChildren(el('span', 'fs-lp-chip__dot'), (function () {
        var t = el('span');
        t.append(document.createTextNode('Probier’s aus!'), document.createElement('br'), el('b', null, 'Tippe auf „Foto hinzufügen“'));
        return t;
      })());
    }

    var live = el('p', 'fs-sr-only');
    live.setAttribute('aria-live', 'polite');
    phone.appendChild(live);

    var total = grid.querySelectorAll('.phone-photo').length;
    var added = 0;
    var ctaShown = false;

    add.addEventListener('click', function () {
      var pick = DEMO_IMAGES[added % DEMO_IMAGES.length];
      added++; total++;

      var tile = el('div', 'phone-photo fs-lp-new');
      var img = document.createElement('img');
      img.src = pick.src; img.alt = pick.alt;
      tile.append(img, el('span', 'fs-lp-badge', 'Neu'), el('small', 'ai-image-tag', 'KI-Bild'));
      grid.prepend(tile);
      // Galerie bleibt gleich groß: ältestes Bild fällt heraus
      var tiles = grid.querySelectorAll('.phone-photo');
      if (tiles.length > 4) tiles[tiles.length - 1].remove();
      grid.querySelectorAll('.fs-lp-badge').forEach(function (b, i) { if (i > 0) b.remove(); });

      if (dateLine) dateLine.textContent = total + ' Fotos · gemeinsam gesammelt';
      live.textContent = 'Foto hinzugefügt. ' + total + ' Fotos in der Beispielgalerie.';
      if (chip) chip.classList.add('fs-lp-chip--done');

      if (added >= 2 && !ctaShown) {
        ctaShown = true;
        var box = el('div', 'fs-lp-demo-cta');
        box.setAttribute('role', 'status');
        var p = el('p');
        p.append(el('strong', null, 'So einfach geht’s auf eurer Feier. '), document.createTextNode('Jeder Gast tippt einmal – und alle Fotos landen in eurem Album.'));
        var go = el('a', 'button primary', 'Eigenes Album anlegen →');
        var hero = document.querySelector('.hero-copy a.button.primary');
        go.href = hero ? hero.getAttribute('href') : '/register';
        box.append(p, go);
        phone.after(box);
      }
    });
  }

  function init() {
    body.classList.add('fs-lp-ready');
    initHeader();
    initDemo();
    initAccount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
