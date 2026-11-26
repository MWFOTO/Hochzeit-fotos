// Dashboard-Erweiterungen: Dienstleister in eurer Nähe und Empfehlungs-Code.
(() => {
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && /^[A-Za-z0-9-]{4,20}$/.test(ref)) try { localStorage.setItem('finalsnap_ref', ref.toUpperCase()); } catch {}
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const euro = cents => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  window.finalsnapStoredReferral = () => { try { return localStorage.getItem('finalsnap_ref') || ''; } catch { return ''; } };
  window.finalsnapClearReferral = () => { try { localStorage.removeItem('finalsnap_ref'); } catch {} };

  window.finalsnapNearby = async function (mount, event, api) {
    mount.className = 'event-section nearby-partners';
    const draw = data => {
      mount.replaceChildren(el('h3', 'Dienstleister in eurer Nähe'));
      if (!data.postcode) {
        mount.append(el('p', 'Gebt die Postleitzahl eurer Location an – dann zeigen wir euch Fotograf:innen, DJs, Floristik und mehr aus eurer Region.'));
      } else if (!data.partners.length) {
        mount.append(el('p', `Für ${data.postcode} gibt es noch keine Partner. Wir bauen das Verzeichnis gerade auf.`));
      } else {
        const grid = el('div', undefined, 'partner-grid');
        for (const p of data.partners) grid.append(window.finalsnapPartnerCard ? window.finalsnapPartnerCard(p, 'h4') : el('p', p.company));
        mount.append(grid);
        const all = el('a', 'Alle Partner in der Region ansehen →'); all.href = `/partner?plz=${encodeURIComponent(data.postcode)}`; mount.append(el('p')); mount.lastChild.append(all);
      }
      const form = el('form'); const label = el('label', 'PLZ der Location'); const input = el('input'); input.inputMode = 'numeric'; input.maxLength = 5; input.pattern = '\\d{5}'; input.value = data.postcode || ''; input.autocomplete = 'postal-code'; label.append(input);
      const save = el('button', data.postcode ? 'Ändern' : 'Partner anzeigen', 'secondary'); save.type = 'submit'; const note = el('p', '', 'small'); note.setAttribute('role', 'status');
      form.append(label, save); mount.append(form, note);
      form.addEventListener('submit', async e => { e.preventDefault(); try { await api(`/api/event/${encodeURIComponent(event.id)}/location`, 'PATCH', { postcode: input.value.trim() }); load(); } catch (error) { note.textContent = error.message; } });
    };
    const load = async () => { try { draw(await api(`/api/event/${encodeURIComponent(event.id)}/partners`)); } catch { mount.hidden = true; } };
    await load();
  };

  window.finalsnapReferral = async function (mount, event, api, onChange) {
    mount.className = 'referral-box';
    let data;
    try { data = await api(`/api/event/${encodeURIComponent(event.id)}/partners`); } catch { mount.hidden = true; return; }
    const draw = () => {
      mount.replaceChildren(el('strong', 'Empfehlungs-Code'));
      if (data.referral) {
        mount.append(el('p', `Code ${data.referral.code} von ${data.referral.company} ist eingelöst. Euer Preis: ${euro(data.priceCents)} statt ${euro(data.basePriceCents)}.`));
        const remove = el('button', 'Code entfernen', 'secondary'); remove.type = 'button'; mount.append(remove);
        remove.addEventListener('click', () => submit(''));
        return;
      }
      mount.append(el('p', `Ihr habt einen Code von eurem Fotografen, eurer Location oder einem anderen Partner? Damit spart ihr ${euro(data.discountCents)}.`));
      const form = el('form'); const label = el('label', 'Code'); const input = el('input'); input.maxLength = 20; input.autocomplete = 'off'; input.value = window.finalsnapStoredReferral(); label.append(input);
      const go = el('button', 'Einlösen', 'secondary'); go.type = 'submit'; form.append(label, go); mount.append(form, note);
      form.addEventListener('submit', e => { e.preventDefault(); submit(input.value.trim()); });
    };
    const note = el('p', '', 'small'); note.setAttribute('role', 'status');
    async function submit(code) {
      try {
        const result = await api(`/api/event/${encodeURIComponent(event.id)}/referral`, 'POST', { code });
        data = { ...data, referral: result.referral, priceCents: result.priceCents }; note.textContent = '';
        if (result.referral) window.finalsnapClearReferral();
        draw(); if (onChange) onChange(result.priceCents);
      } catch (error) { note.textContent = error.message; if (!mount.contains(note)) mount.append(note); }
    }
    draw();
  };
})();
