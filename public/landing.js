fetch('/api/plans').then(response => response.json()).then(plans => {
      for (const [key, plan] of Object.entries(plans)) {
        if (plan.legacy) continue;
        const card = document.createElement('article');
        card.className = 'plan-card';
        const title = document.createElement('h3');
        title.textContent = plan.label;
        const price = document.createElement('p');
        price.className = 'plan-price';
        price.textContent = new Intl.NumberFormat('de-DE', {style:'currency', currency:'EUR'}).format(plan.priceCents / 100);
        const tax = document.createElement('p');
        tax.className = 'plan-tax';
        tax.textContent = 'inkl. 19 % USt. · Endpreis für Privat- und Geschäftskunden';
        const billing = document.createElement('p');
        billing.className = 'plan-billing';
        billing.textContent = 'einmalig pro Veranstaltung';
        const details = document.createElement('p');
        details.className = 'plan-details';
        details.textContent = `Keine feste Fotoanzahl · bis zu ${plan.storageLimitGB.toLocaleString('de-DE', {maximumFractionDigits:1})} GB Fotospeicher`;
        const features = document.createElement('ul');
        features.className = 'plan-features';
        for (const feature of ['QR-Code, Gästebuch und 12 Fotoaufgaben', 'Persönliche Gästegalerien und Veranstalterübersicht', 'Live-Diashow und Downloads']) {
          const item = document.createElement('li');
          item.textContent = feature;
          features.append(item);
        }
        const period = document.createElement('p');
        period.className = 'plan-period';
        period.textContent = '90 Tage ab Veranstaltungsdatum · danach automatische Löschung';
        const choose = document.createElement('a');
        choose.className = 'button primary';
        choose.href = '/register?plan=' + encodeURIComponent(key);
        choose.textContent = 'Event anlegen';
        card.append(title, price, tax, billing, details, features, period, choose);
        document.getElementById('plan-grid').append(card);
      }
    }).catch(() => {});
