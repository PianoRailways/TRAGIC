const PROXY = 'proxy.php';
let currentStopId = null;
let currentStationName = null;
let currentMainStationId = null; // Merke die echte Haupt-Station für Labeling
let refreshTimer = null;
let allDepartures = [];
let abbrevMap = {}; // Abkürzungs-Mapping (alle Länder kombiniert)

const params = new URLSearchParams(location.search);
const datePicker = document.getElementById('datePicker');
const timePicker = document.getElementById('timePicker');
const destFilter = document.getElementById('destFilter');

// ─── Combined Stations laden (mehrere Quellen) ──────────────────────────────

async function loadCombinedStations() {
  const urls = [
    'https://nowe.stellwerksim.ch/combinedstations.js',
    // Weitere URLs hier hinzufügen:
    // 'https://example.com/combined-stations-2.js',
    // 'https://another-server.com/stations.js',
  ];
  
  // Temp object um alle Daten zu sammeln
  const tempMerged = {};
  let loadedCount = 0;
  
  for (const url of urls) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
          console.log(`combinedStations loaded from ${url}`);
          
          // Merge die geladenen Daten ins temp object
          if (window.combinedStations && typeof window.combinedStations === 'object') {
            Object.assign(tempMerged, window.combinedStations);
            loadedCount++;
          }
          
          resolve();
        };
        script.onerror = () => {
          console.warn(`Failed to load combinedStations from ${url}`);
          resolve(); // Weiterfahren auch bei Fehler
        };
        document.head.appendChild(script);
      });
    } catch (err) {
      console.error(`Error loading combinedStations from ${url}:`, err);
    }
  }
  
  // Setze das finale merged object
  window.combinedStations = tempMerged;
  window.combinedStationsReady = loadedCount > 0;
  
  console.log(`Loaded combinedStations from ${loadedCount}/${urls.length} sources, total entries: ${Object.keys(window.combinedStations).length}`);
}

// Get all related stations for a given station (by name, not ID)
function getRelatedStations(stationName) {
  if (!window.combinedStations || !window.combinedStations[stationName]) {
    return [stationName]; // Return only the station itself if not in combinedStations
  }
  return window.combinedStations[stationName];
}

// Resolve a station name to its stopId via search
async function resolveStationNameToId(stationName) {
  try {
    const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(stationName)}`);
    const data = await res.json();
    const stations = data.stations || [];
    
    // Find exact match or first result
    const match = stations.find(s => s.name.toLowerCase() === stationName.toLowerCase()) || stations[0];
    return match ? match.id : null;
  } catch (err) {
    console.error(`Error resolving station "${stationName}":`, err);
    return null;
  }
}

// Fetch departures for multiple stations and merge them
async function fetchCombinedDepartures(stopId, stationName, refEpoch, numResults = 25) {
  const relatedStationNames = getRelatedStations(stationName);
  
  console.log(`Fetching departures for ${relatedStationNames.length} station(s):`, relatedStationNames);
  
  const allDeps = [];
  
  // Fetch departures for each related station
  for (const station of relatedStationNames) {
    try {
      // First resolve station name to stopId
      const stationStopId = await resolveStationNameToId(station);
      
      if (!stationStopId) {
        console.warn(`Could not resolve stopId for station: ${station}`);
        continue;
      }
      
      let q = `${PROXY}?action=departures&stopId=${encodeURIComponent(stationStopId)}&n=${numResults}`;
      if (refEpoch) {
        q += `&time=${encodeURIComponent(new Date(refEpoch * 1000).toISOString())}`;
      }
      
      const res = await fetch(q);
      const data = await res.json();
      
      if (data.error) {
        console.warn(`Failed to fetch departures for ${station}:`, data.error);
        continue;
      }
      
      if (data.departures && Array.isArray(data.departures)) {
        // Add the actual station name to each departure for later labeling
        const departuresWithStation = data.departures.map(dep => ({
          ...dep,
          _fromStation: station,
          _isMainStation: station === stationName
        }));
        allDeps.push(...departuresWithStation);
      }
    } catch (err) {
      console.error(`Error fetching departures for ${station}:`, err);
    }
  }
  
  // Sort all departures by scheduled time
  allDeps.sort((a, b) => {
    const timeA = a.scheduled || Infinity;
    const timeB = b.scheduled || Infinity;
    return timeA - timeB;
  });
  
  // Limit to numResults
  return allDeps.slice(0, numResults);
}

// ─── Abkürzungs-Mappings laden ──────────────────────────────────────────────

async function loadAbbreviations() {
  const countries = ['ch', 'de', 'at', 'fr'];
  try {
    for (const country of countries) {
      try {
        const res = await fetch(`/didok/${country}.json`);
        if (res.ok) {
          const data = await res.json();
          // Merge ins globale Map (mit Prefix um Konflikte zu tracken)
          Object.entries(data).forEach(([abbrev, name]) => {
            if (!abbrevMap[abbrev]) {
              abbrevMap[abbrev] = [];
            }
            abbrevMap[abbrev].push({ name, country: country.toUpperCase() });
          });
        }
      } catch (e) {
        console.warn(`Konnte /didok/${country}.json nicht laden:`, e);
      }
    }
    console.log('Abkürzungs-Mappings geladen:', Object.keys(abbrevMap).length, 'Abkürzungen');
  } catch (err) {
    console.error('Fehler beim Laden der Abkürzungs-Mappings:', err);
  }
}

// Beim Start laden
document.addEventListener('DOMContentLoaded', () => {
  loadAbbreviations();
  loadCombinedStations();
});

// ─── Modus-Filter (localStorage-persistent) ────────────────────────────────

// Kanonische Gruppen: welche API-modes gehören zu welchem Button
const MODE_GROUPS = {
  HIGHSPEED: ['HIGHSPEEDRAIL', 'HIGHSPEED_RAIL', 'INTERCITYRAIL', 'LONGDISTANCERAIL', 'LONG_DISTANCE'],
  RAIL: ['TRAIN', 'RAIL', 'COACHRAILWAY', 'LOCALTRAIN', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN'],
  NIGHT: ['NIGHTRAIL', 'NIGHT_RAIL'],
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
    // Letzte Fahrt finden (nach scheduled sortiert)
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

  const btnJetzt = document.getElementById('btn-jetzt');
  if (btnJetzt) btnJetzt.addEventListener('click', setCurrentTime);
  // btn-refresh ist bereits vorhanden, aber ändere seinen Handler:
  document.getElementById('btn-refresh').addEventListener('click', reloadDepartures);
});

// ─── Stationssuche mit Abkürzungs-Mapping ──────────────────────────────────

document.getElementById('query').addEventListener('input', debounce(async (e) => {
  const q = e.target.value.trim();
  const list = document.getElementById('suggestions');
  list.innerHTML = '';
  if (q.length < 2) return;
 
  try {
    // 1. Abkürzungs-Matches sammeln
    const abbrevMatches = [];
    const qUpper = q.toUpperCase();
    if (abbrevMap[qUpper]) {
      // Für jede Abkürzung: Station-Name suchen und ID auflösen
      for (const match of abbrevMap[qUpper]) {
        // Versuche, die Station über den Namen zu finden
        try {
          const searchRes = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(match.name)}`);
          const searchData = await searchRes.json();
          const station = (searchData.stations || []).find(s => s.name.toLowerCase() === match.name.toLowerCase());
          
          if (station) {
            abbrevMatches.push({
              id: station.id,
              name: match.name,
              abbrev: qUpper,
              country: match.country,
              source: 'abbrev'
            });
          }
        } catch (_) {}
      }
    }
 
    // 2. API-Call
    const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(q)}`);
    const data = await res.json();
    const apiMatches = (data.stations || []).map(st => ({
      id: st.id,
      name: st.name,
      abbrev: null,
      country: null,
      source: 'api'
    }));
 
    // 3. Abkürzungs-Matches zuerst, dann API (ohne Duplikate)
    const seen = new Set();
    const allMatches = [...abbrevMatches, ...apiMatches];
    
    allMatches.forEach(match => {
      const key = (match.id || match.name).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
 
      const li = document.createElement('li');
      let html = escapeHtml(match.name);
      
      // Abkürzungs-Label anhängen
      if (match.abbrev) {
        html += ` <span class="abbrev-label">${escapeHtml(match.abbrev)} [${escapeHtml(match.country)}]</span>`;
      }
      
      // Station ID anhängen
      if (match.id) {
        html += ` <span class="suggestion-id">(${escapeHtml(match.id)})</span>`;
      }
      
      li.innerHTML = html;
      li.onclick = () => selectStation(match.id, match.name, null);
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
  // Wenn stopId null ist (Abkürzungs-Match), suche die Station über die API
  if (stopId === null) {
    // Versuche, die Station zu finden
    selectStationByName(name, refEpoch);
    return;
  }

  currentStopId = stopId;
  currentStationName = name;
  currentMainStationId = stopId; // Merke die Haupt-Station für Combined-Labeling
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

// Hilfsfunktion: Suche Station nach Name über API
async function selectStationByName(name, refEpoch) {
  try {
    const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(name)}`);
    const data = await res.json();
    const stations = data.stations || [];
    
    if (stations.length === 0) {
      alert(`Station "${name}" nicht gefunden.`);
      return;
    }
    
    // Nimm die erste exakte Übereinstimmung oder die erste Option
    const match = stations.find(s => s.name.toLowerCase() === name.toLowerCase()) || stations[0];
    selectStation(match.id, match.name, refEpoch);
  } catch (err) {
    alert('Fehler bei der Stationssuche: ' + err.message);
  }
}

// ─── Abfahrten laden (mit Combined Stations) ────────────────────────────────

async function loadDepartures(refEpoch) {
  if (!currentStopId) return;
  setStatus('Lade Abfahrten…');

  if (refEpoch === undefined) {
    refEpoch = getSelectedEpoch();
  }

  try {
    // Use fetchCombinedDepartures if combinedStations are available
    // Falls nicht: fallback auf alte Methode mit stopId
    let departures;
    
    if (window.combinedStationsReady && window.combinedStations && window.combinedStations[currentStationName]) {
      console.log('Using combined departures for:', currentStationName);
      departures = await fetchCombinedDepartures(currentStopId, currentStationName, refEpoch, 25);
    } else {
      // Fallback: Nur von der Haupt-Station laden (alte Methode)
      console.log('Using single station departures for:', currentStationName);
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

      departures = data.departures || [];
      // Markiere als von Haupt-Station (für Labeling)
      departures = departures.map(dep => ({
        ...dep,
        _fromStation: currentStationName,
        _isMainStation: true
      }));
    }

    allDepartures = departures;
    renderDepartures(allDepartures);
    setStatus(refEpoch
      ? 'Abfahrten ab ausgewähltem Zeitpunkt · ' + timePicker.value
      : 'Aktualisiert um: ' + new Date().toLocaleTimeString('de-CH'));
    
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
  // Sortiere nach Fahrplanzeit (scheduled), nicht nach Live-Zeit
  const sorted = [...departures].sort((a, b) => {
    const timeA = a.scheduled || Infinity;
    const timeB = b.scheduled || Infinity;
    return timeA - timeB;
  });

  sorted.forEach(dep => {
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
    } else if (dep.delaySec !== null && dep.delaySec !== undefined) {
      const delayMin = Math.floor(dep.delaySec / 60);
      if (delayMin < 0) {
        delayHtml = `<span class="vbz-delay">${fmtDelay(dep.delaySec)}</span>`;
      } else if (delayMin > 0) {
        delayHtml = `<span class="delay">${fmtDelay(dep.delaySec)}</span>`;
      }
    }

    const iconHtml = getModeIcon(dep.mode);

    // data-Attribute für Filter — kanonischen Mode speichern, nicht Rohwert
    tr.dataset.mode = canonicalMode(dep.mode);
    tr.dataset.dest = dep.destination || '';
    tr.dataset.trip = dep.tripNumber || '';

    // "ab xyz" Label nur wenn nicht von Haupt-Station
    let stationLabelHtml = '';
    if (dep._fromStation && !dep._isMainStation) {
      stationLabelHtml = `<div class="station-hint">ab ${escapeHtml(dep._fromStation)}</div>`;
    }

    tr.innerHTML = `
      <td class="col-time">${timeStr}<br><span class="delay-badge">${delayHtml}</span></td>
      <td class="col-line">
        <div class="line-container" data-mode="${canonicalMode(dep.mode)}" data-agency-id="${escapeHtml(dep.agencyId || '')}" data-line="${escapeHtml(dep.line || '')}" data-route-id="${escapeHtml(dep.routeId || '')}"><span class="line">${iconHtml}${escapeHtml(dep.line)}</span></div>
        <div class="col-nr tripnr">${dep.tripNumber ? escapeHtml(dep.tripNumber.replace(/^0+(?=\d)/, '')) : ''}</div>
      </td>
      <td class="col-dest">${escapeHtml(dep.destination)}${stationLabelHtml}</td>
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
const stopsHtml = (data.stops || []).map((stop, i) => {
  const isLast = i === (data.stops.length - 1);
  const isFirst = i === 0;
  
  // Zeiten formatieren (SOLL-Zeit, wie in der Haupttafel)
  const arrDisp = stop.arrivalSched   ? fmtTime(stop.arrivalSched)   : null;
  const depDisp = stop.departureSched ? fmtTime(stop.departureSched) : null;
  
  // Verspätungs-Badges
  const arrDelayHtml = stop.cancelled
    ? '<span class="cancelled">Ausfall</span>'
    : (stop.arrivalDelaySec !== null && stop.arrivalDelaySec !== undefined
        ? (Math.floor(stop.arrivalDelaySec / 60) < 0
            ? `<span class="vbz-delay">${fmtDelay(stop.arrivalDelaySec)}</span>`
            : Math.abs(stop.arrivalDelaySec) > 30
              ? `<span class="delay">${fmtDelay(stop.arrivalDelaySec)}</span>`
              : '')
        : '');
  
  const depDelayHtml = stop.cancelled
    ? '<span class="cancelled">Ausfall</span>'
    : (stop.departureDelaySec !== null && stop.departureDelaySec !== undefined
        ? (Math.floor(stop.departureDelaySec / 60) < 0
            ? `<span class="vbz-delay">${fmtDelay(stop.departureDelaySec)}</span>`
            : Math.abs(stop.departureDelaySec) > 30
              ? `<span class="delay">${fmtDelay(stop.departureDelaySec)}</span>`
              : '')
        : '');
  
  // Gleis
  let platHtml = '';
  if (stop.track) {
    platHtml = `Gl. ${escapeHtml(stop.track)}`;
  }
 
  // ─── SD/SM Boarding Badges ───
  let boardingBadge = '';
  const noPickup  = stop.pickupType === 'NOT_ALLOWED' || stop.pickupType === 'MUST_PHONE' || stop.pickupType === 'COORDINATE_WITH_DRIVER';
  const noDropoff = stop.dropoffType === 'NOT_ALLOWED' || stop.dropoffType === 'MUST_PHONE' || stop.dropoffType === 'COORDINATE_WITH_DRIVER';
 
  if (noPickup && !noDropoff) {
    boardingBadge = '<span class="boarding-badge badge-sd" title="Halt nur zum Aussteigen">SD</span>';
  } else if (noDropoff && !noPickup) {
    boardingBadge = '<span class="boarding-badge badge-sm" title="Halt nur zum Einsteigen">SM</span>';
  }
  
  // Ausfall-Status
  const stopNameStyle = stop.cancelled 
    ? 'text-decoration: line-through; color: #555;' 
    : '';
  
  // Dot-Styling (ausgefallene Halte grau)
  const dotStyle = stop.cancelled 
    ? ' style="background:#555;"' 
    : '';
  
  // Referenzpunkt für "klick auf Stop" = SOLL-Ankunft
  const refEpoch = stop.arrivalSched || stop.arrivalLive;
  const isClickable = !!stop.stopId;
  const clickAttrs = isClickable
    ? `onclick="selectStation('${escapeAttr(stop.stopId)}','${escapeAttr(stop.name)}',${refEpoch || 'null'})"`
    : '';
  
  // Leg-Wechsel prüfen: wenn diesen Stop ein anderes Leg hat als der vorherige
  let legSeparatorHtml = '';
  if (i > 0) {
    const prevStop = data.stops[i - 1];
    const currentLegIndex = stop.legIndex ?? 0;
    const prevLegIndex = prevStop.legIndex ?? 0;
    
    if (currentLegIndex !== prevLegIndex) {
      // Leg-Wechsel! Separator vor diesem Stop einfügen
      legSeparatorHtml = `
        <div class="chain-leg-separator">
          <div class="separator-text">
            ↓ Fährt weiter von <strong>${escapeHtml(prevStop.name)}</strong> nach <strong>${escapeHtml(stop.name)}</strong>
          </div>
        </div>
      `;
    }
  }
  
  return legSeparatorHtml + `
    <div class="chain-stop${stop.cancelled ? ' chain-cancelled' : ''}${isClickable ? ' chain-clickable' : ''}" ${clickAttrs}>
      
      <!-- Dot-Spalte mit Linie -->
      <div class="chain-dot-col">
        <div class="chain-dot-wrapper">
          <div class="chain-dot${isFirst ? ' dot-first' : ''}"${dotStyle}></div>
        </div>
        ${!isLast ? `
          <div class="chain-line-wrapper">
            <div class="chain-line"${stop.cancelled ? ' style="background:rgba(255,255,255,0.05);"' : ''}></div>
          </div>
        ` : ''}
      </div>
      
      <!-- Zeit-Spalte -->
      <div class="chain-times">
        ${arrDisp ? `<div class="time-row"><span class="label">An</span> <span class="time-val">${escapeHtml(arrDisp)}</span>${arrDelayHtml}</div>` : '<div class="time-row">&nbsp;</div>'}
        ${depDisp ? `<div class="time-row"><span class="label">Ab</span> <span class="time-val">${escapeHtml(depDisp)}</span>${depDelayHtml}</div>` : '<div class="time-row">&nbsp;</div>'}
      </div>
      
      <!-- Info-Spalte (Halte + Gleis) -->
      <div class="chain-info">
        <div class="chain-name" style="${stopNameStyle}">${escapeHtml(stop.name)}</div>
        ${platHtml ? `<div class="chain-platform">${escapeHtml(platHtml)}</div>` : ''}
      </div>
    </div>
  `;
}).join('');
  
  const tripIdHtml = data.tripId ? `<div class="trip-id-row">Trip-ID: <code title="${escapeHtml(data.tripId)}" onclick="navigator.clipboard.writeText('${data.tripId.replace(/'/g, "\\'")}'); this.innerText='✅ Kopiert!'; setTimeout(() => this.innerText='${escapeHtml(data.tripId).replace(/'/g, "\\'")}', 1500);">${escapeHtml(data.tripId)}</code></div>` : '';
  const BetreiberHTML = (data.agency && (data.agency.name || data.agency.id))
  ? `<div class="agency-row">Betreiber: ${
      data.agency.url 
        ? `<a href="${escapeHtml(data.agency.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(data.agency.name || 'Unbekannt')}${data.agency.id ? ` [${escapeHtml(data.agency.id)}]` : ''}</a>`
        : `${escapeHtml(data.agency.name || 'Unbekannt')}${data.agency.id ? ` [${escapeHtml(data.agency.id)}]` : ''}`
    }</div>`
  : '';
  
  return `
    <div class="chain-header">
      <b>Linie ${escapeHtml(data.line || '?')}${data.destination ? ' → ' + escapeHtml(data.destination) : ''}</b>${data.tripNumber ? ' · ' + escapeHtml(data.tripNumber) : ''}
    </div>
    <div class="chain">
      ${stopsHtml}
    </div>
    ${tripIdHtml}
    ${BetreiberHTML}
  `;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function fmtTime(epoch) {
  if (!epoch) return '–';
  return new Date(epoch * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit'});
}

function fmtDelay(sec) {
  const sign = sec < 0 ? '-' : '+';
  const abs  = Math.abs(sec);
  const m = Math.floor(abs / 60);
  return `${sign}${m}`;
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

// ─── JETZT Button: Aktuelle Zeit setzen ────────────────────────────────────

function setCurrentTime() {
  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  
  // Lokale Zeit in Picker setzen
  datePicker.value = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`;
  timePicker.value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  
  // URL aktualisieren und Abfahrten laden
  triggerTimeChange();
}

// ─── GO Button: Abfahrten neu laden ────────────────────────────────────────

function reloadDepartures() {
  const currentEpoch = getSelectedEpoch();
  if (!currentStopId) return;
  loadDepartures(currentEpoch);
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