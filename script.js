const PROXY = 'proxy.php';
let currentStopId = null;
let currentStationName = null;
let currentMainStationId = null; // Merke die echte Haupt-Station für Labeling
let refreshTimer = null;
let allDepartures = [];
let abbrevMap = {}; // Abkürzungs-Mapping (alle Länder kombiniert)
let nameToAbbrevMap = {}; // Reverse Mapping (Name -> Abkürzungen)

const params = new URLSearchParams(location.search);
let isArrivalsMode = params.get('arrivals') === 'true';

const datePicker = document.getElementById('datePicker');
const timePicker = document.getElementById('timePicker');
const destFilter = document.getElementById('destFilter');

// ─── Combined Stations laden (mehrere Quellen) ──────────────────────────────

async function loadCombinedStations() {
  const urls = [
    'https://nowe.stellwerksim.ch/combinedstations.js',
    'https://tragic.stellwerksim.ch/combinedTRAGIC.js',
  ];
  
  const tempMerged = {};
  let loadedCount = 0;
  
  for (const url of urls) {
    try {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
          console.log(`combinedStations loaded from ${url}`);
          
          if (window.combinedStations && typeof window.combinedStations === 'object') {
            Object.assign(tempMerged, window.combinedStations);
            loadedCount++;
          }
          
          resolve();
        };
        script.onerror = () => {
          console.warn(`Failed to load combinedStations from ${url}`);
          resolve();
        };
        document.head.appendChild(script);
      });
    } catch (err) {
      console.error(`Error loading combinedStations from ${url}:`, err);
    }
  }
  
  window.combinedStations = tempMerged;
  window.combinedStationsReady = loadedCount > 0;
  
  console.log(`Loaded combinedStations from ${loadedCount}/${urls.length} sources, total entries: ${Object.keys(window.combinedStations).length}`);
}

function getRelatedStations(stationName) {
  if (!window.combinedStations || !window.combinedStations[stationName]) {
    return [stationName];
  }
  return window.combinedStations[stationName];
}

async function resolveStationNameToId(stationName) {
  try {
    const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(stationName)}`);
    const data = await res.json();
    const stations = data.stations || [];
    
    const match = stations.find(s => s.name.toLowerCase() === stationName.toLowerCase()) || stations[0];
    return match ? match.id : null;
  } catch (err) {
    console.error(`Error resolving station "${stationName}":`, err);
    return null;
  }
}

async function fetchCombinedDepartures(stopId, stationName, refEpoch, numResults = 25) {
  const relatedStationNames = getRelatedStations(stationName);
  
  console.log(`Fetching data for ${relatedStationNames.length} station(s):`, relatedStationNames);
  
  const allDeps = [];
  
  for (const station of relatedStationNames) {
    try {
      const stationStopId = await resolveStationNameToId(station);
      
      if (!stationStopId) {
        console.warn(`Could not resolve stopId for station: ${station}`);
        continue;
      }
      
      let q = `${PROXY}?action=departures&stopId=${encodeURIComponent(stationStopId)}&n=${numResults}`;
      if (isArrivalsMode) q += '&arrivals=true';
      if (refEpoch) {
        q += `&time=${encodeURIComponent(new Date(refEpoch * 1000).toISOString())}`;
      }
      
      const res = await fetch(q);
      const data = await res.json();
      
      if (data.error) {
        console.warn(`Failed to fetch data for ${station}:`, data.error);
        continue;
      }
      
      if (data.departures && Array.isArray(data.departures)) {
        const departuresWithStation = data.departures.map(dep => ({
          ...dep,
          _fromStation: station,
          _isMainStation: station === stationName
        }));
        allDeps.push(...departuresWithStation);
      }
    } catch (err) {
      console.error(`Error fetching data for ${station}:`, err);
    }
  }
  
  allDeps.sort((a, b) => {
    const timeA = a.scheduled || Infinity;
    const timeB = b.scheduled || Infinity;
    return timeA - timeB;
  });
  
  return allDeps.slice(0, numResults);
}

// ─── Abkürzungs-Mappings laden ──────────────────────────────────────────────

async function loadAbbreviations() {
  const countries = ['custom', 'ch', 'de', 'at', 'fr', 'uk'];
  try {
    for (const country of countries) {
      try {
        const res = await fetch(`/didok/${country}.json`);
        if (res.ok) {
          const data = await res.json();
          Object.entries(data).forEach(([abbrev, name]) => {
            if (!abbrevMap[abbrev]) {
              abbrevMap[abbrev] = [];
            }
            const countryCode = country.toUpperCase();
            abbrevMap[abbrev].push({ name, country: countryCode });

            // Reverse-Map für schnellen Lookup nach Name aufbauen
            const normName = name.trim().toLowerCase();
            if (!nameToAbbrevMap[normName]) {
              nameToAbbrevMap[normName] = [];
            }
            nameToAbbrevMap[normName].push({ abbrev, country: countryCode });
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

function getAbbrevsForName(stationName) {
  if (!stationName) return [];
  const normName = stationName.trim().toLowerCase();
  return nameToAbbrevMap[normName] || [];
}

document.addEventListener('DOMContentLoaded', () => {
  loadAbbreviations();
  loadCombinedStations();
});

// ─── Modus-Filter (localStorage-persistent) ────────────────────────────────

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
  if (btnAll) btnAll.classList.toggle('active', filterState.alleModeActive);
  
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    const mode = btn.dataset.mode;
    btn.classList.toggle('active', filterState.selectedModes.has(mode));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const btnAll = document.getElementById('btn-mode-all');
  if (btnAll) {
    btnAll.addEventListener('click', () => {
      filterState.alleModeActive = true;
      filterState.selectedModes.clear();
      saveModesToStorage();
      updateModeButtons();
      applyFilters();
    });
  }
});

document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
  const mode = btn.dataset.mode;

  btn.addEventListener('click', () => {
    filterState.alleModeActive = false;
    
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

updateModeButtons();

// ─── Ankunft / Abfahrt Modus-Umschaltung ───────────────────────────────────

function toggleArrivalMode() {
  isArrivalsMode = !isArrivalsMode;
  updateArrivalToggleUI();
  const refEpoch = syncPickersToUrl();
  loadDepartures(refEpoch);
}

function updateArrivalToggleUI() {
  const titleEl = document.getElementById('app-title');
  const thTime = document.getElementById('th-col-time');
  const thDest = document.getElementById('th-col-dest');
  
  if (titleEl) {
    titleEl.textContent = isArrivalsMode ? 'öV OMNI (An)' : 'öV OMNI';
  }
  if (thTime) {
    thTime.textContent = isArrivalsMode ? 'An' : 'Ab';
  }
  if (thDest) {
    thDest.textContent = isArrivalsMode ? 'Von' : 'Ziel';
  }
}

// ─── Ziel-Filter ────────────────────────────────────────────────────────────

if (destFilter) {
  destFilter.addEventListener('input', () => applyFilters());
}

function applyFilters() {
  const destQuery = destFilter ? destFilter.value.trim().toLowerCase() : '';

  document.querySelectorAll('#departureBody tr.dep-row').forEach(tr => {
    const mode   = tr.dataset.mode   || 'OTHER';
    const dest   = (tr.dataset.dest  || '').toLowerCase();
    const line   = (tr.dataset.line  || '').toLowerCase();
    const trip   = (tr.dataset.trip  || '').toLowerCase();
    const agencyId   = (tr.dataset.agencyId   || '').toLowerCase();
    const agencyName = (tr.dataset.agencyName || '').toLowerCase();
    const tripId     = (tr.dataset.tripId     || '').toLowerCase();

    const modeHide = !filterState.alleModeActive && !filterState.selectedModes.has(mode);
    
    const destHide = destQuery && 
      !dest.includes(destQuery) && 
      !line.includes(destQuery) && 
      !trip.includes(destQuery) && 
      !agencyId.includes(destQuery) && 
      !agencyName.includes(destQuery) && 
      !tripId.includes(destQuery);

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
  if (!datePicker || !timePicker) return;
  if (!epoch) {
    datePicker.value = '';
    timePicker.value = '';
    return;
  }
  const date = new Date(epoch * 1000);
  const pad2 = n => String(n).padStart(2, '0');
  datePicker.value = `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
  timePicker.value = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function syncPickersToUrl() {
  const refEpoch = getSelectedEpoch();
  const url = new URL(location.href);
  if (refEpoch) url.searchParams.set('time', refEpoch);
  else          url.searchParams.delete('time');

  if (isArrivalsMode) url.searchParams.set('arrivals', 'true');
  else                url.searchParams.delete('arrivals');

  history.pushState({
    stopId: currentStopId, 
    stationName: currentStationName, 
    epoch: refEpoch,
    arrivals: isArrivalsMode
  }, '', url);
  return refEpoch;
}

const triggerTimeChange = () => {
  if (!currentStopId) return;
  const refEpoch = syncPickersToUrl();
  loadDepartures(refEpoch);
};

if (datePicker) datePicker.addEventListener('change', triggerTimeChange);
if (timePicker) timePicker.addEventListener('change', triggerTimeChange);

// ─── Navigation Buttons (Früher / Später) ──────────────────────────────────

function setupNavigationButtons() {
  const handleEarlier = () => {
    const currentEpoch = getSelectedEpoch();
    if (!currentEpoch) return;
    const earlierEpoch = currentEpoch - (20 * 60);
    setPickersFromEpoch(earlierEpoch);
    triggerTimeChange();
  };

  const handleLater = () => {
    if (allDepartures.length === 0) return;
    const lastDep = allDepartures[allDepartures.length - 1];
    if (!lastDep) return;
    
    const lastTime = lastDep.scheduled || lastDep.live;
    if (!lastTime) return;
    
    const laterEpoch = lastTime - 60;
    setPickersFromEpoch(laterEpoch);
    triggerTimeChange();
  };

  const btnEarlierTop = document.getElementById('btn-earlier-top');
  const btnLaterTop = document.getElementById('btn-later-top');
  const btnEarlierBottom = document.getElementById('btn-earlier-bottom');
  const btnLaterBottom = document.getElementById('btn-later-bottom');
  
  if (btnEarlierTop) btnEarlierTop.addEventListener('click', handleEarlier);
  if (btnLaterTop) btnLaterTop.addEventListener('click', handleLater);
  if (btnEarlierBottom) btnEarlierBottom.addEventListener('click', handleEarlier);
  if (btnLaterBottom) btnLaterBottom.addEventListener('click', handleLater);
}

document.addEventListener('DOMContentLoaded', () => {
  const btnToggleArrivals = document.getElementById('btn-toggle-arrivals');
  if (btnToggleArrivals) btnToggleArrivals.addEventListener('click', toggleArrivalMode);

  updateArrivalToggleUI();

  setTimeout(() => {
    setupNavigationButtons();
  }, 100);
  
  updateClock();
  setInterval(updateClock, 1000);

  window.addEventListener('popstate', (event) => {
    const state = event.state;
    if (state && state.stopId) {
      currentStopId = state.stopId;
      currentStationName = state.stationName || 'Station wählen';
      isArrivalsMode = state.arrivals || false;
      updateArrivalToggleUI();
      updateStationTitle(currentStationName);
      setPickersFromEpoch(state.epoch);
      loadDepartures(state.epoch);
    }
  });

  const btnJetzt = document.getElementById('btn-jetzt');
  if (btnJetzt) btnJetzt.addEventListener('click', setCurrentTime);
  
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) btnRefresh.addEventListener('click', reloadDepartures);
});

// ─── Stationssuche ───────────────────────────────────────────────────────────

const queryInput = document.getElementById('query');
if (queryInput) {
  queryInput.addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    const list = document.getElementById('suggestions');
    if (!list) return;
    list.innerHTML = '';
    if (q.length < 2) return;
   
    try {
      const abbrevMatches = [];
      const qUpper = q.toUpperCase();
      if (abbrevMap[qUpper]) {
        for (const match of abbrevMap[qUpper]) {
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
   
      const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(q)}`);
      const data = await res.json();
      
      const apiMatches = (data.stations || []).map(st => {
        const foundAbbrevs = getAbbrevsForName(st.name);
        const primary = foundAbbrevs.length > 0 ? foundAbbrevs[0] : null;
        return {
          id: st.id,
          name: st.name,
          abbrev: primary ? primary.abbrev : null,
          country: primary ? primary.country : null,
          source: 'api'
        };
      });
   
      const seen = new Set();
      const allMatches = [...abbrevMatches, ...apiMatches];
      
      allMatches.forEach(match => {
        const key = (match.id || match.name).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
   
        const li = document.createElement('li');
        let html = escapeHtml(match.name);
        
        if (match.abbrev) {
          html += ` <span class="abbrev-label">${escapeHtml(match.abbrev)}${match.country ? ` [${escapeHtml(match.country)}]` : ''}</span>`;
        }
        
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
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-box')) {
    const list = document.getElementById('suggestions');
    if (list) list.innerHTML = '';
  }
});

// ─── Init aus URL ────────────────────────────────────────────────────────────

const urlTimeRaw = params.get('time');
const urlEpoch   = urlTimeRaw && !isNaN(Number(urlTimeRaw)) ? Number(urlTimeRaw) : null;

let initialEpoch = urlEpoch;
if (!initialEpoch) {
  const now = new Date();
  initialEpoch = Math.floor(now.getTime() / 1000);
  setPickersFromEpoch(initialEpoch);
} else {
  setPickersFromEpoch(initialEpoch);
}

if (params.get('stopId')) {
  currentStopId = params.get('stopId');
  currentStationName = 'Station wählen';
  updateStationTitle(currentStationName);
  loadDepartures(initialEpoch);
}

// ─── Station Title aktualisieren ────────────────────────────────────────────

function updateStationTitle(name) {
  currentStationName = name;
  const el = document.getElementById('stationTitle');
  if (el) el.textContent = name;
  document.title = name + ' | OMNI (NOWE)';
}

// ─── Station auswählen ───────────────────────────────────────────────────────

function selectStation(stopId, name, refEpoch) {
  if (stopId === null) {
    selectStationByName(name, refEpoch);
    return;
  }

  currentStopId = stopId;
  currentStationName = name;
  currentMainStationId = stopId;
  updateStationTitle(name);
  
  const list = document.getElementById('suggestions');
  if (list) list.innerHTML = '';
  if (queryInput) queryInput.value = '';

  if (refEpoch) {
    setPickersFromEpoch(refEpoch);
  }

  const currentEpoch = getSelectedEpoch();

  const url = new URL(location.href);
  url.searchParams.set('stopId', stopId);
  
  if (currentEpoch) url.searchParams.set('time', currentEpoch);
  else              url.searchParams.delete('time');

  if (isArrivalsMode) url.searchParams.set('arrivals', 'true');
  else                url.searchParams.delete('arrivals');

  history.pushState({stopId, stationName: name, epoch: currentEpoch, arrivals: isArrivalsMode}, '', url);

  loadDepartures(currentEpoch);
  window.scrollTo({top: 250, behavior: 'smooth'});
}

async function selectStationByName(name, refEpoch) {
  try {
    const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(name)}`);
    const data = await res.json();
    const stations = data.stations || [];
    
    if (stations.length === 0) {
      alert(`Station "${name}" nicht gefunden.`);
      return;
    }
    
    const match = stations.find(s => s.name.toLowerCase() === name.toLowerCase()) || stations[0];
    selectStation(match.id, match.name, refEpoch);
  } catch (err) {
    alert('Fehler bei der Stationssuche: ' + err.message);
  }
}

// ─── Abfahrten/Ankünfte laden ────────────────────────────────────────────────

async function loadDepartures(refEpoch) {
  if (!currentStopId) return;
  setStatus(isArrivalsMode ? 'Lade Ankünfte…' : 'Lade Abfahrten…');

  if (refEpoch === undefined) {
    refEpoch = getSelectedEpoch();
  }

  try {
    let departures;
    
    if (window.combinedStationsReady && window.combinedStations && window.combinedStations[currentStationName]) {
      console.log('Using combined departures/arrivals for:', currentStationName);
      departures = await fetchCombinedDepartures(currentStopId, currentStationName, refEpoch, 25);
    } else {
      console.log('Using single station departures/arrivals for:', currentStationName);
      let q = `${PROXY}?action=departures&stopId=${encodeURIComponent(currentStopId)}&n=25`;
      if (isArrivalsMode) q += '&arrivals=true';
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
      departures = departures.map(dep => ({
        ...dep,
        _fromStation: currentStationName,
        _isMainStation: true
      }));
    }

    allDepartures = departures;
    renderDepartures(allDepartures);
    setStatus(refEpoch
      ? (isArrivalsMode ? 'Ankünfte' : 'Abfahrten') + ' ab ausgewähltem Zeitpunkt · ' + (timePicker ? timePicker.value : '')
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
  const topNav = document.getElementById('nav-buttons-top');
  const bottomNav = document.getElementById('nav-buttons-bottom');
  if (topNav) topNav.style.display = isVisible ? 'flex' : 'none';
  if (bottomNav) bottomNav.style.display = isVisible ? 'flex' : 'none';
}

// ─── Rendern ─────────────────────────────────────────────────────────────────

function renderError(msg) {
  const table = document.getElementById('departureTable');
  if (table) table.style.display = 'none';
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
  const table = document.getElementById('departureTable');
  if (!tbody || !table) return;

  tbody.innerHTML = '';
  table.style.display = departures.length ? 'table' : 'none';

  if (!departures.length) {
    document.getElementById('status').innerHTML = '<div class="empty-hint">Keine Einträge gefunden.</div>';
    return;
  }
  
  const sorted = [...departures].sort((a, b) => {
    const timeA = a.scheduled || Infinity;
    const timeB = b.scheduled || Infinity;
    return timeA - timeB;
  });

  sorted.forEach(dep => {
    const tr = document.createElement('tr');
    tr.className = 'dep-row';

    const timeStr = dep.scheduled
      ? new Date(dep.scheduled * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit'})
      : '–';

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
    const destName = getDestinationName(dep.destination);

    tr.dataset.mode = canonicalMode(dep.mode);
    tr.dataset.dest = destName;
    tr.dataset.trip = dep.tripNumber || '';
    tr.dataset.line = dep.line || '';
    tr.dataset.agencyId = dep.agencyId || '';
    tr.dataset.agencyName = dep.agencyName || '';
    tr.dataset.tripId = dep.tripId || '';

    let stationLabelHtml = '';
    if (dep._fromStation && !dep._isMainStation) {
      stationLabelHtml = `<div class="station-hint">${isArrivalsMode ? 'an' : 'ab'} ${escapeHtml(dep._fromStation)}</div>`;
    }

    tr.innerHTML = `
      <td class="col-time">${timeStr}<br><span class="delay-badge">${delayHtml}</span></td>
      <td class="col-line">
        <div class="line-container" data-mode="${canonicalMode(dep.mode)}" data-agency-id="${escapeHtml(dep.agencyId || '')}" data-agency-name="${escapeHtml(dep.agencyName || '')}" data-line="${escapeHtml(dep.line || '')}" data-route-id="${escapeHtml(dep.routeId || '')}"><span class="line">${iconHtml}${escapeHtml(dep.line)}</span></div>
        <div class="col-nr tripnr">${dep.tripNumber ? escapeHtml(dep.tripNumber.replace(/^0+(?=\d)/, '')) : ''}</div>
      </td>
      <td class="col-dest">${escapeHtml(destName)}${stationLabelHtml}</td>
      <td class="col-platform">${escapeHtml(dep.track)}</td>
    `;
    tr.onclick = () => toggleChain(tr, dep);
    tbody.appendChild(tr);
  });

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
  const legMetadata = {};
  if (data.legInfos) {
    Object.entries(data.legInfos).forEach(([key, value]) => {
      legMetadata[parseInt(key)] = value;
    });
  }

  const stopsHtml = (data.stops || []).map((stop, i) => {
    const isLast = i === (data.stops.length - 1);
    const isFirst = i === 0;
    
    const arrDisp = stop.arrivalSched   ? fmtTime(stop.arrivalSched)   : null;
    const depDisp = stop.departureSched ? fmtTime(stop.departureSched) : null;
    
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
    
    let platHtml = '';
    if (stop.track) {
      platHtml = `Gl. ${escapeHtml(stop.track)}`;
    }
   
    let boardingBadge = '';
    const noPickup  = stop.pickupType === 'NOT_ALLOWED' || stop.pickupType === 'MUST_PHONE' || stop.pickupType === 'COORDINATE_WITH_DRIVER';
    const noDropoff = stop.dropoffType === 'NOT_ALLOWED' || stop.dropoffType === 'MUST_PHONE' || stop.dropoffType === 'COORDINATE_WITH_DRIVER';
   
    if (noPickup && !noDropoff) {
      boardingBadge = '<span class="boarding-badge badge-sd" title="Halt nur zum Aussteigen">SD</span>';
    } else if (noDropoff && !noPickup) {
      boardingBadge = '<span class="boarding-badge badge-sm" title="Halt nur zum Einsteigen">SM</span>';
    }
    
    const stopNameStyle = stop.cancelled 
      ? 'text-decoration: line-through; color: #555;' 
      : '';
    
    const dotStyle = stop.cancelled 
      ? ' style="background:#555;"' 
      : '';
    
    // Abkürzungs-Badge für den Stationsnamen im Fahrtverlauf ermitteln
    const stopAbbrevs = getAbbrevsForName(stop.name);
    const stopAbbrevBadge = stopAbbrevs.length > 0
      ? ` <span class="abbrev-label">${escapeHtml(stopAbbrevs[0].abbrev)}</span>`
      : '';

    // Dynamische Wahl des Epoch-Zeitstempels je nach Modus
    const refEpoch = isArrivalsMode
      ? (stop.arrivalSched || stop.arrivalLive || stop.departureSched || stop.departureLive)
      : (stop.departureSched || stop.departureLive || stop.arrivalSched || stop.arrivalLive);

    const isClickable = !!stop.stopId;
    const clickAttrs = isClickable
      ? `onclick="selectStation('${escapeAttr(stop.stopId)}','${escapeAttr(stop.name)}',${refEpoch || 'null'})"`
      : '';
    
    let legSeparatorHtml = '';
    if (i > 0) {
      const prevStop = data.stops[i - 1];
      const currentLegIndex = stop.legIndex ?? 0;
      const prevLegIndex = prevStop.legIndex ?? 0;
      
      if (currentLegIndex !== prevLegIndex) {
        const nextLegMeta = legMetadata[currentLegIndex] || {};
        const lineStr = nextLegMeta.line ? escapeHtml(nextLegMeta.line) : '?';
        const tripStr = nextLegMeta.tripNumber ? ` (${escapeHtml(nextLegMeta.tripNumber)})` : '';
        const destStr = nextLegMeta.destination ? ` nach ${escapeHtml(getDestinationName(nextLegMeta.destination))}` : '';
        
        legSeparatorHtml = `
          <div class="chain-leg-separator">
            <div class="separator-text">
              ↓ Fährt weiter als Linie ${lineStr}${tripStr} via <strong>${escapeHtml(stop.name)}</strong>${destStr}
            </div>
          </div>
        `;
      }
    }
    
    return legSeparatorHtml + `
      <div class="chain-stop${stop.cancelled ? ' chain-cancelled' : ''}${isClickable ? ' chain-clickable' : ''}" ${clickAttrs}>
        
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
        
        <div class="chain-times">
          ${arrDisp ? `<div class="time-row"><span class="label">An</span> <span class="time-val">${escapeHtml(arrDisp)}</span>${arrDelayHtml}</div>` : '<div class="time-row">&nbsp;</div>'}
          ${depDisp ? `<div class="time-row"><span class="label">Ab</span> <span class="time-val">${escapeHtml(depDisp)}</span>${depDelayHtml}</div>` : '<div class="time-row">&nbsp;</div>'}
        </div>
        
        <div class="chain-info">
          <div class="chain-name" style="${stopNameStyle}">${escapeHtml(stop.name)}${stopAbbrevBadge}${boardingBadge}</div>
          ${platHtml ? `<div class="chain-platform">${escapeHtml(platHtml)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
    
  const chainDestName = getDestinationName(data.destination);
  const tripIdHtml = data.tripId ? `<div class="trip-id-row">Trip-ID: <code title="${escapeHtml(data.tripId)}" onclick="navigator.clipboard.writeText('${data.tripId.replace(/'/g, "\\'")}'); this.innerText='✅ Kopiert!'; setTimeout(() => this.innerText='${escapeHtml(data.tripId).replace(/'/g, "\\'")}', 1500);">${escapeHtml(data.tripId)}</code></div>` : '';
  const BetreiberHTML = (data.agency && (data.agency.name || data.agency.id))
    ? `<div class="agency-row">
        <span class="agency-label">Betreiber:</span>
        <span class="agency-content">
          ${
            data.agency.url 
              ? `<a href="${escapeHtml(data.agency.url)}" target="_blank" rel="noopener noreferrer" class="agency-name">${escapeHtml(data.agency.name || 'Unbekannt')}</a>`
              : `<span class="agency-name">${escapeHtml(data.agency.name || 'Unbekannt')}</span>`
          }
          ${
            data.agency.id 
              ? `<code class="agency-id" title="${escapeHtml(data.agency.id)}">${escapeHtml(data.agency.id)}</code>` 
              : ''
          }
        </span>
      </div>`
    : '';
  
  return `
    <div class="chain-header">
      <b>Linie ${escapeHtml(data.line || '?')}${chainDestName ? ' → ' + escapeHtml(chainDestName) : ''}</b>${data.tripNumber ? ' · ' + escapeHtml(String(data.tripNumber).replace(/^0+/, '')) : ''}
    </div>
    <div class="chain">
      ${stopsHtml}
    </div>
    ${tripIdHtml}
    ${BetreiberHTML}
  `;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function getDestinationName(dest) {
  if (!dest) return '';
  if (typeof dest === 'object') return dest.name || '';
  return String(dest);
}

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

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

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

// ─── JETZT Button ───────────────────────────────────────────────────────────

function setCurrentTime() {
  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  
  if (datePicker && timePicker) {
    datePicker.value = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`;
    timePicker.value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  }
  
  triggerTimeChange();
}

// ─── GO Button ──────────────────────────────────────────────────────────────

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