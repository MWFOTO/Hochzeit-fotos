// Event-ID aus der URL lesen: /event/123/admin -> "123"
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const eventId = pathParts[1] || 'default';

    const btn = document.getElementById('download-btn');
    const statusEl = document.getElementById('status');

    btn.addEventListener('click', async () => {
      statusEl.textContent = 'ZIP wird vorbereitet …';
      statusEl.className = 'status loading';

      try {
        const res = await fetch(`/api/event/${encodeURIComponent(eventId)}/download`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          statusEl.textContent = '✗ ' + (data.error || 'Download fehlgeschlagen.');
          statusEl.className = 'status error';
          return;
        }

        // Antwort als Datei-Download auslösen
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `event-${eventId}-fotos.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        statusEl.textContent = '✓ Download gestartet.';
        statusEl.className = 'status success';
      } catch (err) {
        statusEl.textContent = '✗ Verbindung fehlgeschlagen.';
        statusEl.className = 'status error';
      }
    });
