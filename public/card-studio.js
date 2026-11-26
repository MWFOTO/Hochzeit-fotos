/**
 * FinalSnap Karten-Assistent (card-studio.js)
 * Gestaltet von Claude, 26.11.2026.
 *
 * Führt im Design-Editor mit fünf kurzen Fragen zur fertigen Tischkarte.
 * Alles passiert im Browser: Texte kommen aus einer kuratierten Textbaustein-Bibliothek
 * (nach Anlass, Stimmung und Anrede). Es werden keine Daten an Dritte übertragen.
 * Der echte QR-Code wird automatisch eingesetzt (design-editor.js).
 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var root = $('#card-assistant');
  if (!root) return;

  var steps = Array.prototype.slice.call(root.querySelectorAll('.cs-step'));
  var dots = Array.prototype.slice.call(root.querySelectorAll('.cs-dots li'));
  var next = $('#cs-next'), back = $('#cs-back'), status = $('#cs-status');
  var result = $('#cs-result'), nav = $('#cs-nav');
  var current = 0;
  var variant = 0;
  var busy = false;

  /* ---------- Gestaltung ---------- */
  var PALETTES = {
    sage: { accent: '#a8bf83', name: 'Salbeigrün' },
    gold: { accent: '#d3ad63', name: 'Gold' },
    rose: { accent: '#e8a9b8', name: 'Rosé' },
    terracotta: { accent: '#d9825b', name: 'Terrakotta' },
    neon: { accent: '#49d5e8', name: 'Türkis' }
  };
  var MOODS = {
    elegant: { theme: 'garden', font: 'palatino', label: 'Elegant', fontName: 'zeitloser Palatino-Schrift' },
    romantic: { theme: 'afterglow', font: 'classic', label: 'Romantisch', fontName: 'geschwungener Georgia-Schrift' },
    playful: { theme: 'afterglow', font: 'relaxed', label: 'Verspielt', fontName: 'lockerer Schrift' },
    modern: { theme: 'midnight', font: 'modern', label: 'Modern', fontName: 'klarer, moderner Schrift' },
    natural: { theme: 'garden', font: 'relaxed', label: 'Natürlich', fontName: 'leichter, freundlicher Schrift' }
  };

  /* ---------- Textbausteine ---------- */
  // Kleine Zeile über dem Titel – je Anlass mehrere Varianten
  var KICKERS = {
    wedding: { ihr: ['UNSERE HOCHZEIT', 'WIR SAGEN JA', 'FÜR IMMER BEGINNT HEUTE', 'JA, WIR TRAUEN UNS'], du: ['UNSERE HOCHZEIT', 'WIR SAGEN JA', 'FÜR IMMER BEGINNT HEUTE', 'JA, WIR TRAUEN UNS'] },
    birthday: { ihr: ['GEBURTSTAG', 'LASST UNS FEIERN', 'EIN JAHR MEHR, EIN GRUND MEHR', 'HEUTE WIRD GEFEIERT'], du: ['GEBURTSTAG', 'LASS UNS FEIERN', 'EIN JAHR MEHR, EIN GRUND MEHR', 'HEUTE WIRD GEFEIERT'] },
    party: { ihr: ['UNSERE PARTY', 'HEUTE WIRD GEFEIERT', 'BÜHNE FREI', 'DIE NACHT GEHÖRT UNS'], du: ['UNSERE PARTY', 'HEUTE WIRD GEFEIERT', 'BÜHNE FREI', 'DIE NACHT GEHÖRT UNS'] },
    summer: { ihr: ['SOMMERFEST', 'ENDLICH SOMMER', 'SONNE, FREUNDE, GUTE ZEIT', 'SOMMER IN VOLLEN ZÜGEN'], du: ['SOMMERFEST', 'ENDLICH SOMMER', 'SONNE, FREUNDE, GUTE ZEIT', 'SOMMER IN VOLLEN ZÜGEN'] },
    company: { ihr: ['UNSERE FIRMENFEIER', 'GEMEINSAM FEIERN', 'DANKE FÜR EUREN EINSATZ', 'EIN ABEND FÜR UNS ALLE'], du: ['UNSERE FIRMENFEIER', 'GEMEINSAM FEIERN', 'DANKE FÜR DEINEN EINSATZ', 'EIN ABEND FÜR UNS ALLE'] },
    jubilee: { ihr: ['UNSER JUBILÄUM', 'EIN GRUND ZUM FEIERN', 'SO VIELE GEMEINSAME JAHRE', 'AUF DIE NÄCHSTEN JAHRE'], du: ['UNSER JUBILÄUM', 'EIN GRUND ZUM FEIERN', 'SO VIELE GEMEINSAME JAHRE', 'AUF DIE NÄCHSTEN JAHRE'] },
    graduation: { ihr: ['ABSCHLUSSFEIER', 'GESCHAFFT!', 'AUF DIE ZUKUNFT', 'DAS HABEN WIR UNS VERDIENT'], du: ['ABSCHLUSSFEIER', 'GESCHAFFT!', 'AUF DIE ZUKUNFT', 'DAS HABEN WIR UNS VERDIENT'] },
    other: { ihr: ['UNSERE FEIER', 'SCHÖN, DASS IHR DA SEID', 'HEUTE FEIERN WIR', 'GEMEINSAM ERLEBT'], du: ['UNSERE FEIER', 'SCHÖN, DASS DU DA BIST', 'HEUTE FEIERN WIR', 'GEMEINSAM ERLEBT'] }
  };

  // Einladung auf der Vorderseite – je Stimmung und Anrede
  var INVITES = {
    elegant: {
      ihr: ['Haltet diesen Tag mit uns fest: Code scannen und Fotos teilen.', 'Eure Bilder machen unsere Erinnerung vollständig. Bitte scannen und teilen.', 'Teilt eure schönsten Augenblicke mit uns – einfach den Code scannen.', 'Jeder Blickwinkel zählt. Scannt den Code und ladet eure Fotos hoch.'],
      du: ['Halte diesen Tag mit uns fest: Code scannen und Fotos teilen.', 'Deine Bilder machen unsere Erinnerung vollständig. Bitte scannen und teilen.', 'Teile deine schönsten Augenblicke mit uns – einfach den Code scannen.', 'Jeder Blickwinkel zählt. Scanne den Code und lade deine Fotos hoch.']
    },
    romantic: {
      ihr: ['Jedes eurer Fotos erzählt ein Stück unserer Geschichte. Teilt es mit uns.', 'Schenkt uns eure liebsten Momente – einfach scannen und hochladen.', 'Mit euren Augen gesehen: Teilt eure Fotos von diesem Tag mit uns.', 'Kleine Momente, große Erinnerungen. Scannt den Code und teilt eure Fotos.'],
      du: ['Jedes deiner Fotos erzählt ein Stück unserer Geschichte. Teile es mit uns.', 'Schenk uns deine liebsten Momente – einfach scannen und hochladen.', 'Mit deinen Augen gesehen: Teile deine Fotos von diesem Tag mit uns.', 'Kleine Momente, große Erinnerungen. Scanne den Code und teile deine Fotos.']
    },
    playful: {
      ihr: ['Handy raus, Code scannen, Fotos rein! Wir wollen alles sehen.', 'Schnappschüsse, Grimassen, Tanzfläche: Her mit euren Fotos!', 'Ihr wart dabei? Beweisfotos bitte hier hochladen.', 'Lächeln, knipsen, teilen! Euer Foto gehört in unser Album.'],
      du: ['Handy raus, Code scannen, Fotos rein! Wir wollen alles sehen.', 'Schnappschüsse, Grimassen, Tanzfläche: Her mit deinen Fotos!', 'Du warst dabei? Beweisfotos bitte hier hochladen.', 'Lächeln, knipsen, teilen! Dein Foto gehört in unser Album.']
    },
    modern: {
      ihr: ['Scannen. Hochladen. Fertig. Teilt eure Fotos in unserem Album.', 'Ein Album, viele Blickwinkel. Scannt den Code und ladet eure Fotos hoch.', 'Keine App, keine Anmeldung: Code scannen und Fotos teilen.', 'Eure Fotos, ein gemeinsames Album. In wenigen Sekunden hochgeladen.'],
      du: ['Scannen. Hochladen. Fertig. Teile deine Fotos in unserem Album.', 'Ein Album, viele Blickwinkel. Scanne den Code und lade deine Fotos hoch.', 'Keine App, keine Anmeldung: Code scannen und Fotos teilen.', 'Deine Fotos, ein gemeinsames Album. In wenigen Sekunden hochgeladen.']
    },
    natural: {
      ihr: ['Ganz ungezwungen: Scannt den Code und teilt eure Fotos mit uns.', 'Lieblingsmomente an einem Ort gesammelt. Einfach scannen und hochladen.', 'Ob Sonnenuntergang oder Schnappschuss: Wir freuen uns über jedes Foto.', 'Echte Momente statt perfekter Bilder. Teilt, was ihr heute seht.'],
      du: ['Ganz ungezwungen: Scanne den Code und teile deine Fotos mit uns.', 'Lieblingsmomente an einem Ort gesammelt. Einfach scannen und hochladen.', 'Ob Sonnenuntergang oder Schnappschuss: Wir freuen uns über jedes Foto.', 'Echte Momente statt perfekter Bilder. Teile, was du heute siehst.']
    }
  };

  // Rückseite des Tischaufstellers
  var BACK = {
    ihr: {
      kicker: ['TEILT EURE MOMENTE', 'FOTOS ERWÜNSCHT', 'GEMEINSAM ERINNERN', 'EURE SICHT AUF DEN TAG'],
      invite: ['Ohne App und ohne Anmeldung – in Sekunden hochgeladen.', 'Alle Fotos landen in einem gemeinsamen Album, das ihr auch selbst ansehen könnt.', 'Eure Fotos werden in voller Qualität gespeichert. Danke fürs Teilen!', 'Der Code funktioniert die ganze Feier über. Teilt, so oft ihr wollt.']
    },
    du: {
      kicker: ['TEILE DEINE MOMENTE', 'FOTOS ERWÜNSCHT', 'GEMEINSAM ERINNERN', 'DEINE SICHT AUF DEN TAG'],
      invite: ['Ohne App und ohne Anmeldung – in Sekunden hochgeladen.', 'Alle Fotos landen in einem gemeinsamen Album, das du auch selbst ansehen kannst.', 'Deine Fotos werden in voller Qualität gespeichert. Danke fürs Teilen!', 'Der Code funktioniert die ganze Feier über. Teile, so oft du willst.']
    }
  };

  function pick(list, offset) { return list[(variant + (offset || 0)) % list.length]; }
  function checked(name) { var el = root.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; }

  function show(index) {
    current = Math.max(0, Math.min(index, steps.length - 1));
    steps.forEach(function (s, i) { s.hidden = i !== current; });
    dots.forEach(function (d, i) { d.classList.toggle('is-done', i < current); d.classList.toggle('is-current', i === current); });
    back.hidden = current === 0;
    next.textContent = current === steps.length - 1 ? 'Entwurf erstellen ✦' : 'Weiter';
    status.textContent = '';
  }

  function suggestion() {
    var occasion = window.fsEditor ? window.fsEditor.occasion : 'other';
    var moodKey = checked('cs-mood') || 'elegant';
    var mood = MOODS[moodKey] || MOODS.elegant;
    var palette = PALETTES[checked('cs-palette')] || PALETTES.sage;
    var address = checked('cs-address') === 'du' ? 'du' : 'ihr';
    var own = ($('#cs-own') && $('#cs-own').value.replace(/\s+/g, ' ').trim()) || '';
    var kickers = (KICKERS[occasion] || KICKERS.other)[address];
    var invites = (INVITES[moodKey] || INVITES.elegant)[address];
    var backTexts = BACK[address];
    return {
      title: $('#cs-hosts').value.trim(),
      kicker: pick(kickers),
      invite: own || pick(invites),
      // Rückseite bewusst versetzt, damit Vorder- und Rückseite nicht gleich klingen
      backKicker: pick(backTexts.kicker, 1),
      backInvite: own ? pick(invites) : pick(backTexts.invite, 1),
      theme: mood.theme, accent: palette.accent, font: mood.font, qrPosition: 'center',
      note: mood.label + ' in ' + palette.name + ', mit ' + mood.fontName + '. Der QR-Code ist schon eingesetzt.'
    };
  }

  async function generate() {
    if (busy || !window.fsEditor) return;
    if (!$('#cs-hosts').value.trim()) { show(0); status.textContent = 'Bitte sag mir zuerst, wer feiert.'; $('#cs-hosts').focus(); return; }
    busy = true; next.disabled = true; $('#cs-again').disabled = true;
    root.classList.add('is-busy');
    status.textContent = 'Entwurf wird erstellt …';
    var s = suggestion();
    var saved = true;
    try {
      window.fsEditor.apply(s);
      await window.fsEditor.save();
    } catch (error) {
      saved = false;
      status.textContent = (error && error.message) || 'Der Entwurf konnte nicht gespeichert werden.';
    }
    var preview = await window.fsEditor.renderPreview();
    $('#cs-preview').hidden = !preview;
    if (preview) $('#cs-preview').src = preview;
    $('#cs-note').textContent = s.note;
    steps.forEach(function (step) { step.hidden = true; });
    root.querySelector('.cs-dots').hidden = true;
    nav.hidden = true;
    result.hidden = false;
    if (saved) status.textContent = 'Entwurf gespeichert.';
    root.classList.remove('is-busy');
    busy = false; next.disabled = false; $('#cs-again').disabled = false;
    $('#cs-note').setAttribute('tabindex', '-1');
    $('#cs-note').focus({ preventScroll: true });
  }

  next.addEventListener('click', function () {
    if (current === 0 && !$('#cs-hosts').value.trim()) { status.textContent = 'Bitte sag mir zuerst, wer feiert.'; $('#cs-hosts').focus(); return; }
    if (current < steps.length - 1) show(current + 1); else generate();
  });
  back.addEventListener('click', function () { show(current - 1); });
  $('#cs-hosts').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next.click(); } });
  $('#cs-again').addEventListener('click', function () { variant++; generate(); });
  $('#cs-restart').addEventListener('click', function () {
    result.hidden = true; nav.hidden = false; root.querySelector('.cs-dots').hidden = false; show(0);
  });
  $('#cs-edit').addEventListener('click', function () {
    var section = $('#card-texts');
    if (section) { section.scrollIntoView({ behavior: 'smooth', block: 'start' }); var f = $('#cardInvite'); if (f) f.focus({ preventScroll: true }); }
  });

  document.addEventListener('finalsnap:editor-ready', function (e) {
    var hosts = $('#cs-hosts');
    if (hosts && !hosts.value && e.detail && e.detail.title) hosts.value = e.detail.title;
  });

  show(0);
})();
