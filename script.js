const PROXY = 'proxy.php';
let currentStopId = null;
let currentStationName = null; // neu: aktueller Stationsname speichern
let refreshTimer = null;
let allDepartures = []; // alle geladenen Abfahrten im Speicher

const params = new URLSearchParams(location.search);
const datePicker = document.getElementById('datePicker');
const timePicker = document.getElementById('timePicker');
const destFilter = document.getElementById('destFilter');

// ─── Modus-Filter (localStorage-persistent) ────────────────────────────────

// Kanonische Gruppen: welche API-modes gehören zu welchem Button
const MODE_GROUPS = {
  HIGHSPEED: ['HIGHSPEEDRAIL', 'HIGHSPEED_RAIL', 'INTERCITYRAIL', 'LONGDISTANCERAIL', 'LONG_DISTANCE'],
  RAIL: [ 'TRAIN', 'RAIL', 'COACHRAILWAY', 'LOCALTRAIN', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN'],
  NIGHT: ['NIGHTRAIL', 'NIGHT_RAIL', ],
  SUBWAY:  ['SUBWAY', 'METRO', 'URBAN_RAIL'],
  TRAM:    ['TRAM', 'TROLLEYBUS', 'STREETCAR'],
  BUS:     ['BUS', 'COACH', 'REGIONALBUS', 'EXPRESBUS', 'DEBUG_BUS_ROUTE'],
  FERRY:   ['FERRY', 'WATER', 'BOAT', 'DEBUG_FERRY_ROUTE'],
  GONDOLA: ['GONDOLA', 'CHAIRLIFT', 'CABLEWAY', 'FUNICULAR', 'AERIAL_LIFT', 'AREAL_LIFT', 'CABLE_CAR'],
  OTHER:   ['WALK', 'BIKE', 'RENTAL', 'CAR', 'CAR_PARKING', 'CAR_DROPOFF', 'ODM', 'RIDE_SHARING', 'FLEX', 'AIRPLANE', 'OTHER']
};

function canonicalMode(rawMode) {
  if (!rawMode) return 'OTHER';
  const m = rawMode.toUpperCase();
  for (const [group, variants] of Object.entries(MODE_GROUPS)) {
    if (group === 'OTHER') continue;
    if (variants.includes(m)) return group;
  }
  return 'OTHER';
}

// Geladene Einstellungen aus localStorage
// Default: "alleModeActive" = true (nur "Alle" leuchtet, alle Modi sind sichtbar)
function loadActiveModesFromStorage() {
  try {
    const stored = localStorage.getItem('tragic_mode_filter');
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        alleModeActive: parsed.alleModeActive ?? true,
        selectedModes: new Set(parsed.selectedModes || [])
      };
    }
  } catch (_) {}
  return { alleModeActive: true, selectedModes: new Set() };
}

let filterState = loadActiveModesFromStorage();

function saveModesToStorage() {
  localStorage.setItem('tragic_mode_filter', JSON.stringify({
    alleModeActive: filterState.alleModeActive,
    selectedModes: [...filterState.selectedModes]
  }));
}

function updateModeButtons() {
  const btnAll = document.getElementById('btn-mode-all');
  btnAll.classList.toggle('active', filterState.alleModeActive);
  
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    const mode = btn.dataset.mode;
    btn.classList.toggle('active', filterState.selectedModes.has(mode));
  });
}

// "Alle" Button Logik
document.addEventListener('DOMContentLoaded', () => {
  const btnAll = document.getElementById('btn-mode-all');
  
  btnAll.addEventListener('click', () => {
    filterState.alleModeActive = true;
    filterState.selectedModes.clear();
    saveModesToStorage();
    updateModeButtons();
    applyFilters();
  });
});

// Einzelne Mode-Buttons
document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
  const mode = btn.dataset.mode;

  btn.addEventListener('click', () => {
    // Klick auf einzelnen Modus → "Alle" deaktivieren
    filterState.alleModeActive = false;
    
    // Toggle diesen Modus
    if (filterState.selectedModes.has(mode)) {
      filterState.selectedModes.delete(mode);
    } else {
      filterState.selectedModes.add(mode);
    }
    
    saveModesToStorage();
    updateModeButtons();
    applyFilters();
  });
});

// Initial updateModeButtons aufrufen, damit am Start nur "Alle" leuchtet
updateModeButtons();

// ─── Ziel-Filter ────────────────────────────────────────────────────────────

destFilter.addEventListener('input', () => applyFilters());

// ─── Filter anwenden (lokal, kein Netz) ─────────────────────────────────────

function applyFilters() {
  const destQuery = destFilter.value.trim().toLowerCase();

  document.querySelectorAll('#departureBody tr.dep-row').forEach(tr => {
    const mode   = tr.dataset.mode   || 'OTHER';
    const dest   = (tr.dataset.dest  || '').toLowerCase();

    // Mode-Filter: wenn "Alle" aktiv, alles zeigen; sonst nur wenn in selectedModes
    const modeHide = !filterState.alleModeActive && !filterState.selectedModes.has(mode);
    const destHide = destQuery && !dest.includes(destQuery);

    // Nutzen der exakten CSS-Klassen aus style.css
    tr.classList.toggle('filtered-mode', modeHide);
    tr.classList.toggle('filtered-dest', destHide);
  });
}

// ─── Datum / Zeit (URL ↔ Picker) ────────────────────────────────────────────

function getSelectedEpoch() {
  if (!datePicker.value || !timePicker.value) return null;
  const dt = new Date(`${datePicker.value}T${timePicker.value}`);
  return isNaN(dt.getTime()) ? null : Math.floor(dt.getTime() / 1000);
}

function setPickersFromEpoch(epoch) {
  if (!epoch) {
    datePicker.value = '';
    timePicker.value = '';
    return;
  }
  const date = new Date(epoch * 1000);
  const pad2 = n => String(n).padStart(2, '0');
  // Lokale Zeit verwenden, nicht UTC
  datePicker.value = `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
  timePicker.value = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function syncPickersToUrl() {
  const refEpoch = getSelectedEpoch();
  const url = new URL(location.href);
  if (refEpoch) url.searchParams.set('time', refEpoch);
  else          url.searchParams.delete('time');
  // pushState statt replaceState — damit Browser-Zurück funktioniert
  history.pushState({stopId: currentStopId, stationName: currentStationName, epoch: refEpoch}, '', url);
  return refEpoch;
}

const triggerTimeChange = () => {
  if (!currentStopId) return;
  const refEpoch = syncPickersToUrl();
  loadDepartures(refEpoch);
};

datePicker.addEventListener('change', triggerTimeChange);
timePicker.addEventListener('change', triggerTimeChange);

// ─── Navigation Buttons (Früher / Später) ──────────────────────────────────

function setupNavigationButtons() {
  const handleEarlier = () => {
    const currentEpoch = getSelectedEpoch();
    if (!currentEpoch) return;
    const earlierEpoch = currentEpoch - (20 * 60); // 20 Minuten zurück
    setPickersFromEpoch(earlierEpoch);
    triggerTimeChange();
  };

  const handleLater = () => {
    if (allDepartures.length === 0) {
      console.log('Keine Abfahrten vorhanden');
      return;
    }
    // Letzte Fahrt finden
    const lastDep = allDepartures[allDepartures.length - 1];
    console.log('Last departure:', lastDep);
    if (!lastDep) {
      console.log('Keine letzte Fahrt gefunden');
      return;
    }
    
    // scheduled oder live Zeit verwenden
    const lastTime = lastDep.scheduled || lastDep.live;
    if (!lastTime) {
      console.log('Keine Zeit bei letzter Fahrt gefunden');
      return;
    }
    
    // Neue Zeit = letzte Abfahrt - 1 Minute
    const laterEpoch = lastTime - 60;
    console.log('Setting later epoch to:', laterEpoch, 'from:', lastTime);
    setPickersFromEpoch(laterEpoch);
    triggerTimeChange();
  };

  // Beide Button-Paare (oben und unten) registrieren
  const btnEarlierTop = document.getElementById('btn-earlier-top');
  const btnLaterTop = document.getElementById('btn-later-top');
  const btnEarlierBottom = document.getElementById('btn-earlier-bottom');
  const btnLaterBottom = document.getElementById('btn-later-bottom');
  
  if (btnEarlierTop) btnEarlierTop.addEventListener('click', handleEarlier);
  if (btnLaterTop) btnLaterTop.addEventListener('click', handleLater);
  if (btnEarlierBottom) btnEarlierBottom.addEventListener('click', handleEarlier);
  if (btnLaterBottom) btnLaterBottom.addEventListener('click', handleLater);
}

// Nach DOMContentLoaded Buttons setup
document.addEventListener('DOMContentLoaded', () => {
  // Warte kurz, bis alle Elemente geladen sind
  setTimeout(() => {
    setupNavigationButtons();
  }, 100);
  
  updateClock();
  setInterval(updateClock, 1000);

  // Popstate-Event für Browser-Navigation (Zurück/Vorwärts)
  window.addEventListener('popstate', (event) => {
    const state = event.state;
    if (state && state.stopId) {
      currentStopId = state.stopId;
      currentStationName = state.stationName || 'Station wählen';
      updateStationTitle(currentStationName);
      setPickersFromEpoch(state.epoch);
      loadDepartures(state.epoch);
    }
  });
});

// ─── Stationssuche ──────────────────────────────────────────────────────────

document.getElementById('query').addEventListener('input', debounce(async (e) => {
  const q = e.target.value.trim();
  const list = document.getElementById('suggestions');
  list.innerHTML = '';
  if (q.length < 2) return;

  try {
    const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(q)}`);
    const data = await res.json();
    (data.stations || []).forEach(st => {
      if (!st.id) return;
      const li = document.createElement('li');
      li.innerHTML = `${escapeHtml(st.name)} <span class="suggestion-id">(${escapeHtml(st.id)})</span>`;
      li.onclick = () => selectStation(st.id, st.name);
      list.appendChild(li);
    });
  } catch (err) {
    setStatus('Fehler bei der Stationssuche: ' + err.message);
  }
}, 350));

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-box')) {
    document.getElementById('suggestions').innerHTML = '';
  }
});

// ─── Init aus URL ────────────────────────────────────────────────────────────

// Zeit aus URL lesen und sofort in Picker setzen
const urlTimeRaw = params.get('time');
const urlEpoch   = urlTimeRaw && !isNaN(Number(urlTimeRaw)) ? Number(urlTimeRaw) : null;

// Wenn keine Zeit in URL vorhanden ist, aktuelle Zeit verwenden
let initialEpoch = urlEpoch;
if (!initialEpoch) {
  const now = new Date();
  // Lokale Zeit in Epoch umrechnen (timezone-robust)
  initialEpoch = Math.floor(now.getTime() / 1000);
  setPickersFromEpoch(initialEpoch);
} else {
  setPickersFromEpoch(initialEpoch);
}

if (params.get('stopId')) {
  currentStopId = params.get('stopId');
  // currentStationName wird von loadDepartures gesetzt, oder als default
  currentStationName = 'Station wählen';
  updateStationTitle(currentStationName);
  loadDepartures(initialEpoch);
}

// ─── Station Title aktualisieren (in zwei Orten) ────────────────────────────

function updateStationTitle(name) {
  currentStationName = name;
  document.getElementById('stationTitle').textContent = name;
  // Optional: auch im Browser-Tab-Titel anzeigen
  document.title = name + ' | OMNI (NOWE)';
}

// ─── Station auswählen ───────────────────────────────────────────────────────

function selectStation(stopId, name, refEpoch) {
  currentStopId = stopId;
  currentStationName = name;
  updateStationTitle(name);
  document.getElementById('suggestions').innerHTML = '';
  document.getElementById('query').value = '';

  // Nur wenn refEpoch explizit übergeben wurde, die Picker setzen.
  // Sonst: aktuelle Picker-Werte bewahren (der Benutzer hat sie ja gerade gesetzt)
  if (refEpoch !== undefined) {
    setPickersFromEpoch(refEpoch);
  }

  const url = new URL(location.href);
  url.searchParams.set('stopId', stopId);
  // Aktuelle Picker-Werte in die URL schreiben
  const currentEpoch = getSelectedEpoch();
  if (currentEpoch) url.searchParams.set('time', currentEpoch);
  else              url.searchParams.delete('time');
  // pushState für History — ermöglicht Browser-Zurück
  history.pushState({stopId, stationName: name, epoch: currentEpoch}, '', url);

  loadDepartures(currentEpoch);
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// ─── Abfahrten laden ─────────────────────────────────────────────────────────

async function loadDepartures(refEpoch) {
  if (!currentStopId) return;
  setStatus('Lade Abfahrten…');

  if (refEpoch === undefined) {
    refEpoch = getSelectedEpoch();
  }

  try {
    let q = `${PROXY}?action=departures&stopId=${encodeURIComponent(currentStopId)}&n=25`;
    if (refEpoch) {
      q += `&time=${encodeURIComponent(new Date(refEpoch * 1000).toISOString())}`;
    }
    const res = await fetch(q);
    const data = await res.json();

    if (data.error) {
      renderError(data.error);
      setStatus('');
      updateNavButtonsVisibility();
      return;
    }

    allDepartures = data.departures || [];
    renderDepartures(allDepartures);
    setStatus(refEpoch
      ? 'Abfahrten ab ausgewähltem Zeitpunkt · ' + new Date().toLocaleTimeString('de-CH')
      : 'Aktualisiert: ' + new Date().toLocaleTimeString('de-CH'));
    
    updateNavButtonsVisibility();
  } catch (err) {
    renderError(err.message);
    updateNavButtonsVisibility();
  }

  clearTimeout(refreshTimer);
  if (!refEpoch) refreshTimer = setTimeout(() => loadDepartures(null), 30000);
}

// ─── Navigation Buttons anzeigen/verstecken ────────────────────────────────

function updateNavButtonsVisibility() {
  const isVisible = allDepartures.length > 0;
  document.getElementById('nav-buttons-top').style.display = isVisible ? 'flex' : 'none';
  document.getElementById('nav-buttons-bottom').style.display = isVisible ? 'flex' : 'none';
}

// ─── Rendern ─────────────────────────────────────────────────────────────────

function renderError(msg) {
  document.getElementById('departureTable').style.display = 'none';
  document.getElementById('status').innerHTML = `<div class="error-hint">Fehler: ${escapeHtml(msg)}</div>`;
}

function getModeIcon(mode) {
  if (!mode) return '';
  const m = mode.toUpperCase();
  if (m === 'TRAM') return 'T';
  if (m === 'BUS')  return 'B';
  return '';
}

function renderDepartures(departures) {
  const tbody = document.getElementById('departureBody');
  tbody.innerHTML = '';
  document.getElementById('departureTable').style.display = departures.length ? 'table' : 'none';

  if (!departures.length) {
    document.getElementById('status').innerHTML = '<div class="empty-hint">Keine Abfahrten gefunden.</div>';
    return;
  }

  departures.forEach(dep => {
    const tr = document.createElement('tr');
    tr.className = 'dep-row';

    // SOLL-Zeit anzeigen (scheduled), NICHT live
    const timeStr = dep.scheduled
      ? new Date(dep.scheduled * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit'})
      : '–';

    // Verspätungs-Badge
    let delayHtml = '';
    if (dep.cancelled) {
      delayHtml = '<span class="cancelled">Ausfall</span>';
    } else if (dep.delaySec !== null && dep.delaySec !== undefined && dep.delaySec > 30) {
      delayHtml = `<span class="delay">${fmtDelay(dep.delaySec)}</span>`;
    } else if (dep.delaySec !== null && dep.delaySec !== undefined && dep.delaySec < -30) {
      delayHtml = `<span class="vbz-delay">${fmtDelay(dep.delaySec)}</span>`;
    }

    const iconHtml = getModeIcon(dep.mode);

    // data-Attribute für Filter — kanonischen Mode speichern, nicht Rohwert
    tr.dataset.mode = canonicalMode(dep.mode);
    tr.dataset.dest = dep.destination || '';

    tr.innerHTML = `
      <td class="col-time">${timeStr}<br><span class="delay-badge">${delayHtml}</span></td>
      <td class="col-line">
        <div class="line-container"><span class="line">${iconHtml}${escapeHtml(dep.line)}</span></div>
        <div class="col-nr tripnr">${dep.tripNumber ? escapeHtml(dep.tripNumber) : ''}</div>
      </td>
      <td class="col-dest">${escapeHtml(dep.destination)}</td>
      <td class="col-platform">${escapeHtml(dep.track)}</td>
    `;
    tr.onclick = () => toggleChain(tr, dep);
    tbody.appendChild(tr);
  });

  // Filter nach dem Rendern sofort anwenden
  applyFilters();
}

// ─── Fahrt-Chain ─────────────────────────────────────────────────────────────

async function toggleChain(tr, dep) {
  const existing = tr.nextElementSibling;
  if (existing && existing.classList.contains('chain-row')) {
    existing.remove();
    return;
  }
  document.querySelectorAll('.chain-row').forEach(r => r.remove());

  if (!dep.tripId) {
    alert('Keine Fahrtnummer (tripId) vorhanden – Fahrtverlauf nicht möglich.');
    return;
  }

  const chainTr = document.createElement('tr');
  chainTr.className = 'chain-row';
  const td = document.createElement('td');
  td.colSpan = 5;
  td.innerHTML = '<div class="chain-wrap"><div class="chain-header">Lade Fahrtverlauf…</div></div>';
  chainTr.appendChild(td);
  tr.after(chainTr);

  try {
    const res = await fetch(`${PROXY}?action=trip&tripId=${encodeURIComponent(dep.tripId)}`);
    const data = await res.json();

    if (data.error) {
      td.innerHTML = `<div class="chain-wrap"><div class="chain-header">Fehler: ${escapeHtml(data.error)}</div></div>`;
      return;
    }

    td.innerHTML = `<div class="chain-wrap">${renderChain(data)}</div>`;
  } catch (err) {
    td.innerHTML = `<div class="chain-wrap"><div class="chain-header">Fehler beim Laden: ${escapeHtml(err.message)}</div></div>`;
  }
}

function renderChain(data) {
  const stopsHtml = (data.stops || []).map(stop => {
    // SOLL-Zeiten im Chain: scheduled, mit live-Delay als Badge
    const arrDisp = stop.arrivalSched   ? fmtTime(stop.arrivalSched)   : null;
    const depDisp = stop.departureSched ? fmtTime(stop.departureSched) : null;
    const times = [
      arrDisp ? 'An ' + arrDisp : null,
      depDisp ? 'Ab ' + depDisp : null,
    ].filter(Boolean).join(' · ');

    const delaySec = stop.departureDelaySec ?? stop.arrivalDelaySec;
    const delayHtml = stop.cancelled
      ? '<span class="cancelled">Ausfall</span>'
      : (delaySec && Math.abs(delaySec) > 30 ? `<span class="delay">${fmtDelay(delaySec)}</span>` : '');

    // Referenzzeit für "klick auf Stop" = SOLL-Ankunft (damit die Abfahrtstafel korrekt startet)
    const refEpoch = stop.arrivalSched || stop.arrivalLive;
    const isLink = !!stop.stopId;
    const nameAttrs = isLink
      ? `onclick="selectStation('${escapeAttr(stop.stopId)}','${escapeAttr(stop.name)}',${refEpoch || 'null'})"`
      : '';

    return `
      <div class="stop${stop.cancelled ? ' cancelled-stop' : ''}">
        <div class="stop-dot"></div>
        <div>
          <div class="stop-name${isLink ? '' : ' no-link'}" ${nameAttrs}>${escapeHtml(stop.name)}</div>
          <div class="stop-times">${escapeHtml(times || '–')}</div>
        </div>
        <div class="stop-right">
          ${delayHtml}
          ${stop.track ? `<div class="stop-track">Gl. ${escapeHtml(stop.track)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="chain-header">
      <b>Linie ${escapeHtml(data.line || '?')}${data.destination ? ' → ' + escapeHtml(data.destination) : ''}</b>${data.tripNumber ? ' · Fahrt: ' + escapeHtml(data.tripNumber) : ''}
    </div>
    <div class="timeline">${stopsHtml}</div>`;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function fmtTime(epoch) {
  if (!epoch) return '–';
  return new Date(epoch * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

function fmtDelay(sec) {
  const sign = sec < 0 ? '-' : '+';
  const abs  = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${String(s).padStart(2,'0')}`;
}

function setStatus(msg) { document.getElementById('status').textContent = msg; }

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[\\'"]/g, c => '\\' + c);
}
function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ─── Uhr ─────────────────────────────────────────────────────────────────────

function updateClock() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  const now = new Date();
  el.textContent =
    String(now.getHours()).padStart(2,'0') + ':' +
    String(now.getMinutes()).padStart(2,'0') + ':' +
    String(now.getSeconds()).padStart(2,'0');
}