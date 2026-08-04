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

const PROXY = 'proxy.php';

const state = {
  fromStop: null,
  toStop: null,
  boardStop: null,
  vias: []
};

let abbrevMap = {};

// ─── Abkürzungs-Mappings laden ──────────────────────────────────────────────

async function loadAbbreviations() {
  const countries = ['ch', 'de', 'at', 'fr'];
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
            abbrevMap[abbrev].push({ name, country: country.toUpperCase() });
          });
        }
      } catch (e) {
        console.warn(`Konnte /didok/${country}.json nicht laden:`, e);
      }
    }
  } catch (err) {
    console.error('Fehler beim Laden der Abkürzungs-Mappings:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadAbbreviations();
  setupLiveClock();
  setupAutocompletes();
  setupEventListeners();
  restoreStateFromUrl();
});

function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);

  const fromName = params.get('from');
  const fromId = params.get('fromId');
  const toName = params.get('to');
  const toId = params.get('toId');
  const time = params.get('time');

  if (fromName && fromId) {
    state.fromStop = { name: fromName, id: fromId };
    const input = document.getElementById('route-from-input');
    if (input) input.value = fromName;
  }

  if (toName && toId) {
    state.toStop = { name: toName, id: toId };
    const input = document.getElementById('route-to-input');
    if (input) input.value = toName;
  }

  if (time) {
    const input = document.getElementById('route-time');
    if (input) input.value = time;
  }

  // Vias wiederherstellen
  let i = 1;
  while (params.has(`viaId${i}`)) {
    const viaName = params.get(`via${i}`) || '';
    const viaId = params.get(`viaId${i}`);

    // Via-Feld über die bestehende Logik erzeugen
    createViaInput();
    const currentViaObj = state.vias[state.vias.length - 1];
    if (currentViaObj) {
      currentViaObj.stop = { name: viaName, id: viaId };
      const wrapper = document.querySelector(`#via-list-container .via-item:last-child input`);
      if (wrapper) wrapper.value = viaName;
    }
    i++;
  }

  // Wenn Start und Ziel vorhanden sind, direkt suchen
  if (state.fromStop && state.toStop) {
    handleRouteSearch();
  }
}

function setupLiveClock() {
  const clock = document.getElementById('live-clock');
  const updateTime = () => {
    const now = new Date();
    clock.textContent = now.toTimeString().split(' ')[0];
  };
  updateTime();
  setInterval(updateTime, 1000);
}

function setupEventListeners() {
  document.getElementById('btn-search-route').addEventListener('click', handleRouteSearch);
  document.getElementById('btn-load-board').addEventListener('click', handleBoardLoad);

  // Klick-Event für den Via-Button
  const addViaBtn = document.getElementById('btn-add-via');
  if (addViaBtn) {
    addViaBtn.addEventListener('click', createViaInput);
  } else {
    console.warn('Button #btn-add-via wurde im HTML nicht gefunden.');
  }

  document.getElementById('btn-refresh').addEventListener('click', () => {
    document.getElementById('route-from-input').value = '';
    document.getElementById('route-to-input').value = '';
    document.getElementById('route-time').value = '';
    document.getElementById('board-station-input').value = '';
    
    // Via-Container leeren
    const viaContainer = document.getElementById('via-list-container');
    if (viaContainer) viaContainer.innerHTML = '';
    
    state.fromStop = state.toStop = state.boardStop = null;
    state.vias = [];
  });

  document.getElementById('btn-home').addEventListener('click', () => {
    window.location.href = '/';
  });
}

function createViaInput() {
  const viaId = Date.now() + Math.random().toString(36).substr(2, 4);
  const container = document.getElementById('via-list-container');
  if (!container) return;

  const viaIndex = state.vias.length + 1;
  const wrapper = document.createElement('div');
  wrapper.className = 'form-group via-item';
  wrapper.dataset.viaId = viaId;

  const inputId = `via-input-${viaId}`;
  const suggestionsId = `via-suggestions-${viaId}`;

  wrapper.innerHTML = `
    <label>Via ${viaIndex}</label>
    <div style="display: flex; gap: 6px;">
      <input type="text" id="${inputId}" placeholder="Via-Haltestelle" style="flex: 1;">
      <button type="button" class="btn-remove-via" style="background: var(--error); color: white; border: none; border-radius: 6px; padding: 0 10px; cursor: pointer;">✕</button>
    </div>
    <div id="${suggestionsId}" class="suggestions"></div>
  `;

  container.appendChild(wrapper);

  const viaEntry = { id: viaId, stop: null };
  state.vias.push(viaEntry);

  initAutocomplete(inputId, suggestionsId, (stop) => {
    viaEntry.stop = stop;
  });

  wrapper.querySelector('.btn-remove-via').addEventListener('click', () => {
    wrapper.remove();
    state.vias = state.vias.filter(v => v.id !== viaId);
    renumberViaLabels();
  });
}

function renumberViaLabels() {
  const items = document.querySelectorAll('#via-list-container .via-item');
  items.forEach((item, idx) => {
    const label = item.querySelector('label');
    if (label) label.textContent = `Via ${idx + 1}`;
  });
}

function debounce(func, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => func(...args), delay);
  };
}

function setupAutocompletes() {
  initAutocomplete('route-from-input', 'from-suggestions', (stop) => { state.fromStop = stop; });
  initAutocomplete('route-to-input', 'to-suggestions', (stop) => {
    state.toStop = stop;
    handleRouteSearch();
  });
  initAutocomplete('board-station-input', 'board-suggestions', (stop) => {
    state.boardStop = stop;
    handleBoardLoad();
  });
}

function initAutocomplete(inputId, suggestionsId, onSelect) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(suggestionsId);
  let activeIndex = -1;
  let currentItems = [];

  const fetchSuggestions = debounce(async (query) => {
    if (query.length < 2) {
      container.style.display = 'none';
      return;
    }

    try {
      const qUpper = query.toUpperCase();
      const abbrevMatches = [];

      // 1. Abkürzungs-Matches prüfen und auflösen
      if (abbrevMap[qUpper]) {
        for (const match of abbrevMap[qUpper]) {
          try {
            const searchRes = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(match.name)}`);
            const searchData = await searchRes.json();
            const station = (searchData.stations || searchData.results || []).find(
              s => s.name.toLowerCase() === match.name.toLowerCase()
            );

            if (station) {
              abbrevMatches.push({
                ...station,
                abbrev: qUpper,
                country: match.country
              });
            }
          } catch (_) {}
        }
      }

      // 2. Reguläre API-Suche
      const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(query)}`);
      const data = await res.json();
      const apiMatches = data.stations || data.results || [];

      // 3. Mergen & Duplikate filtern (Abkürzungen zuerst)
      const seen = new Set();
      currentItems = [];

      [...abbrevMatches, ...apiMatches].forEach(item => {
        const key = (item.id || item.name).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        currentItems.push(item);
      });

      container.innerHTML = '';
      activeIndex = -1;

      if (currentItems.length === 0) {
        container.style.display = 'none';
        return;
      }

      // 4. Dropdown-Einträge rendern
      currentItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';

        let html = escapeHtml(item.name);
        if (item.abbrev) {
          html += ` <span class="abbrev-label">${escapeHtml(item.abbrev)} [${escapeHtml(item.country)}]</span>`;
        }

        div.innerHTML = html;
        div.addEventListener('click', () => selectItem(index));
        container.appendChild(div);
      });

      container.style.display = 'block';
    } catch (err) {
      console.error('Fehler beim Laden der Vorschläge:', err);
    }
  }, 250);

  function selectItem(index) {
    if (index >= 0 && index < currentItems.length) {
      const item = currentItems[index];
      input.value = item.name;
      onSelect(item);
      container.style.display = 'none';
      activeIndex = -1;
    }
  }

  function updateActiveHighlight() {
    const children = container.querySelectorAll('.suggestion-item');
    children.forEach((child, idx) => {
      child.classList.toggle('selected', idx === activeIndex);
      if (idx === activeIndex) child.scrollIntoView({ block: 'nearest' });
    });
  }

  input.addEventListener('input', (e) => fetchSuggestions(e.target.value.trim()));

  input.addEventListener('keydown', (e) => {
    const isVisible = container.style.display === 'block';

    if (e.key === 'ArrowDown') {
      if (!isVisible) return;
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentItems.length - 1);
      updateActiveHighlight();
    } else if (e.key === 'ArrowUp') {
      if (!isVisible) return;
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveHighlight();
    } else if (e.key === 'Enter') {
      if (isVisible && activeIndex >= 0) {
        e.preventDefault();
        selectItem(activeIndex);
      } else if (!isVisible && inputId === 'route-to-input') {
        handleRouteSearch();
      }
    } else if (e.key === 'Escape') {
      container.style.display = 'none';
      activeIndex = -1;
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !container.contains(e.target)) {
      container.style.display = 'none';
    }
  });
}

async function handleRouteSearch() {
  const hintsContainer = document.getElementById('routing-hint');
  const resultsContainer = document.getElementById('routing-results');
  const tbody = document.getElementById('routing-tbody');

  if (!state.fromStop || !state.toStop) {
    hintsContainer.innerHTML = '<div class="error-hint">Bitte Start und Ziel wählen.</div>';
    resultsContainer.style.display = 'none';
    return;
  }

  hintsContainer.innerHTML = '<div class="loading">Suche läuft…</div>';
  resultsContainer.style.display = 'none';

  const timeInput = document.getElementById('route-time').value;
  let formattedTime = timeInput ? new Date(timeInput).toISOString() : '';

  try {
    const fromId = state.fromStop.id || state.fromStop.stopId;
    const toId = state.toStop.id || state.toStop.stopId;

    // URL-Parameter für den Browser-Zustand aufbauen
    const paramsObj = new URLSearchParams();
    paramsObj.set('from', state.fromStop.name);
    paramsObj.set('fromId', fromId);
    paramsObj.set('to', state.toStop.name);
    paramsObj.set('toId', toId);

    if (timeInput) {
      paramsObj.set('time', timeInput);
    }

    let url = `${PROXY}?action=plan&fromPlace=${encodeURIComponent(fromId)}&toPlace=${encodeURIComponent(toId)}`;
    
    if (formattedTime) {
      url += `&time=${encodeURIComponent(formattedTime)}`;
    }

    state.vias.forEach((v, idx) => {
      if (v && v.stop && (v.stop.id || v.stop.stopId)) {
        const stopId = v.stop.id || v.stop.stopId;
        url += `&via=${encodeURIComponent(stopId)}`;
        paramsObj.append(`via${idx + 1}`, v.stop.name);
        paramsObj.append(`viaId${idx + 1}`, stopId);
      }
    });

    // URL ohne Neuladen aktualisieren
    const newUrl = `${window.location.pathname}?${paramsObj.toString()}`;
    window.history.replaceState({}, '', newUrl);

    const res = await fetch(url);
    const data = await res.json();
    const connections = data.connections || data.itineraries || [];

    if (data.error || connections.length === 0) {
      hintsContainer.innerHTML = '<div class="empty-hint">Keine Verbindungen gefunden.</div>';
      resultsContainer.style.display = 'none';
      return;
    }

    // Globalen Zeitrahmen für alle gefundenen Verbindungen ermitteln
    let globalMinTime = Infinity;
    let globalMaxTime = -Infinity;

    connections.forEach(conn => {
      if (conn.startTime < globalMinTime) globalMinTime = conn.startTime;
      if (conn.endTime > globalMaxTime) globalMaxTime = conn.endTime;
    });

    tbody.innerHTML = '';
    connections.forEach((conn) => {
      const startTime = formatTime(conn.startTime);
      const endTime = formatTime(conn.endTime);
      const durationFormatted = formatDurationHHMM(conn.duration);
      const transfers = conn.transfers || 0;

      const mainRow = document.createElement('tr');
      mainRow.className = 'summary-row';
      mainRow.innerHTML = `
        <td class="col-time">${startTime}</td>
        <td class="col-time">${endTime}</td>
        <td class="col-dur">${durationFormatted}</td>
        <td class="col-bar">${renderTimelineBar(conn.legs, conn.duration, globalMinTime, globalMaxTime)}</td>
        <td class="col-chg">${transfers}</td>
      `;

      const detailRow = document.createElement('tr');
      detailRow.className = 'detail-row';
      detailRow.style.display = 'none';

      const detailTd = document.createElement('td');
      detailTd.colSpan = 5;

      const detailContent = document.createElement('div');
      detailContent.className = 'detail-content';

      renderLegDetails(detailContent, conn.legs);
      detailTd.appendChild(detailContent);
      detailRow.appendChild(detailTd);

      mainRow.addEventListener('click', () => {
        const isVisible = detailRow.style.display !== 'none';
        detailRow.style.display = isVisible ? 'none' : 'table-row';
      });

      tbody.appendChild(mainRow);
      tbody.appendChild(detailRow);
    });

    hintsContainer.innerHTML = '';
    resultsContainer.style.display = 'block';
  } catch (err) {
    hintsContainer.innerHTML = `<div class="error-hint">Fehler: ${escapeHtml(err.message)}</div>`;
    resultsContainer.style.display = 'none';
  }
}

function renderTimelineBar(legs, totalDurationSec, globalMinTime, globalMaxTime) {
  if (!legs || legs.length === 0 || !globalMaxTime || globalMaxTime <= globalMinTime) {
    return '';
  }

  const globalSpan = globalMaxTime - globalMinTime;

  let html = '<div class="timeline-bar" style="display: flex; width: 100%; height: 8px; background: rgba(255, 255, 255, 0.08); border-radius: 4px; overflow: hidden; align-items: center; position: relative;">';

  const connStart = legs[0].from.departure;
  const connEnd = legs[legs.length - 1].to.arrival;

  if (!connStart || !connEnd) return '';

  // 1. Platzhalter am Anfang, falls die Verbindung später startet als das globale Minimum
  const startOffsetPct = ((connStart - globalMinTime) / globalSpan) * 100;
  if (startOffsetPct > 0.1) {
    html += `<div style="width: ${startOffsetPct.toFixed(2)}%; height: 100%; flex-shrink: 0;"></div>`;
  }

  // 2. Eigentliche Segmente und Umstiege im globalen Verhältnis berechnen
  legs.forEach((leg, idx) => {
    const legDuration = (leg.to.arrival && leg.from.departure)
      ? (leg.to.arrival - leg.from.departure)
      : 0;

    let pct = (legDuration / globalSpan) * 100;
    if (pct < 1.5 && legDuration > 0) pct = 1.5;

    const rawMode = leg.mode || 'RAIL';
    const mode = canonicalMode(rawMode);
    const agencyId = escapeHtml(leg.agencyId || '');
    const line = escapeHtml(leg.line || leg.routeShortName || '');
    const routeId = escapeHtml(leg.routeId || '');

    html += `<div class="timeline-segment line-container" 
                  data-mode="${mode}" 
                  data-raw-mode="${escapeHtml(rawMode)}" 
                  data-agency-id="${agencyId}" 
                  data-line="${line}" 
                  data-route-id="${routeId}" 
                  title="${line}: ${Math.round(legDuration / 60)} min"
                  style="width: ${pct.toFixed(2)}%; height: 100%; flex-shrink: 0;"></div>`;

    if (idx < legs.length - 1) {
      const nextLeg = legs[idx + 1];
      if (leg.to.arrival && nextLeg.from.departure) {
        const waitDuration = nextLeg.from.departure - leg.to.arrival;
        if (waitDuration > 0) {
          let waitPct = (waitDuration / globalSpan) * 100;
          if (waitPct < 1) waitPct = 1;

          html += `<div class="timeline-wait" 
                        title="Umstieg: ${Math.round(waitDuration / 60)} min"
                        style="width: ${waitPct.toFixed(2)}%; height: 100%; background: transparent; position: relative; flex-shrink: 0;">
                     <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted, #888);"></span>
                   </div>`;
        }
      }
    }
  });

  // 3. Platzhalter am Ende, damit der Balken bis ganz rechts reicht, falls er früher endet als das globale Maximum
  const endOffsetPct = ((globalMaxTime - connEnd) / globalSpan) * 100;
  if (endOffsetPct > 0.1) {
    html += `<div style="width: ${endOffsetPct.toFixed(2)}%; height: 100%; flex-shrink: 0;"></div>`;
  }

  html += '</div>';
  return html;
}

function renderLegDetails(container, legs) {
  container.innerHTML = '';

  legs.forEach((leg, index) => {
    if (index > 0) {
      const prevLeg = legs[index - 1];
      const transferMinutes = (leg.from.departure && prevLeg.to.arrival)
        ? Math.round((leg.from.departure - prevLeg.to.arrival) / 60)
        : null;

      const transferDiv = document.createElement('div');
      transferDiv.className = 'transfer-info';
      transferDiv.textContent = `Umstieg in ${escapeHtml(leg.from.name)}` +
        (transferMinutes !== null ? ` (${transferMinutes} min Umsteigezeit)` : '');
      container.appendChild(transferDiv);
    }

    const legDiv = document.createElement('div');
    legDiv.className = 'leg-item';

    const rawMode = leg.mode || 'RAIL';
    const mode = canonicalMode(rawMode);
    const agencyId = escapeHtml(leg.agencyId || '');
    const line = escapeHtml(leg.line || leg.routeShortName || '');
    const routeId = escapeHtml(leg.routeId || '');

    if (leg.mode === 'WALK') {
      const walkDuration = (leg.from.departure && leg.to.arrival)
        ? Math.round((leg.to.arrival - leg.from.departure) / 60)
        : '';
      legDiv.innerHTML = `
        <div class="leg-header">
          <div class="line-container">
            <span class="line-badge line-container" data-mode="OTHER" data-raw-mode="WALK" data-agency-id="" data-line="WALK" data-route-id="">Fussweg</span>
          </div>
          <span>${walkDuration ? walkDuration + ' min' : ''} nach ${escapeHtml(leg.to.name)}</span>
        </div>
      `;
    } else {
      const depTime = formatTime(leg.from.departure);
      const arrTime = formatTime(leg.to.arrival);
      const depTrack = leg.from.track ? ` (Gl. ${escapeHtml(leg.from.track)})` : '';
      const arrTrack = leg.to.track ? ` (Gl. ${escapeHtml(leg.to.track)})` : '';
      const headsign = leg.destination ? ` Richtg. ${escapeHtml(leg.destination)}` : '';

      let tripBtnHtml = leg.tripId ? `<button class="btn-trip-detail" data-trip-id="${escapeHtml(leg.tripId)}">Zuglauf</button>` : '';

      legDiv.innerHTML = `
        <div class="leg-header">
          <div class="line-container">
            <span class="line-badge line-container" data-mode="${mode}" data-raw-mode="${escapeHtml(rawMode)}" data-agency-id="${agencyId}" data-line="${line}" data-route-id="${routeId}">${line}</span>
          </div>
          <span>${headsign}</span>
          ${tripBtnHtml}
        </div>
        <div>Abfahrt: <strong>${depTime}</strong> ${escapeHtml(leg.from.name)}${depTrack}</div>
        <div>Ankunft: <strong>${arrTime}</strong> ${escapeHtml(leg.to.name)}${arrTrack}</div>
        <div class="trip-container"></div>
      `;

      if (leg.tripId) {
        const btn = legDiv.querySelector('.btn-trip-detail');
        const tripContainer = legDiv.querySelector('.trip-container');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleTripStops(leg.tripId, tripContainer, btn, leg.from, leg.to);
        });
      }
    }

    container.appendChild(legDiv);
  });
}

async function toggleTripStops(tripId, container, button, legFrom = null, legTo = null) {
  if (container.childElementCount > 0) {
    container.innerHTML = '';
    button.textContent = 'Zuglauf';
    return;
  }

  button.textContent = 'Lade…';
  try {
    const res = await fetch(`${PROXY}?action=trip&tripId=${encodeURIComponent(tripId)}`);
    const data = await res.json();

    if (data.error || !data.stops || data.stops.length === 0) {
      button.textContent = 'Keine Daten';
      return;
    }

    const listDiv = document.createElement('div');
    listDiv.className = 'trip-stops-list';

    let inUserLeg = false;

    data.stops.forEach(stop => {
      const arr = formatTime(stop.arrivalLive || stop.arrivalSched);
      const dep = formatTime(stop.departureLive || stop.departureSched);
      const timeDisplay = (arr !== '--:--' && dep !== '--:--' && arr !== dep) ? `${arr} / ${dep}` : (dep !== '--:--' ? dep : arr);
      const track = stop.track ? ` (Gl. ${escapeHtml(stop.track)})` : '';

      const isBoard = legFrom && isSameStop(stop, legFrom);
      const isAlight = legTo && isSameStop(stop, legTo);

      if (isBoard) inUserLeg = true;

      const stopRow = document.createElement('div');
      let highlightClass = '';

      if (isBoard) {
        highlightClass = 'board-stop';
      } else if (isAlight) {
        highlightClass = 'alight-stop';
      } else if (inUserLeg) {
        highlightClass = 'in-route';
      }

      stopRow.className = `trip-stop-item ${highlightClass}`;
      stopRow.innerHTML = `
        <span>${escapeHtml(stop.name)}${track}</span>
        <span>${timeDisplay}</span>
      `;
      listDiv.appendChild(stopRow);

      if (isAlight) inUserLeg = false;
    });

    container.appendChild(listDiv);
    button.textContent = 'Schliessen';
  } catch (err) {
    button.textContent = 'Fehler';
  }
}

function isSameStop(stopA, stopB) {
  if (stopA.stopId && stopB.id && stopA.stopId === stopB.id) return true;
  if (!stopA.name || !stopB.name) return false;

  const cleanA = stopA.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanB = stopB.name.toLowerCase().replace(/[^a-z0-9]/g, '');

  return cleanA.includes(cleanB) || cleanB.includes(cleanA);
}

async function handleBoardLoad() {
  const hintsContainer = document.getElementById('board-hint');
  const resultsContainer = document.getElementById('board-results');
  const tbody = document.getElementById('board-tbody');

  if (!state.boardStop) {
    hintsContainer.innerHTML = '<div class="error-hint">Bitte eine Haltestelle wählen.</div>';
    resultsContainer.style.display = 'none';
    return;
  }

  hintsContainer.innerHTML = '<div class="loading">Abfahrten werden geladen…</div>';
  resultsContainer.style.display = 'none';

  try {
    const boardId = state.boardStop.id || state.boardStop.stopId;
    const url = `${PROXY}?action=departures&stopId=${encodeURIComponent(boardId)}&n=25`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error || !data.departures || data.departures.length === 0) {
      hintsContainer.innerHTML = '<div class="empty-hint">Keine Abfahrten vorhanden.</div>';
      resultsContainer.style.display = 'none';
      return;
    }

    tbody.innerHTML = '';
    data.departures.forEach(dep => {
      const timeStr = formatTime(dep.live || dep.scheduled);
      const line = dep.line || dep.tripNumber || '?';
      const destination = dep.destination || 'Unbekannt';
      const track = dep.track || '–';

      const rawMode = dep.mode || 'RAIL';
      const mode = canonicalMode(rawMode);
      const agencyId = escapeHtml(dep.agencyId || '');
      const routeId = escapeHtml(dep.routeId || '');

      const mainRow = document.createElement('tr');
      mainRow.className = 'summary-row';

      let delayHtml = '';
      if (dep.delayMin && dep.delayMin !== 0) {
        delayHtml = `<span style="color:var(--error); font-size:0.75em; margin-left:2px;">+${dep.delayMin}'</span>`;
      }

      mainRow.innerHTML = `
        <td class="col-time"><strong>${timeStr}</strong>${delayHtml}</td>
        <td style="width:70px;">
          <div class="line-container">
            <span class="line-badge line-container" data-mode="${mode}" data-raw-mode="${escapeHtml(rawMode)}" data-agency-id="${agencyId}" data-line="${escapeHtml(line)}" data-route-id="${routeId}">${escapeHtml(line)}</span>
          </div>
        </td>
        <td style="white-space:normal;">${escapeHtml(destination)}</td>
        <td style="width:50px; text-align:right; color:var(--text-muted);">${escapeHtml(track)}</td>
      `;

      if (dep.tripId) {
        const detailRow = document.createElement('tr');
        detailRow.className = 'detail-row';
        detailRow.style.display = 'none';

        const detailTd = document.createElement('td');
        detailTd.colSpan = 4;
        detailTd.className = 'detail-content';

        detailRow.appendChild(detailTd);

        mainRow.addEventListener('click', () => {
          const isVisible = detailRow.style.display !== 'none';
          if (isVisible) {
            detailRow.style.display = 'none';
          } else {
            detailRow.style.display = 'table-row';
            if (detailTd.childElementCount === 0) {
              const dummyBtn = document.createElement('button');
              dummyBtn.className = 'btn-trip-detail';
              dummyBtn.style.display = 'none';
              toggleTripStops(dep.tripId, detailTd, dummyBtn);
            }
          }
        });

        tbody.appendChild(mainRow);
        tbody.appendChild(detailRow);
      } else {
        tbody.appendChild(mainRow);
      }
    });

    hintsContainer.innerHTML = '';
    resultsContainer.style.display = 'block';
  } catch (err) {
    hintsContainer.innerHTML = `<div class="error-hint">Fehler: ${escapeHtml(err.message)}</div>`;
    resultsContainer.style.display = 'none';
  }
}

function formatDurationHHMM(totalSeconds) {
  if (!totalSeconds) return '--:--';
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatTime(timestamp) {
  if (!timestamp) return '--:--';
  const date = typeof timestamp === 'number' && timestamp < 1e11
    ? new Date(timestamp * 1000)
    : new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}