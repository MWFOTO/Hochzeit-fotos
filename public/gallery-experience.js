/**
 * FinalSnap Galerie – Ergänzungen (gallery-experience.js)
 * Gestaltet von Claude, 26.11.2026.
 *
 * Ergänzt gallery.html, ohne gallery-init.js zu ändern:
 *  - Blättern in der Großansicht (Buttons, Pfeiltasten, Wischen) + Zähler „3 / 24“
 *  - „Fotos teilen“-Button, der auf dem Handy unten immer erreichbar ist
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  var lightbox = $('lightbox');
  var image = $('lightbox-img');
  var grid = $('grid');
  if (!lightbox || !image || !grid) return;

  function photos() { return Array.prototype.slice.call(grid.querySelectorAll('img')); }
  function currentIndex() {
    var list = photos();
    for (var i = 0; i < list.length; i++) if (list[i].src === image.src) return i;
    return -1;
  }

  /* ---------- Blättern ---------- */
  function navButton(label, cls, svgPath) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fs-lightbox__nav ' + cls;
    b.setAttribute('aria-label', label);
    b.insertAdjacentHTML('beforeend', '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + svgPath + '"></path></svg>');
    return b;
  }
  var prev = navButton('Vorheriges Foto', 'fs-lightbox__nav--prev', 'M15 18l-6-6 6-6');
  var next = navButton('Nächstes Foto', 'fs-lightbox__nav--next', 'M9 18l6-6-6-6');
  var counter = document.createElement('span');
  counter.className = 'fs-lightbox__count';
  counter.setAttribute('aria-live', 'polite');
  lightbox.append(prev, next, counter);

  function go(step) {
    var list = photos();
    var i = currentIndex();
    if (i < 0 || !list.length) return;
    var target = list[(i + step + list.length) % list.length];
    target.click(); // gallery-init.js öffnet das Foto (setzt Bild und Download-Link)
  }
  function update() {
    var list = photos();
    var i = currentIndex();
    var many = list.length > 1;
    prev.hidden = next.hidden = !many;
    counter.textContent = i >= 0 && many ? (i + 1) + ' / ' + list.length : '';
  }
  prev.addEventListener('click', function (e) { e.stopPropagation(); go(-1); });
  next.addEventListener('click', function (e) { e.stopPropagation(); go(1); });

  document.addEventListener('keydown', function (e) {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });

  var startX = null;
  lightbox.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', function (e) {
    if (startX === null) return;
    var dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });

  // Fokus in die Großansicht und Zähler aktuell halten
  var wasOpen = false;
  var lastFocus = null;
  new MutationObserver(function () {
    var open = lightbox.classList.contains('open');
    update();
    if (open && !wasOpen) {
      lastFocus = document.activeElement;
      var close = $('lightbox-close');
      if (close) close.focus({ preventScroll: true });
      document.body.style.overflow = 'hidden';
    }
    if (!open && wasOpen) {
      document.body.style.overflow = '';
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    }
    wasOpen = open;
  }).observe(lightbox, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(update).observe(image, { attributes: true, attributeFilter: ['src'] });

  /* ---------- „Fotos teilen“ unten auf dem Handy ---------- */
  var upload = $('upload-link');
  var fab = $('fs-share-fab');
  if (upload && fab) {
    var sync = function () {
      fab.href = upload.href || '#';
      fab.hidden = upload.hidden || !upload.href;
    };
    sync();
    new MutationObserver(sync).observe(upload, { attributes: true, attributeFilter: ['href', 'hidden'] });
  }
})();
