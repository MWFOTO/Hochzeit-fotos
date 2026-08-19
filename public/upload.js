/**
 * upload.js
 * ---------------------------------------------------------
 * Logik für die mobile Upload-Seite.
 * - Liest die Event-ID aus der URL (/event/:eventId)
 * - Öffnet bei Klick auf den Button die Kamera/Galerie
 * - Lädt ausgewählte Fotos direkt per XHR hoch (für Fortschrittsanzeige)
 * - Zeigt eine kleine Vorschau der eigenen Uploads
 * ---------------------------------------------------------
 */

(function () {
  // Event-ID aus der URL extrahieren, z.B. "/event/123" -> "123"
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const eventId = pathParts[1] || 'default';

  const uploadTrigger = document.getElementById('upload-trigger');
  const fileInput = document.getElementById('file-input');
  const statusEl = document.getElementById('status');
  const progressWrap = document.getElementById('progress-wrap');
  const progressBar = document.getElementById('progress-bar');
  const thumbsEl = document.getElementById('thumbs');

  // Klick auf den sichtbaren Button löst das (versteckte) Datei-Input aus
  uploadTrigger.addEventListener('click', () => {
    fileInput.click();
  });

  // Sobald Dateien ausgewählt wurden, direkt hochladen
  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    uploadFiles(files);
  });

  function uploadFiles(files) {
    const formData = new FormData();
    for (const file of files) {
      formData.append('photos', file);
    }

    setStatus('Wird hochgeladen …', 'loading');
    showProgress(true);
    setProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/event/${encodeURIComponent(eventId)}/upload`);

    // Fortschrittsbalken während des Uploads aktualisieren
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        setProgress(percent);
      }
    });

    xhr.onload = () => {
      showProgress(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        setStatus('✓ Danke! Deine Fotos wurden hochgeladen.', 'success');
        showLocalPreview(files);
        // Datei-Input zurücksetzen, damit dieselbe Datei erneut gewählt werden kann
        fileInput.value = '';
      } else {
        let message = 'Beim Hochladen ist ein Fehler aufgetreten.';
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.error) message = res.error;
        } catch (_) {}
        setStatus('✗ ' + message, 'error');
      }
    };

    xhr.onerror = () => {
      showProgress(false);
      setStatus('✗ Verbindung fehlgeschlagen. Bitte erneut versuchen.', 'error');
    };

    xhr.send(formData);
  }

  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = 'status ' + (type || '');
  }

  function showProgress(active) {
    progressWrap.classList.toggle('active', !!active);
  }

  function setProgress(percent) {
    progressBar.style.width = percent + '%';
  }

  // Zeigt lokal (nur im Browser des Gasts) eine kleine Vorschau der gerade
  // hochgeladenen Fotos an, damit direktes Feedback entsteht.
  function showLocalPreview(files) {
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.createElement('img');
        img.src = e.target.result;
        thumbsEl.prepend(img);
      };
      reader.readAsDataURL(file);
    }
  }
})();
