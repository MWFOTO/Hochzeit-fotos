const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const statusText = document.getElementById('status-text');
    const linkList = document.getElementById('link-list');
    const pendingMsg = document.getElementById('pending-msg');
    const retryLink = document.getElementById('retry-link');

    async function checkStatus() {
      if (!sessionId) {
        statusText.textContent = 'Keine Bestellung gefunden.';
        return;
      }
      try {
        const res = await fetch(`/api/checkout/${encodeURIComponent(sessionId)}`);
        const data = await res.json();

        if (!res.ok) {
          statusText.textContent = 'Bestellung nicht gefunden.';
          return;
        }

        if (data.status === 'paid') {
          const base = window.location.origin;
          const eventId = data.eventId;
          statusText.textContent = `Euer Event "${eventId}" ist aktiv!`;
          pendingMsg.style.display = 'none';
          linkList.style.display = 'block';
          linkList.replaceChildren();
          const dashboard = document.createElement('a');
          dashboard.href = '/dashboard'; dashboard.textContent = 'Zum Dashboard: Gästelinks, QR-Code und Fotos verwalten';
          linkList.append(dashboard);
        } else if (data.status === 'retry_available' && data.retryAvailable) {
          statusText.textContent = 'Diese Zahlungsseite ist abgelaufen oder die Zahlung wurde nicht abgeschlossen. Du kannst im Dashboard für dasselbe Album einen neuen Zahlversuch starten.';
          pendingMsg.style.display = 'none';
          retryLink.hidden = false;
        } else if (data.status === 'refunded') {
          statusText.textContent = 'Die Erstattung ist bestätigt. Der Zugang zu diesem Album wurde beendet.';
          pendingMsg.style.display = 'none';
        } else if (data.status === 'disputed') {
          statusText.textContent = 'Zu dieser Zahlung läuft eine Klärung. Der Albumzugang bleibt während der Prüfung bestehen.';
          pendingMsg.style.display = 'none';
        } else {
          pendingMsg.style.display = 'block';
          setTimeout(checkStatus, 2000); // in 2 Sekunden erneut prüfen
        }
      } catch (err) {
        statusText.textContent = 'Verbindung fehlgeschlagen.';
      }
    }

    function linkCard(title, desc, url) {
      return `
        <div class="link-card">
          <div class="link-title">${title}</div>
          <div class="link-desc">${desc}</div>
          <a class="link-url" href="${url}" target="_blank">${url}</a>
        </div>
      `;
    }

    checkStatus();
