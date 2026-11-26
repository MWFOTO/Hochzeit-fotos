(() => {
  const form = document.getElementById('partner-form'), status = document.getElementById('status'), submit = document.getElementById('submit');
  const description = document.getElementById('description'), count = document.getElementById('description-count');
  description.addEventListener('input', () => { count.textContent = description.value.length; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const invalid = [...form.querySelectorAll('[required]')].find(input => input.type === 'checkbox' ? !input.checked : !input.value.trim());
    if (invalid) { status.textContent = invalid.type === 'checkbox' ? 'Bitte bestätige die Veröffentlichung deines Eintrags.' : 'Bitte fülle alle Pflichtfelder (*) aus.'; invalid.focus(); return; }
    if (!['website', 'publicEmail', 'publicPhone', 'instagram'].some(name => form[name].value.trim())) { status.textContent = 'Bitte gib mindestens einen Weg an, wie Paare euch erreichen.'; form.website.focus(); return; }
    if (!/^\d{5}$/.test(form.postcode.value.trim())) { status.textContent = 'Bitte eine fünfstellige Postleitzahl angeben.'; form.postcode.focus(); return; }
    const data = new FormData(form); data.set('consent', 'true'); if (!form.logo.files.length) data.delete('logo');
    submit.disabled = true; status.textContent = 'Wird gesendet …';
    try {
      const res = await fetch('/api/partners/signup', { method: 'POST', body: data }); const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Die Anmeldung konnte nicht gesendet werden.');
      const done = document.createElement('div'); done.className = 'full partner-done';
      const h = document.createElement('h2'); h.textContent = result.message || 'Danke für deine Anmeldung!';
      const intro = document.createElement('p'); intro.textContent = 'So geht es weiter:';
      const list = document.createElement('ol'); for (const step of result.steps || []) { const li = document.createElement('li'); li.textContent = step; list.append(li); }
      done.append(h, intro, list); form.replaceChildren(done); done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) { status.textContent = error.message; submit.disabled = false; }
  });
})();
