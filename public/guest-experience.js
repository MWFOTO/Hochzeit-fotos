/**
 * FinalSnap Gäste-Erlebnis (guest-experience.js)
 * Gestaltet von Claude, 25.11.2026.
 *
 * Reine Oberflächen-Ergänzung für upload.html. Ändert NICHTS an der Upload-Logik:
 * - liest die Event-Infos (/api/event/:id/info) für Titelbild, Anlass und Farbe
 * - verschiebt den Kontingent-Hinweis von guest-access.js an die richtige Stelle
 * - beobachtet #status (von upload.js gesetzt) und zeigt bei Erfolg den Danke-Moment
 *
 * Voraussetzung: guest-access.js (window.fetch mit Gast-Token, window.guestUrl)
 * und upload.js sind vorher geladen.
 */
(function () {
  'use strict';

  var eventId = location.pathname.split('/').filter(Boolean)[1] || '';
  var root = document.documentElement;
  var info = null;

  var OCCASION_EYEBROW = {
    wedding: 'Willkommen zur Hochzeit',
    birthday: 'Willkommen zum Geburtstag',
    summer: 'Willkommen zum Sommerfest',
    company: 'Willkommen zur Feier',
    jubilee: 'Willkommen zum Jubiläum',
    graduation: 'Willkommen zur Abschlussfeier',
    other: 'Willkommen'
  };
  var CONFETTI_COLORS = ['#49d5e8', '#dd75c9', '#ffd43b', '#ff883e', '#f4f5f7'];

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------- Farbe der Feier: lesbare Schriftfarbe auf dem Akzent ---------- */
  function parseHex(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function toHex(rgb) {
    return '#' + rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
  }
  function applyAccent(hex) {
    var rgb = parseHex(hex);
    if (!rgb) return;
    // Die Variablen werden auf <body class="fs-page"> gesetzt, weil dort auch die Standardwerte stehen.
    var target = document.body || root;
    // 1. Schrift auf Akzentflächen: dunkel oder weiß – je nachdem, was besser lesbar ist
    var onAccent = contrast(rgb, [21, 23, 27]) >= contrast(rgb, [255, 255, 255]) ? '#15171b' : '#ffffff';
    target.style.setProperty('--fs-on-accent', onAccent);
    // 2. Akzent als Schriftfarbe auf dunklem Grund: so lange aufhellen, bis er gut lesbar ist (≥ 4.5:1)
    var bg = [28, 30, 35];
    var text = rgb.slice();
    for (var i = 0; i < 20 && contrast(text, bg) < 4.5; i++) {
      text = text.map(function (v) { return v + (255 - v) * 0.15; });
    }
    target.style.setProperty('--fs-accent-text', toHex(text));
  }

  /* ---------- Event-Infos anwenden ---------- */
  function applyInfo(data) {
    info = data;
    var design = data.design || {};
    var title = design.title || data.title;
    if (title) document.title = title + (document.body.classList.contains('fs-gallery-page') ? ' · Fotoalbum' : ' · Fotos teilen');

    var eyebrow = $('fs-eyebrow');
    if (eyebrow) {
      eyebrow.textContent = data.readOnly ? 'Downloadphase' : (OCCASION_EYEBROW[design.occasion] || OCCASION_EYEBROW.other);
    }
    if (design.accent) applyAccent(design.accent);

    var hero = $('fs-hero-img');
    if (hero && design.hasCover && typeof window.guestUrl === 'function') {
      hero.addEventListener('load', function () { hero.hidden = false; }, { once: true });
      hero.addEventListener('error', function () { hero.hidden = true; }, { once: true });
      hero.src = window.guestUrl('/api/event/' + encodeURIComponent(eventId) + '/design-cover');
    }
  }

  function loadInfo() {
    if (!eventId) return;
    window.fetch('/api/event/' + encodeURIComponent(eventId) + '/info')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data) applyInfo(data); })
      .catch(function () { /* Seite funktioniert auch ohne Zusatzinfos */ });
  }

  /* ---------- Kontingent-Hinweis an die richtige Stelle ---------- */
  function watchQuotaNotice() {
    var slot = $('fs-quota-slot');
    var welcome = $('fs-welcome');
    if (!slot || !welcome || !window.MutationObserver) return;
    var move = function () {
      var notice = $('quota-notice');
      if (notice && notice.parentNode !== slot) slot.appendChild(notice);
    };
    new MutationObserver(move).observe(welcome, { childList: true });
    move();
  }

  /* ---------- Danke-Moment ---------- */
  var overlay = null;
  var lastFocus = null;

  function confetti(container) {
    if (reducedMotion()) return;
    var layer = el('div', 'fs-confetti');
    layer.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 36; i++) {
      var piece = document.createElement('i');
      piece.style.left = ((i * 37) % 100) + '%';
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDelay = ((i * 83) % 900) + 'ms';
      piece.style.transform = 'rotate(' + ((i * 47) % 360) + 'deg)';
      layer.appendChild(piece);
    }
    container.appendChild(layer);
  }

  function closeCelebration() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }
  function onKey(event) {
    if (event.key === 'Escape') closeCelebration();
  }

  function celebrate(count) {
    closeCelebration();
    lastFocus = document.activeElement;

    overlay = el('div', 'fs-celebrate');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'fs-celebrate-title');
    confetti(overlay);

    var panel = el('div', 'fs-celebrate__panel');

    // Vorschau: das zuletzt hochgeladene Foto (upload.js legt es vorne in #thumbs ab)
    var latest = document.querySelector('#thumbs img');
    var photo = el('div', 'fs-celebrate__photo' + (latest ? '' : ' fs-celebrate__photo--empty'));
    if (latest) {
      var img = document.createElement('img');
      img.src = latest.src;
      img.alt = 'Dein geteiltes Foto';
      photo.appendChild(img);
    } else {
      photo.insertAdjacentHTML('beforeend', '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>');
    }
    panel.appendChild(photo);

    var heading = el('h2', null, 'Danke!');
    heading.id = 'fs-celebrate-title';
    heading.tabIndex = -1;
    panel.appendChild(heading);

    var plural = count === 1 ? 'Dein Foto ist' : 'Deine ' + count + ' Fotos sind';
    var message = info && info.moderation
      ? plural + ' im Album und ' + (count === 1 ? 'erscheint' : 'erscheinen') + ' für alle, sobald es freigegeben wurde.'
      : plural + ' jetzt im Album.';
    panel.appendChild(el('p', null, message));

    var actions = el('div', 'fs-actions');
    var again = el('button', 'fs-btn fs-btn--primary fs-btn--xl fs-btn--block', 'Noch ein Foto teilen');
    again.type = 'button';
    again.addEventListener('click', function () {
      closeCelebration();
      var trigger = $('upload-trigger');
      if (trigger && !trigger.hidden) trigger.click();
    });
    actions.appendChild(again);

    var galleryLink = $('gallery-link');
    var album = el('a', 'fs-btn fs-btn--secondary fs-btn--block', 'Album ansehen');
    album.href = galleryLink && galleryLink.href ? galleryLink.href : '#';
    actions.appendChild(album);

    var close = el('button', 'fs-btn fs-btn--ghost', 'Schließen');
    close.type = 'button';
    close.addEventListener('click', closeCelebration);
    actions.appendChild(close);

    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    heading.focus({ preventScroll: true });
  }

  function watchStatus() {
    var status = $('status');
    if (!status || !window.MutationObserver) return;
    var lastSignature = '';
    new MutationObserver(function () {
      var isSuccess = /(^|\s)success(\s|$)/.test(status.className);
      var text = status.textContent || '';
      var signature = status.className + '|' + text;
      if (!isSuccess) { lastSignature = signature; return; }
      if (signature === lastSignature) return;
      lastSignature = signature;
      var match = /(\d+)/.exec(text);
      // Kurz warten, damit upload.js die Vorschau in #thumbs eingefügt hat
      setTimeout(function () { celebrate(match ? Math.max(1, parseInt(match[1], 10)) : 1); }, 150);
    }).observe(status, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
  }

  function init() {
    loadInfo();
    watchQuotaNotice();
    watchStatus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
