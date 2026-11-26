/**
 * FinalSnap Veranstalter-Führung (event-journey.js)
 * Gestaltet von Claude, 26.11.2026.
 *
 * Ergänzt die geöffnete Veranstaltung im Dashboard um:
 *  1. Countdown + Checkliste „Bereit für eure Feier“ (im Bereich „Übersicht“)
 *  2. Sichtbaren QR-Code mit Downloads und Gäste-Vorschau (im Bereich „Gästezugang & QR“)
 *
 * Keine eigene Datenabfrage, keine Änderung an der Logik von account.js.
 * account.js meldet jede fertig gebaute Veranstaltungskarte mit:
 *
 *   document.dispatchEvent(new CustomEvent('finalsnap:event-rendered', {
 *     detail: { event, card, summarySection, accessSection, active: activeEvent === event.id }
 *   }));
 */
(function () {
  'use strict';

  var DAY = 86400000;
  var OCCASION_LABEL = {
    wedding: 'bis zu eurer Hochzeit',
    birthday: 'bis zum Geburtstag',
    summer: 'bis zum Sommerfest',
    company: 'bis zu eurer Feier',
    jubilee: 'bis zum Jubiläum',
    graduation: 'bis zur Abschlussfeier',
    other: 'bis zu eurer Feier'
  };

  /* ---------- kleine Helfer ---------- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function txt(tag, text) { return el(tag, null, text); }
  // Nur für feste, eigene Icon-Grafiken (nie für Daten)
  function icon(paths, size) {
    var span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.style.display = 'inline-flex';
    span.insertAdjacentHTML('beforeend',
      '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>');
    return span;
  }
  var ICON = {
    check: '<path d="M20 6 9 17l-5-5"></path>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>',
    clock: '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"></rect><path d="M12 18h.01"></path>',
    sparkle: '<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"></path><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"></path>'
  };
  function btn(label, variant, onClick) {
    var b = el('button', 'fs-btn ' + (variant || 'fs-btn--secondary'), label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function linkBtn(label, href, variant, opts) {
    var a = el('a', 'fs-btn ' + (variant || 'fs-btn--secondary'), label);
    a.href = href;
    if (opts && opts.newTab) { a.target = '_blank'; a.rel = 'noopener'; }
    if (opts && opts.download) a.setAttribute('download', '');
    if (opts && opts.onClick) a.addEventListener('click', opts.onClick);
    return a;
  }
  function readDesign(event) {
    try { return JSON.parse(event.design_json || '{}') || {}; } catch (e) { return {}; }
  }
  function sharedKey(id) { return 'fs-qr-shared:' + id; }
  function isShared(id) { try { return localStorage.getItem(sharedKey(id)) === '1'; } catch (e) { return false; } }
  function markShared(id) { try { localStorage.setItem(sharedKey(id), '1'); } catch (e) { /* privater Modus */ } }
  function formatDate(ms, withWeekday) {
    return new Date(ms).toLocaleDateString('de-DE', withWeekday
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function openTab(card, index) {
    var tabs = card.querySelectorAll('.event-tabs button');
    if (tabs[index]) tabs[index].click();
  }

  /* ---------- 1. Countdown ---------- */
  function countdown(event, design) {
    var box = el('div', 'fs-countdown');
    var days = el('div', 'fs-countdown__days');
    var text = el('div', 'fs-countdown__text');
    var now = Date.now();
    var start = Number(event.startsAt) || 0;
    var label = OCCASION_LABEL[design.occasion] || OCCASION_LABEL.other;

    if (event.readOnly) {
      days.append(icon(ICON.clock, 30));
      text.append(txt('strong', 'Downloadphase'), txt('span', 'Fotos noch bis ' + formatDate(event.retentionUntil) + ' herunterladen'));
    } else if (start && start - now > DAY) {
      var n = Math.ceil((start - now) / DAY);
      days.append(txt('strong', String(n)), txt('span', n === 1 ? 'Tag' : 'Tage'));
      text.append(txt('strong', label), txt('span', formatDate(start, true)));
    } else if (start && start > now) {
      days.append(txt('strong', '1'), txt('span', 'Tag'));
      text.append(txt('strong', 'Morgen ist es so weit!'), txt('span', 'Teilt den QR-Code mit euren Gästen.'));
    } else {
      var photos = Number(event.photoCount) || 0;
      days.append(txt('strong', String(photos)), txt('span', photos === 1 ? 'Foto' : 'Fotos'));
      text.append(txt('strong', 'Eure Feier läuft!'), txt('span', 'Online bis ' + formatDate(event.expires_at || event.retentionUntil)));
    }
    box.append(days, text);
    return box;
  }

  /* ---------- 2. Checkliste ---------- */
  function checklist(event, card, design, rerender) {
    var id = event.id;
    var booked = event.status === 'paid' || event.status === 'pilot';
    var steps = [
      { title: 'Feier angelegt', hint: 'Name und Datum sind gespeichert.', done: true },
      { title: 'Album gestalten', hint: 'Farbe, Schrift und Titelbild für eure Gäste wählen.', done: Object.keys(design).filter(function (k) { return k !== 'occasion'; }).length > 0,
        action: function () { return linkBtn('Design öffnen', '/event/' + encodeURIComponent(id) + '/design', 'fs-btn--primary fs-btn--small'); } },
      { title: 'Selbst ausprobieren', hint: 'Ladet ein Testfoto hoch – so seht ihr genau, was eure Gäste erleben.', done: (Number(event.photoCount) || 0) > 0,
        action: function () { return event.guestUrl ? linkBtn('Als Gast testen', event.guestUrl, 'fs-btn--primary fs-btn--small', { newTab: true }) : null; } },
      { title: 'QR-Code teilen', hint: 'Als Tischkarte drucken oder den Link in die Einladung kopieren.', done: isShared(id),
        action: function () { return btn('QR-Code ansehen', 'fs-btn--primary fs-btn--small', function () { openTab(card, 2); }); },
        extra: function () { return btn('Schon erledigt', 'fs-btn--ghost fs-btn--small', function () { markShared(id); rerender(); }); } },
      { title: 'Paket buchen', hint: 'Startet am Tag eurer Feier · einmalig pro Veranstaltung.', done: booked,
        action: function () {
          var panel = card.querySelector('.booking-panel');
          return panel ? btn('Paket ansehen', 'fs-btn--primary fs-btn--small', function () {
            if (panel.tagName === 'DETAILS') panel.open = true;
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }) : null;
        } }
    ];
    if (event.readOnly) steps = steps.slice(0, 3);

    var doneCount = steps.filter(function (s) { return s.done; }).length;
    var nextIndex = steps.findIndex(function (s) { return !s.done; });

    var wrap = el('div', 'fs-card fs-checklist');
    var head = el('div', 'fs-checklist__head');
    head.append(txt('h3', doneCount === steps.length ? 'Alles bereit für eure Feier!' : 'Bereit für eure Feier'),
      el('span', 'fs-checklist__count', doneCount + ' von ' + steps.length + ' erledigt'));
    var meter = el('div', 'fs-meter');
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-label', 'Vorbereitung');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(steps.length));
    meter.setAttribute('aria-valuenow', String(doneCount));
    var fill = el('span');
    fill.style.width = Math.round(doneCount / steps.length * 100) + '%';
    meter.append(fill);

    var list = el('ol', 'fs-steps');
    steps.forEach(function (step, i) {
      var li = el('li', 'fs-step' + (step.done ? ' fs-step--done' : '') + (i === nextIndex ? ' fs-step--next' : ''));
      var mark = el('span', 'fs-step__mark');
      if (step.done) mark.append(icon(ICON.check, 16));
      var body = el('div', 'fs-step__body');
      var title = el('span', 'fs-step__title', step.title);
      if (step.done) title.append(el('span', 'fs-sr-only', ' (erledigt)'));
      body.append(title, el('span', 'fs-step__hint', step.hint));
      if (!step.done && step.action) {
        var row = el('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center';
        var main = step.action();
        if (main) row.append(main);
        if (step.extra) row.append(step.extra());
        if (row.childNodes.length) body.append(row);
      }
      li.append(mark, body);
      list.append(li);
    });
    wrap.append(head, meter, list);
    return wrap;
  }

  /* ---------- 3. Freigabe & Laufzeit in Worten ---------- */
  function facts(event, card) {
    var box = el('div', 'fs-card fs-facts');
    var f1 = el('div', 'fs-fact');
    var t1 = el('span');
    t1.append(txt('strong', 'Freigabe: '), document.createTextNode(event.moderation
      ? 'Ihr prüft jedes Foto, bevor es im Album erscheint · '
      : 'Neue Fotos erscheinen sofort im Album · '));
    var change = el('a', null, 'ändern');
    change.href = '#';
    change.addEventListener('click', function (e) { e.preventDefault(); openTab(card, 3); });
    t1.append(change);
    f1.append(icon(ICON.shield), t1);

    var f2 = el('div', 'fs-fact');
    var t2 = el('span');
    var until = event.expires_at || event.retentionUntil;
    t2.append(txt('strong', 'Online: '), document.createTextNode(until ? 'bis ' + formatDate(until) + ' – danach wird das Album automatisch gelöscht' : '90 Tage ab dem Tag eurer Feier'));
    f2.append(icon(ICON.clock), t2);
    box.append(f1, f2);
    return box;
  }

  /* ---------- 4. QR-Bereich ---------- */
  function qrPanel(event, rerenderChecklist) {
    var id = event.id;
    var enc = encodeURIComponent(id);
    var shared = function () { markShared(id); rerenderChecklist(); };

    var wrap = el('div', 'fs-qr');

    var code = el('figure', 'fs-qr__code');
    code.style.margin = '0';
    var img = document.createElement('img');
    img.src = '/api/event/' + enc + '/qr';
    img.alt = 'QR-Code für die Gäste von ' + (event.title || 'eurer Feier');
    img.width = 220; img.height = 220;
    code.append(img, txt('span', event.title || ''));

    var intro = el('p', null, 'Mit diesem Code kommen eure Gäste direkt in euer Album – ohne App und ohne Anmeldung.');

    var callout = el('div', 'fs-callout');
    var calloutText = el('span');
    calloutText.append(txt('strong', 'Jetzt selbst testen: '), document.createTextNode('Scanne den Code mit deinem Handy. So siehst du genau, was deine Gäste erleben.'));
    callout.append(icon(ICON.phone, 22), calloutText);

    var copy = btn('Gästelink kopieren', 'fs-btn--primary fs-btn--block', null);
    copy.addEventListener('click', function () {
      var done = function () {
        copy.textContent = 'Kopiert ✓';
        shared();
        setTimeout(function () { copy.textContent = 'Gästelink kopieren'; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(event.guestUrl).then(done, function () { fallbackCopy(); });
      } else fallbackCopy();
      function fallbackCopy() {
        var input = el('input');
        input.value = event.guestUrl; input.readOnly = true;
        input.setAttribute('aria-label', 'Gästelink');
        input.style.cssText = 'width:100%;margin-top:8px';
        copy.after(input); input.select();
        shared();
      }
    });

    var dl = el('div', 'fs-dl');
    dl.append(txt('h3', 'Herunterladen'));
    var g1 = el('div', 'fs-dl__group');
    var g1h = el('div', 'fs-dl__head');
    g1h.append(txt('strong', 'Nur der QR-Code'), el('span', 'fs-small', 'für eigene Designs'));
    var g1r = el('div', 'fs-dl__row');
    g1r.append(
      linkBtn('PNG', '/api/event/' + enc + '/qr', 'fs-btn--secondary fs-btn--small', { download: true, onClick: shared }),
      linkBtn('SVG', '/api/event/' + enc + '/qr.svg', 'fs-btn--secondary fs-btn--small', { download: true, onClick: shared }),
      linkBtn('PDF', '/api/event/' + enc + '/qr.pdf', 'fs-btn--secondary fs-btn--small', { download: true, onClick: shared })
    );
    g1.append(g1h, g1r, el('span', 'fs-small', 'Im Druck mindestens 3 × 3 cm groß, dunkel auf hellem Grund.'));

    var g2 = el('div', 'fs-dl__group');
    var g2h = el('div', 'fs-dl__head');
    g2h.append(txt('strong', 'Tischaufsteller mit QR'), el('span', 'fs-small', 'druckfertig'));
    var studio = linkBtn('', '/event/' + enc + '/design', 'fs-btn--secondary fs-btn--block fs-studio-link', { onClick: shared });
    studio.append(icon(ICON.sparkle), document.createTextNode(' Aufsteller gestalten & als PDF laden'));
    g2.append(g2h, studio);
    dl.append(g1, g2);

    var preview = el('div', 'fs-guest-preview');
    var phone = el('a', 'fs-phone');
    phone.href = event.guestUrl; phone.target = '_blank'; phone.rel = 'noopener';
    phone.setAttribute('aria-label', 'Gästeansicht in neuem Tab öffnen');
    phone.append(txt('small', 'Willkommen'), txt('b', event.title || ''), txt('i', 'Fotos teilen'));
    var previewText = el('div');
    previewText.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    var openGuest = el('a', null, 'Gästeansicht öffnen');
    openGuest.href = event.guestUrl; openGuest.target = '_blank'; openGuest.rel = 'noopener';
    previewText.append(txt('h3', 'So sehen es eure Gäste'),
      el('p', null, 'Gäste landen auf eurer persönlichen Willkommensseite und können sofort Fotos teilen.'), openGuest);
    preview.append(phone, previewText);

    var right = el('div');
    right.style.cssText = 'display:flex;flex-direction:column;gap:16px;min-width:0';
    right.append(intro, callout, copy, dl, preview);
    wrap.append(code, right);
    return wrap;
  }

  /* ---------- Einhängen ---------- */
  function mount(detail) {
    var event = detail && detail.event;
    if (!event || !detail.active || !event.guestUrl) return;
    var card = detail.card;
    var design = readDesign(event);

    if (detail.summarySection) {
      var journey = el('section', 'fs-page fs-embed');
      journey.setAttribute('aria-label', 'Vorbereitung eurer Feier');
      var render = function () {
        journey.replaceChildren(countdown(event, design), checklist(event, card, design, render), facts(event, card));
      };
      render();
      var heading = detail.summarySection.querySelector('h3');
      if (heading) heading.after(journey); else detail.summarySection.prepend(journey);
      mount.rerender = render;
    }

    if (detail.accessSection) {
      var qr = el('section', 'fs-page fs-embed');
      qr.setAttribute('aria-label', 'QR-Code und Gästelink');
      qr.append(qrPanel(event, function () { if (mount.rerender) mount.rerender(); }));
      var accessHeading = detail.accessSection.querySelector('h3');
      if (accessHeading) accessHeading.after(qr); else detail.accessSection.prepend(qr);
    }
  }

  document.addEventListener('finalsnap:event-rendered', function (e) {
    try { mount(e.detail); } catch (err) { if (window.console) console.error('event-journey:', err); }
  });
})();
