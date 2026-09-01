
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
    const currentEpoch = getSelectedEpoch() || Math.floor(Date.now() / 1000);
    
    if (allDepartures.length === 0) {
      setPickersFromEpoch(currentEpoch + (20 * 60));
      triggerTimeChange();
      return;
    }

    const maxTime = Math.max(...allDepartures.map(d => d.scheduled || d.live || 0));

    if (maxTime > currentEpoch) {
      setPickersFromEpoch(maxTime + 60);
    } else {
      setPickersFromEpoch(currentEpoch + (20 * 60));
    }
    
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

  const btnToggleVias = document.getElementById('btn-toggle-vias');
  if (btnToggleVias) btnToggleVias.addEventListener('click', toggleViaLoading);
  updateViaToggleButton();

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
      if (state.calendarStart) calendarStart = state.calendarStart;
      if (state.calendarVias) calendarVias = state.calendarVias;
      if (state.calendarDest) calendarDest = state.calendarDest;
      updateArrivalToggleUI();
      updateStationTitle(currentStationName);
      setPickersFromEpoch(state.epoch);
      loadDepartures(state.epoch);
      updateCalendarExportButton();
    }
  });

  const btnJetzt = document.getElementById('btn-jetzt');
  if (btnJetzt) btnJetzt.addEventListener('click', setCurrentTime);
  
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) btnRefresh.addEventListener('click', reloadDepartures);

  const btnExportCalendar = document.getElementById('btn-export-calendar');
  if (btnExportCalendar) {
    btnExportCalendar.addEventListener('click', exportCalendarJourney);
  }
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

  if (!e.target.closest('.home-search-panel')) {
    const list = document.getElementById('home-suggestions');
    if (list) list.innerHTML = '';
  }
});

const homeQueryInput = document.getElementById('home-query');
if (homeQueryInput) {
  homeQueryInput.addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    const list = document.getElementById('home-suggestions');
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

  const homeSearchBtn = document.getElementById('home-search-btn');
  if (homeSearchBtn) {
    homeSearchBtn.addEventListener('click', async () => {
      const q = homeQueryInput.value.trim();
      const list = document.getElementById('home-suggestions');
      if (!q) return;

      if (list && list.children.length > 0) {
        const firstItem = list.children[0];
        firstItem.click();
        return;
      }

      try {
        const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(q)}`);
        const data = await res.json();
        const stations = data.stations || [];
        if (!stations.length) {
          alert(`Station "${q}" nicht gefunden.`);
          return;
        }

        const match = stations.find(s => s.name.toLowerCase() === q.toLowerCase()) || stations[0];
        selectStation(match.id, match.name, null);
      } catch (err) {
        alert('Fehler bei der Stationssuche: ' + err.message);
      }
    });
  }
}

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
  renderFavoritesBar();
}

// ─── Station auswählen ───────────────────────────────────────────────────────

function selectStation(stopId, name, refEpoch) {
  if (stopId === null) {
    selectStationByName(name, refEpoch);
    return;
  }

  closeHomeView();
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
  url.searchParams.set('view', 'departures');
  url.searchParams.set('stopId', stopId);
  
  if (currentEpoch) url.searchParams.set('time', currentEpoch);
  else              url.searchParams.delete('time');

  if (isArrivalsMode) url.searchParams.set('arrivals', 'true');
  else                url.searchParams.delete('arrivals');

  history.pushState({stopId, stationName: name, epoch: currentEpoch, arrivals: isArrivalsMode, calendarStart, calendarVias, calendarDest}, '', url);

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

// ─── Line Normalization ──────────────────────────────────────────────────────

function normalizeLineDisplay(line) {
  if (!line) return '';
  const upper = line.toUpperCase();
  
  if (upper.startsWith('TGV LYRIA')) return 'TGV Lyria';
  if (upper.startsWith('TER')) return 'TER';
  if (upper.startsWith('ICE')) return 'ICE';
  if (upper.startsWith('ICD')) return 'ICD';
  if (upper.startsWith('ECD')) return 'ECD';
  if (upper.startsWith('FR')) return 'FR';
  if (upper.startsWith('EC')) return 'EC';
  if (upper.startsWith('RV')) return 'RV';
  if (upper.startsWith('GATWICK EXPRESS')) return 'GX';
  if (upper.startsWith('ELIZABETH LINE')) return 'ELZ';
  if (upper.startsWith('HAMMERSMITH & CITY')) return 'H&C';
  
  return line.replace(/\s*\(\d+\)\s*$/g, '').trim();
}

// ─── Async Destination Loading ───────────────────────────────────────────────

let tripDetailsQueue = Promise.resolve();

function queueTripDetailsLoad(dep, tbody, depIdx) {
  tripDetailsQueue = tripDetailsQueue
    .then(() => loadTripDestinationAsync(dep, tbody, depIdx))
    .catch(err => {
      console.warn(`Trip details queue error for ${dep.tripId}:`, err);
    });
}

function normalizeStationKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getStopRefEpoch(stop, arrivalsMode) {
  if (!stop) return 0;
  if (arrivalsMode) {
    return stop.arrivalLive || stop.arrivalSched || stop.departureLive || stop.departureSched || 0;
  }
  return stop.departureLive || stop.departureSched || stop.arrivalLive || stop.arrivalSched || 0;
}

function pickClosestStopIndexByTime(stops, indices, refEpoch) {
  if (!Array.isArray(indices) || indices.length === 0) return -1;
  if (!refEpoch) return indices[0];

  let bestIdx = -1;
  let bestDelta = Infinity;

  indices.forEach(idx => {
    const t = getStopRefEpoch(stops[idx], isArrivalsMode);
    if (!t) return;
    const delta = Math.abs(t - refEpoch);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = idx;
    }
  });

  return bestIdx >= 0 ? bestIdx : indices[0];
}

function findOriginStopIndex(stops, dep, originName) {
  if (!Array.isArray(stops) || stops.length === 0) return -1;
  const refEpoch = dep?.scheduled || dep?.live || 0;

  const candidates = [];
  if (dep?.stopId) candidates.push(String(dep.stopId));
  if (currentStopId) candidates.push(String(currentStopId));
  if (currentMainStationId) candidates.push(String(currentMainStationId));

  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  if (uniqueCandidates.length > 0) {
    const matchingIndices = [];
    stops.forEach((stop, idx) => {
      if (uniqueCandidates.includes(String(stop?.stopId || ''))) {
        matchingIndices.push(idx);
      }
    });
    const byStopId = pickClosestStopIndexByTime(stops, matchingIndices, refEpoch);
    if (byStopId >= 0) return byStopId;
  }

  const normalizedOriginNames = [originName, dep?._fromStation, currentStationName]
    .map(normalizeStationKey)
    .filter(Boolean);

  if (normalizedOriginNames.length > 0) {
    const matchingIndices = [];
    stops.forEach((stop, idx) => {
      const stopName = normalizeStationKey(stop?.name);
      if (normalizedOriginNames.includes(stopName)) {
        matchingIndices.push(idx);
      }
    });
    const byName = pickClosestStopIndexByTime(stops, matchingIndices, refEpoch);
    if (byName >= 0) return byName;
  }

  if (!refEpoch) return -1;

  let bestIdx = -1;
  let bestDelta = Infinity;
  stops.forEach((stop, idx) => {
    const t = getStopRefEpoch(stop, isArrivalsMode);
    if (!t) return;
    const delta = Math.abs(t - refEpoch);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = idx;
    }
  });

  // Guardrail: only trust time fallback if reasonably close.
  if (bestIdx >= 0 && bestDelta <= 120 * 60) {
    return bestIdx;
  }

  return -1;
}

function getLegInfoByIndex(legInfos, legIndex) {
  if (!legInfos) return null;

  if (Array.isArray(legInfos)) {
    return legInfos[legIndex] || null;
  }

  if (typeof legInfos === 'object') {
    return legInfos[String(legIndex)] || null;
  }

  return null;
}

function resolveLegContext(data, dep, originName) {
  const stops = Array.isArray(data?.stops) ? data.stops : [];
  if (stops.length === 0) {
    return { stops: [], originIdx: -1, legIndex: 0, legStartIdx: 0, legEndIdx: -1, legInfo: null };
  }

  let originIdx = findOriginStopIndex(stops, dep, originName);
  if (originIdx < 0 && !isArrivalsMode) {
    originIdx = 0;
  }

  const safeOriginIdx = Math.max(0, Math.min(originIdx, stops.length - 1));
  const legIndex = Number.isFinite(stops[safeOriginIdx]?.legIndex) ? stops[safeOriginIdx].legIndex : 0;

  let legStartIdx = safeOriginIdx;
  while (legStartIdx > 0 && (Number.isFinite(stops[legStartIdx - 1]?.legIndex) ? stops[legStartIdx - 1].legIndex : 0) === legIndex) {
    legStartIdx--;
  }

  let legEndIdx = safeOriginIdx;
  while (legEndIdx + 1 < stops.length && (Number.isFinite(stops[legEndIdx + 1]?.legIndex) ? stops[legEndIdx + 1].legIndex : 0) === legIndex) {
    legEndIdx++;
  }

  return {
    stops,
    originIdx: safeOriginIdx,
    legIndex,
    legStartIdx,
    legEndIdx,
    legInfo: getLegInfoByIndex(data?.legInfos, legIndex)
  };
}

function resolveDestinationForLeg(data, dep, originName) {
  const context = resolveLegContext(data, dep, originName);
  const { stops, legInfo, legEndIdx } = context;

  let finalDestination = getDestinationName(legInfo?.destination || '');
  let isFromLastStop = false;

  if (!finalDestination && stops.length > 0 && legEndIdx >= 0) {
    finalDestination = getDestinationName(stops[legEndIdx]?.name || '');
    isFromLastStop = !!finalDestination;
  }

  if (!finalDestination) {
    finalDestination = getDestinationName(data?.destination || '');
  }

  if (!finalDestination && stops.length > 0) {
    finalDestination = getDestinationName(stops[stops.length - 1]?.name || '');
    isFromLastStop = !!finalDestination;
  }

  return { finalDestination, isFromLastStop, context };
}

function extractViasFromTripData(data, dep, originName, destinationName) {
  const { stops, originIdx, legStartIdx, legEndIdx } = resolveLegContext(data, dep, originName);
  if (stops.length < 3) return [];

  const destNorm = normalizeStationKey(destinationName);
  const originNorm = normalizeStationKey(originName);

  const rawVias = [];

  if (isArrivalsMode && originIdx > legStartIdx) {
    for (let i = legStartIdx; i < originIdx; i++) {
      const viaName = String(stops[i]?.name || '').trim();
      if (viaName) rawVias.push(viaName);
    }
  } else {
    const startIdx = Math.max(originIdx, legStartIdx);
    for (let i = startIdx + 1; i < legEndIdx; i++) {
      const viaName = String(stops[i]?.name || '').trim();
      if (viaName) rawVias.push(viaName);
    }
  }

  const seen = new Set();
  return rawVias.filter(name => {
    const norm = name.toLowerCase();
    if (!name || norm === destNorm || norm === originNorm || seen.has(norm)) {
      return false;
    }
    seen.add(norm);
    return true;
  });
}

function renderViaLine(vias) {
  if (!viaLoadingEnabled) return '';
  if (!Array.isArray(vias) || vias.length === 0) return '';
  return `<span class="via">via ${vias.map(v => escapeHtml(v)).join(' · ')}</span>`;
}

function renderDestinationCellHtml(destName, isFromLastStop, stationHintHtml, vias) {
  const destDisplay = isFromLastStop
    ? `<em>${escapeHtml(destName)}</em>`
    : escapeHtml(destName);
  const viaHtml = renderViaLine(vias);
  return `${destDisplay}${viaHtml}${stationHintHtml}`;
}

async function loadTripDestinationAsync(dep, tbody, depIdx) {
  if (!dep.tripId) return;
  
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 800));
  
  try {
    const res = await fetch(`${PROXY}?action=trip&tripId=${encodeURIComponent(dep.tripId)}`);
    const data = await res.json();
    
    if (data.error) {
      console.warn(`Failed to load trip ${dep.tripId}:`, data.error);
      return;
    }
    
    const { finalDestination, isFromLastStop } = resolveDestinationForLeg(data, dep, dep._fromStation || currentStationName);

    const destName = getDestinationName(finalDestination);
    const viaNames = viaLoadingEnabled
      ? extractViasFromTripData(data, dep, dep._fromStation || currentStationName, destName)
      : [];
    dep.vias = viaNames;
    
    if (finalDestination) {
      dep.destination = finalDestination;
    }

    const rows = tbody.querySelectorAll('tr.dep-row');
    if (rows[depIdx]) {
      const row = rows[depIdx];
      const isSameTrip = (row.dataset.tripId || '') === (dep.tripId || '');
      if (!isSameTrip) {
        return;
      }
      const destCell = row.querySelector('.col-dest');
      if (destCell && destName) {
        row.dataset.dest = destName;
        row.dataset.vias = viaLoadingEnabled ? viaNames.join(' ') : '';

        const stationHint = destCell.querySelector('.station-hint');
        const stationHintHtml = stationHint ? stationHint.outerHTML : '';

        destCell.innerHTML = renderDestinationCellHtml(destName, isFromLastStop, stationHintHtml, viaNames);

        applyFilters();
      }
    }
  } catch (err) {
    console.warn(`Failed to load destination for trip ${dep.tripId}:`, err);
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
      // Deduplicate combined departures
      departures = deduplicateDepartures(departures);
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

// ─── Trip Number Formatting Helper ──────────────────────────────────────────

function formatTripNumber(tripNumber, line) {
  if (!tripNumber || tripNumber === '0' || tripNumber === 0) {
    return extractTripNumberFromLine(line);
  }
  
  tripNumber = String(tripNumber).trim();
  
  if (tripNumber === '0' || /^0+$/.test(tripNumber)) {
    return extractTripNumberFromLine(line);
  }
  
  const match1 = tripNumber.match(/\s*-\s*(\d+)$/);
  if (match1) {
    return match1[1];
  }

  const match2 = tripNumber.match(/^[A-Za-z]+\s+(\d+)$/);
  if (match2) {
    return match2[1];
  }
  
  return tripNumber.replace(/^0+(?=\d)/, '');
}

function extractTripNumberFromLine(line) {
  if (!line) return '';
  
  line = line.trim();
  
  const match1 = line.match(/\s*-\s*(\d+)$/);
  if (match1) {
    return match1[1];
  }
  
  const match2 = line.match(/(?:^|\s)(\d+)$/);
  if (match2) {
    return match2[1];
  }
  
  return '';
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateDepartures(departures) {
  const seen = new Map();
  const deduplicated = [];

  departures.forEach(dep => {
    const tripId = dep.tripId || '';
    const scheduled = dep.scheduled || 0;
    const line = dep.line || '';
    
    // Key: tripId + scheduled time + line (for trips without tripId)
    const key = tripId ? `${tripId}:${scheduled}` : `${line}:${scheduled}`;
    
    if (!seen.has(key)) {
      seen.set(key, true);
      deduplicated.push(dep);
    }
  });

  return deduplicated;
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