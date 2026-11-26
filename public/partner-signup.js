(() => {
  const form = document.getElementById('partner-form'), status = document.getElementById('status'), submit = document.getElementById('submit');
  const description = document.getElementById('description'), count = document.getElementById('description-count');
  description.addEventListener('input', () => { count.textContent = description.value.length; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const invalid = [...form.querySelectorAll('[required]')].find(input => input.type === 'checkbox' ? !input.checked : !input.value.trim());
    if (invalid) { status.textContent = invalid.type === 'checkbox' ? 'Bitte bestätige die Veröffentlichung deines Eintrags.' : 'Bitte fülle alle Pflichtfelder (*) aus.'; invalid.focus(); return; }
    if (!/^\d{5}$/.test(form.postcode.value.trim())) { status.textContent = 'Bitte eine fünfstellige Postleitzahl angeben.'; form.postcode.focus(); return; }
    const data = new FormData(form); data.set('consent', 'true'); if (!form.logo.files.length) data.delete('logo');
    submit.disabled = true; status.textContent = 'Wird gesendet …';
    try {
      const res = await fetch('/api/partners/signup', { method: 'POST', body: data }); const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Die Anmeldung konnte nicht gesendet werden.');
      form.replaceChildren(Object.assign(document.createElement('p'), { className: 'full', textContent: result.message || 'Danke für deine Anmeldung!' }));
    } catch (error) { status.textContent = error.message; submit.disabled = false; }
  });
})();
