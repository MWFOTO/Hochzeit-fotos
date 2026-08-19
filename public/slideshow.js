/**
 * slideshow.js
 * ---------------------------------------------------------
 * Logik für die Beamer-Diashow.
 *
 * - Fragt alle POLL_INTERVAL_MS die API nach neuen Fotos ab
 *   (regelmäßiges Fetch-Polling statt WebSocket – für den
 *   Prototyp einfacher aufzusetzen und genauso zuverlässig).
 * - Zeigt die gesammelten Fotos im Kreislauf an, alle
 *   SLIDE_INTERVAL_MS wird sanft zum nächsten Bild überblendet.
 * - Neue Fotos werden automatisch in die Rotation aufgenommen,
 *   ohne dass die Seite neu geladen werden muss.
 * ---------------------------------------------------------
 */

(function () {
  const POLL_INTERVAL_MS = 4000;   // wie oft nach neuen Fotos gefragt wird
  const SLIDE_INTERVAL_MS = 5000;  // wie lange jedes Foto angezeigt wird

  // Event-ID aus der URL extrahieren: /event/123/slideshow -> "123"
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const eventId = pathParts[1] || 'default';

  const container = document.getElementById('slideshow');
  const placeholder = document.getElementById('placeholder');
  const counterEl = document.getElementById('counter');
  const newBadge = document.getElementById('new-badge');

  let photos = [];        // alle bekannten Fotos { url, timestamp }
  let currentIndex = -1;
  let lastSeen = 0;       // Zeitstempel des zuletzt bekannten Fotos (für ?since=)

  // Zwei übereinanderliegende Layer für die Überblendung
  const layerA = createSlideLayer();
  const layerB = createSlideLayer();
  let activeLayer = layerA;
  let inactiveLayer = layerB;

  function createSlideLayer() {
    const div = document.createElement('div');
    div.className = 'slide';
    container.appendChild(div);
    return div;
  }

  // ---------------------------------------------------------
  // Neue Fotos vom Server abfragen
  // ---------------------------------------------------------
  async function fetchNewPhotos() {
    try {
      const res = await fetch(`/api/event/${encodeURIComponent(eventId)}/photos?since=${lastSeen}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.photos && data.photos.length > 0) {
        photos = photos.concat(data.photos);
        lastSeen = data.photos[data.photos.length - 1].timestamp;
        flashNewBadge();

        // Falls noch nichts angezeigt wurde, sofort mit dem ersten Bild starten
        if (currentIndex === -1) {
          placeholder.style.display = 'none';
          showSlide(0);
        }
      }
    } catch (err) {
      // Netzwerkfehler beim Polling einfach ignorieren und beim nächsten Intervall erneut versuchen
      console.warn('Polling fehlgeschlagen:', err);
    }
  }

  function flashNewBadge() {
    newBadge.classList.add('show');
    setTimeout(() => newBadge.classList.remove('show'), 2500);
  }

  // ---------------------------------------------------------
  // Bild anzeigen (mit Crossfade zwischen zwei Layern)
  // ---------------------------------------------------------
  function showSlide(index) {
    if (photos.length === 0) return;
    currentIndex = ((index % photos.length) + photos.length) % photos.length;
    const photo = photos[currentIndex];

    inactiveLayer.style.backgroundImage = `url("${photo.url}")`;

    // Erst im nächsten Frame einblenden, damit die CSS-Transition greift
    requestAnimationFrame(() => {
      inactiveLayer.classList.add('visible');
      activeLayer.classList.remove('visible');

      const tmp = activeLayer;
      activeLayer = inactiveLayer;
      inactiveLayer = tmp;
    });

    counterEl.textContent = `${currentIndex + 1} / ${photos.length}`;
  }

  function nextSlide() {
    if (photos.length === 0) return;
    showSlide(currentIndex + 1);
  }

  // ---------------------------------------------------------
  // Intervalle starten
  // ---------------------------------------------------------
  fetchNewPhotos(); // sofort beim Laden einmal prüfen
  setInterval(fetchNewPhotos, POLL_INTERVAL_MS);
  setInterval(nextSlide, SLIDE_INTERVAL_MS);
})();
