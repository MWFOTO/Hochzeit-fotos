/**
 * FinalSnap Karten-Assistent (card-studio.js)
 * Gestaltet von Claude, 26.11.2026.
 *
 * Führt im Design-Editor mit kurzen Fragen zur fertigen Tischkarte.
 * - Ist der KI-Assistent auf dem Server eingeschaltet, schreibt Claude die Texte und wählt den Stil.
 * - Sonst entsteht der Entwurf direkt im Browser aus Vorlagen (ohne Datenübertragung).
 * Der echte QR-Code wird in beiden Fällen automatisch eingesetzt (design-editor.js).
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
  var aiEnabled = false;
  var current = 0;
  var variant = 0;
  var busy = false;

  var PALETTES = {
    sage: { accent: '#a8bf83', words: 'Salbei und Creme' },
    gold: { accent: '#d3ad63', words: 'Gold und Nachtblau' },
    rose: { accent: '#e8a9b8', words: 'Rosé und Weiß' },
    terracotta: { accent: '#d9825b', words: 'Terrakotta' },
    neon: { accent: '#49d5e8', words: 'Türkis' }
  };
  var MOODS = {
    elegant: { theme: 'garden', font: 'palatino' },
    romantic: { theme: 'garden', font: 'classic' },
    playful: { theme: 'afterglow', font: 'relaxed' },
    modern: { theme: 'midnight', font: 'modern' },
    natural: { theme: 'garden', font: 'relaxed' }
  };
  var KICKERS = { wedding: 'UNSERE HOCHZEIT', birthday: 'GEBURTSTAG', party: 'UNSERE PARTY', summer: 'SOMMERFEST', company: 'FIRMENFEIER', jubilee: 'JUBILÄUM', graduation: 'ABSCHLUSSFEIER', other: 'UNSERE FEIER' };
  var TEXTS = {
    ihr: {
      invite: ['Scannt den Code und teilt eure schönsten Fotos mit uns.', 'Eure Blickwinkel machen unser Album komplett. Einfach scannen.', 'Ein Foto von euch, eine Erinnerung für uns: scannen und hochladen.'],
      backKicker: ['TEILT EURE MOMENTE', 'FOTOS ERWÜNSCHT', 'GEMEINSAM ERINNERN'],
      backInvite: ['Ohne App und ohne Anmeldung, in Sekunden hochgeladen.', 'Jedes Foto macht unser Album reicher.', 'Wir freuen uns auf eure Schnappschüsse.']
    },
    du: {
      invite: ['Scanne den Code und teile deine schönsten Fotos mit uns.', 'Dein Blickwinkel macht unser Album komplett. Einfach scannen.', 'Ein Foto von dir, eine Erinnerung für uns: scannen und hochladen.'],
      backKicker: ['TEILE DEINE MOMENTE', 'FOTOS ERWÜNSCHT', 'GEMEINSAM ERINNERN'],
      backInvite: ['Ohne App und ohne Anmeldung, in Sekunden hochgeladen.', 'Jedes Foto macht unser Album reicher.', 'Wir freuen uns auf deine Schnappschüsse.']
    }
  };

  function checked(name) { var el = root.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; }
  function activeSteps() { return steps.filter(function (s) { return aiEnabled || s.dataset.step !== '4'; }); }

  function show(index) {
    var list = activeSteps();
    current = Math.max(0, Math.min(index, list.length - 1));
    steps.forEach(function (s) { s.hidden = list.indexOf(s) !== current; });
    dots.forEach(function (d, i) { d.hidden = i >= list.length; d.classList.toggle('is-done', i < current); d.classList.toggle('is-current', i === current); });
    back.hidden = current === 0;
    next.textContent = current === list.length - 1 ? 'Entwurf erstellen ✦' : 'Weiter';
    status.textContent = '';
    var field = list[current].querySelector('input:not([type=radio]),textarea,input[type=radio]:checked');
    if (field && document.activeElement && root.contains(document.activeElement)) field.focus({ preventScroll: true });
  }

  function answers() {
    var palette = PALETTES[checked('cs-palette')] || PALETTES.sage;
    var own = ($('#cs-colors') && $('#cs-colors').value.trim()) || '';
    return {
      occasion: window.fsEditor ? window.fsEditor.occasion : 'other',
      hosts: $('#cs-hosts').value.trim(),
      mood: checked('cs-mood') || 'elegant',
      colors: own ? own + ' (Grundton: ' + palette.words + ')' : palette.words,
      address: checked('cs-address') === 'du' ? 'du' : 'ihr',
      wish: ($('#cs-wish') && $('#cs-wish').value.trim()) || ''
    };
  }

  function localSuggestion(a) {
    var mood = MOODS[a.mood] || MOODS.elegant;
    var palette = PALETTES[checked('cs-palette')] || PALETTES.sage;
    var t = TEXTS[a.address] || TEXTS.ihr;
    var i = variant % 3;
    return {
      title: a.hosts,
      kicker: KICKERS[a.occasion] || KICKERS.other,
      invite: t.invite[i], backKicker: t.backKicker[i], backInvite: t.backInvite[i],
      theme: mood.theme, accent: palette.accent, font: mood.font, qrPosition: 'center',
      note: 'Euer Entwurf ist fertig. Der QR-Code ist schon eingesetzt.'
    };
  }

  async function aiSuggestion(a) {
    var ed = window.fsEditor;
    var data = await ed.api(ed.endpoint + '/card-assistant', 'POST', { answers: a });
    return data.suggestion;
  }

  async function generate() {
    if (busy || !window.fsEditor) return;
    var a = answers();
    if (!a.hosts) { show(0); status.textContent = 'Bitte sag mir zuerst, wer feiert.'; $('#cs-hosts').focus(); return; }
    busy = true; next.disabled = true; $('#cs-again').disabled = true;
    root.classList.add('is-busy');
    status.textContent = aiEnabled ? 'Ich gestalte euren Entwurf …' : 'Entwurf wird erstellt …';
    var suggestion;
    try {
      suggestion = aiEnabled ? await aiSuggestion(a) : localSuggestion(a);
    } catch (error) {
      suggestion = localSuggestion(a);
      suggestion.note = (error && error.message ? error.message + ' ' : '') + 'Ich habe euch stattdessen einen Entwurf aus unseren Vorlagen erstellt.';
    }
    try {
      window.fsEditor.apply(suggestion);
      await window.fsEditor.save();
    } catch (error) {
      status.textContent = (error && error.message) || 'Der Entwurf konnte nicht gespeichert werden.';
    }
    var preview = await window.fsEditor.renderPreview();
    if (preview) $('#cs-preview').src = preview;
    $('#cs-preview').hidden = !preview;
    $('#cs-note').textContent = suggestion.note || 'Euer Entwurf ist fertig. Der QR-Code ist schon eingesetzt.';
    steps.forEach(function (s) { s.hidden = true; });
    root.querySelector('.cs-dots').hidden = true;
    nav.hidden = true;
    result.hidden = false;
    if (status.textContent.indexOf('gespeichert') === -1 && status.textContent.indexOf('nicht') === -1) status.textContent = 'Entwurf gespeichert.';
    root.classList.remove('is-busy');
    busy = false; next.disabled = false; $('#cs-again').disabled = false;
    $('#cs-note').setAttribute('tabindex', '-1');
    $('#cs-note').focus({ preventScroll: true });
  }

  next.addEventListener('click', function () {
    if (current === 0 && !$('#cs-hosts').value.trim()) { status.textContent = 'Bitte sag mir zuerst, wer feiert.'; $('#cs-hosts').focus(); return; }
    if (current < activeSteps().length - 1) show(current + 1); else generate();
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
    if (!window.fsEditor) return;
    fetch(window.fsEditor.endpoint + '/card-assistant')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        aiEnabled = !!(data && data.enabled);
        root.classList.toggle('has-ai', aiEnabled);
        $('#cs-badge').textContent = aiEnabled ? 'EUER KARTEN-ASSISTENT · MIT KI' : 'EUER KARTEN-ASSISTENT';
        $('#cs-title').textContent = aiEnabled ? 'Ich gestalte eure Tischkarte – in fünf kurzen Fragen.' : 'Ich gestalte eure Tischkarte – in vier kurzen Fragen.';
        Array.prototype.forEach.call(root.querySelectorAll('.cs-ai-only'), function (el) { el.hidden = !aiEnabled; });
        $('#cs-privacy').hidden = !aiEnabled;
        show(current);
      })
      .catch(function () { show(current); });
  });

  show(0);
})();
