/**
 * FinalSnap Assistent „Neue Feier anlegen“ (event-wizard.js)
 * Gestaltet von Claude, 26.11.2026.
 *
 * Reine Oberflächen-Ergänzung zum Formular aus dashboard-create-panel.html.
 * Die Schritt-Logik, Prüfung und das Speichern macht weiterhin account.js.
 * Dieses Skript:
 *  - überträgt den gewählten Anlass in das versteckte Feld #event-occasion
 *    und passt das Beispiel im Namensfeld an
 *  - zeigt nach dem erfolgreichen Anlegen den Moment „Euer Album ist bereit!“
 */
(function () {
  'use strict';

  var EXAMPLES = {
    wedding: 'Zum Beispiel: Hochzeit von Anna & Jonas',
    birthday: 'Zum Beispiel: Lisas 40. Geburtstag',
    summer: 'Zum Beispiel: Sommerfest 2027',
    company: 'Zum Beispiel: Weihnachtsfeier Team Nord',
    jubilee: 'Zum Beispiel: 25 Jahre Bäckerei Schmidt',
    other: 'Zum Beispiel: Unsere Feier'
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

  /* ---------- Anlass ---------- */
  function initOccasion() {
    var form = $('event-form');
    var hidden = $('event-occasion');
    var title = $('title');
    if (!form || !hidden) return;
    form.addEventListener('change', function (e) {
      if (!e.target || e.target.name !== 'occasion') return;
      hidden.value = e.target.value;
      if (title) title.placeholder = EXAMPLES[e.target.value] || EXAMPLES.other;
    });
    // Nach dem Zurücksetzen des Formulars (account.js ruft reset() auf) Beispieltext zurückstellen
    form.addEventListener('reset', function () {
      setTimeout(function () { hidden.value = ''; if (title) title.placeholder = EXAMPLES.wedding; }, 0);
    });
  }

  /* ---------- „Euer Album ist bereit!“ ---------- */
  var overlay = null;
  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function celebrate(titleText) {
    close();
    overlay = el('div', 'fs-page fs-celebrate');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'fs-ready-title');

    if (!reducedMotion()) {
      var layer = el('div', 'fs-confetti');
      layer.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < 36; i++) {
        var piece = document.createElement('i');
        piece.style.left = ((i * 37) % 100) + '%';
        piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        piece.style.animationDelay = ((i * 83) % 900) + 'ms';
        layer.appendChild(piece);
      }
      overlay.appendChild(layer);
    }

    var panel = el('div', 'fs-celebrate__panel');
    var badge = el('div', 'fs-celebrate__photo fs-celebrate__photo--empty');
    badge.insertAdjacentHTML('beforeend', '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>');
    var heading = el('h2', null, 'Euer Album ist bereit!');
    heading.id = 'fs-ready-title';
    heading.tabIndex = -1;
    var text = el('p', null, (titleText ? '„' + titleText + '“ ist angelegt. ' : '') + 'Jetzt noch ein paar kleine Schritte – wir zeigen euch, welche.');
    var actions = el('div', 'fs-actions');
    var go = el('button', 'fs-btn fs-btn--primary fs-btn--xl fs-btn--block', 'Weiter zur Vorbereitung');
    go.type = 'button';
    go.addEventListener('click', function () {
      close();
      var target = document.querySelector('.fs-checklist') || document.querySelector('.event-card:not([hidden])');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    actions.appendChild(go);
    panel.append(badge, heading, text, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    heading.focus({ preventScroll: true });
  }

  /* account.js meldet den Erfolg über #message („Veranstaltung erstellt …“). */
  function watchSuccess() {
    var message = $('message');
    var title = $('title');
    var form = $('event-form');
    if (!message || !window.MutationObserver) return;
    var lastTitle = '';
    if (form) form.addEventListener('submit', function () { lastTitle = title ? title.value.trim() : ''; }, true);
    new MutationObserver(function () {
      if (/^Veranstaltung erstellt/.test(message.textContent || '')) {
        var panel = $('create-event');
        if (panel && panel.tagName === 'DETAILS') panel.open = false;
        // kurz warten, bis account.js die neue Veranstaltung samt Checkliste aufgebaut hat
        setTimeout(function () { celebrate(lastTitle); }, 400);
      }
    }).observe(message, { childList: true, characterData: true, subtree: true });
  }

  function init() { initOccasion(); watchSuccess(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
