const PROXY = 'proxy.php';

const routeFromInput = document.getElementById('route-from-input');
const routeToInput = document.getElementById('route-to-input');
const routeDateInput = document.getElementById('route-date');
const routeTimeInput = document.getElementById('route-time');
const btnModeDep = document.getElementById('btn-mode-dep');
const btnModeArr = document.getElementById('btn-mode-arr');
const btnEarlier = document.getElementById('btn-earlier');
const btnLater = document.getElementById('btn-later');
const routeTbody = document.getElementById('routing-tbody');
const routeResults = document.getElementById('routing-results');
const routeHint = document.getElementById('routing-hint');
const boardInput = document.getElementById('board-station-input');
const boardTbody = document.getElementById('board-tbody');
const boardResults = document.getElementById('board-results');
const boardHint = document.getElementById('board-hint');

const selectedStations = new Map();
let viaCount = 0;
let arriveBy = false;
let pageState = { params: null, connections: [], prev: null, next: null };

const isWalk = leg => leg.mode === 'WALK';

// ─── Abkürzungs-Mappings ───────────────────────────────────────────────────
let abbrevMap = {};      // { abbrev: [{ name, country }, ...] }
let nameToAbbrevMap = {}; // { normName: [{ abbrev, country }, ...] }

/**
 * Load all DIDOK JSON files from ../didok/ and merge into maps
 * Creates two mappings for bidirectional lookup
 */
async function loadAbbreviations() {
  const countries = ['custom', 'ch', 'de', 'at', 'fr', 'uk', 'libero', 'zvv', 'awelle'];
  try {
    for (const country of countries) {
      try {
        const res = await fetch(`../didok/${country}.json`);
        if (res.ok) {
          const data = await res.json();
          Object.entries(data).forEach(([abbrev, name]) => {
            if (!abbrevMap[abbrev]) {
              abbrevMap[abbrev] = [];
            }
            const countryCode = country.toUpperCase();
            abbrevMap[abbrev].push({ name, country: countryCode });

            const normName = name.trim().toLowerCase();
            if (!nameToAbbrevMap[normName]) {
              nameToAbbrevMap[normName] = [];
            }
            nameToAbbrevMap[normName].push({ abbrev, country: countryCode });
          });
        }
      } catch (e) {
        console.warn(`Konnte ../didok/${country}.json nicht laden:`, e);
      }
    }
    console.log('Abkürzungs-Mappings geladen:', Object.keys(abbrevMap).length, 'Abkürzungen');
  } catch (err) {
    console.error('Fehler beim Laden der Abkürzungs-Mappings:', err);
  }
}

/**
 * Look up abbreviation in abbrevMap
 * Returns array of matches: [{ name, country }, ...]
 */
function getAbbrevsForStation(abbrev) {
  if (!abbrev) return [];
  const upperAbbrev = abbrev.toUpperCase().trim();
  const entries = abbrevMap[upperAbbrev] || [];
  
  // Sort by country: custom, CH, DE, AT, FR, UK
  const countryOrder = { CUSTOM: 0, CH: 1, DE: 2, AT: 3, FR: 4, UK: 5 };
  return entries.sort((a, b) => 
    (countryOrder[a.country] || 999) - (countryOrder[b.country] || 999)
  );
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function setHint(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error-hint', isError);
}

function debounce(callback, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

async function searchStations(query) {
  const response = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`Stationssuche fehlgeschlagen (${response.status})`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.stations || [];
}

async function resolveStationId(station) {
  if (station?.id) return station.id;
  const matches = await searchStations(station?.name || '');
  const exactMatch = matches.find(match =>
    match.name.trim().toLowerCase() === station.name.trim().toLowerCase()
  );
  return (exactMatch || matches[0])?.id || null;
}

/**
 * Suggestion-Zeile: Name (mit Kürzel) links, Location-ID klein und grau rechts
 */
function fillSuggestion(item, station) {
  const abbrev = station.isAbbrev
    ? ` <span class="abbrev-label">${escapeHtml(station.abbrev)} [${escapeHtml(station.country)}]</span>`
    : '';
  const id = station.id ? `<span class="suggestion-id">${escapeHtml(station.id)}</span>` : '';
  item.innerHTML = `<span class="suggestion-name">${escapeHtml(station.name)}${abbrev}</span>${id}`;
}

function attachStationSearch(input, suggestions, key) {
  const search = debounce(async () => {
    const query = input.value.trim();
    suggestions.innerHTML = '';
    suggestions.style.display = 'none';
    selectedStations.delete(key);
    if (query.length < 1) return;

    try {
      let results = [];
      let selectedAbbrev = null;

      // First: Check if query matches a DIDOK abbreviation (case-insensitive)
      if (query.length <= 6) { // Abbreviations are typically short
        const abbrevMatches = getAbbrevsForStation(query);
        if (abbrevMatches.length > 0) {
          selectedAbbrev = abbrevMatches[0]; // Take first match
        }
      }

      if (selectedAbbrev) {
        results = [{
          id: null,
          name: selectedAbbrev.name.trim(),
          isAbbrev: true,
          abbrev: query.toUpperCase(),
          country: selectedAbbrev.country
        }];
      } else if (query.length >= 2) {
        results = await searchStations(query);
      }

      // Display results (max 8)
      results.slice(0, 8).forEach(station => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        fillSuggestion(item, station);
        
        item.addEventListener('click', () => {
          input.value = station.name;
          selectedStations.set(key, station);
          suggestions.innerHTML = '';
          suggestions.style.display = 'none';
        });
        suggestions.appendChild(item);

        if (station.isAbbrev) {
          searchStations(station.name)
            .then(stations => stations.find(match =>
              match.name.trim().toLowerCase() === station.name.trim().toLowerCase()
            ) || stations[0])
            .then(match => {
              if (!match || !item.isConnected) return;
              station.id = match.id;
              fillSuggestion(item, station);
            })
            .catch(() => {});
        }
      });
      suggestions.style.display = results.length ? 'block' : 'none';
    } catch (error) {
      setHint(key === 'board' ? boardHint : routeHint, error.message, true);
    }
  }, 300);

  input.addEventListener('input', search);
}

function createViaInput() {
  viaCount += 1;
  const key = `via-${viaCount}`;
  const group = document.createElement('div');
  group.className = 'form-group via-group';
  group.innerHTML = `
    <label for="${key}">Via</label>
    <input type="text" id="${key}" placeholder="Zwischenhalt..." autocomplete="off">
    <div class="suggestions"></div>
  `;
  document.getElementById('via-list-container').appendChild(group);
  attachStationSearch(group.querySelector('input'), group.querySelector('.suggestions'), key);
}

function formatTime(epoch) {
  if (!epoch) return '–';
  return new Date(Number(epoch) * 1000).toLocaleTimeString('de-CH', {
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDuration(seconds) {
  const minutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60}min`;
}

function updateClock() {
  const clock = document.getElementById('live-clock');
  if (!clock) return;
  const now = new Date();
  clock.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(value => String(value).padStart(2, '0'))
    .join(':');
}

function getLineLabel(leg) {
  return leg.routeShortName || leg.line || leg.mode || '?';
}

function getLineAttributes(leg) {
  return [
    ['data-mode', leg.mode],
    ['data-raw-mode', leg.mode],
    ['data-line', getLineLabel(leg)],
    ['data-agency-id', leg.agencyId],
    ['data-agency-name', leg.agencyName],
    ['data-route-id', leg.routeId],
    ['data-trip-number', leg.tripNumber]
  ]
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join(' ');
}

function renderLineBadge(leg) {
  const label = getLineLabel(leg);
  const attributes = getLineAttributes(leg);
  return `<span class="route-leg line-container line-badge" ${attributes} title="${escapeHtml(leg.destination || '')}">${escapeHtml(label)}</span>`;
}

/**
 * Render a proportional timeline bar with one segment per leg.
 * Transit legs are colored via line-container, walks are a thin line,
 * gaps between legs (Umsteigezeit) are striped.
 */
function renderTimelineBar(connection, minDeparture, maxArrival) {
  const legs = connection.legs || [];
  const range = maxArrival - minDeparture;
  if (!legs.length || range <= 0) return '';
  const pct = t => ((t - minDeparture) / range) * 100;

  const parts = legs.map((leg, i) => {
    const dep = leg.from?.departure || 0;
    const arr = leg.to?.arrival || 0;
    const left = pct(dep);
    const width = Math.max(pct(arr) - left, 0.8);
    const tip = `${getLineLabel(leg)}: ${formatTime(dep)} → ${formatTime(arr)}`;
    let html = '';

    const prevArr = legs[i - 1]?.to?.arrival;
    if (prevArr && dep > prevArr) {
      html += `<div class="timeline-wait" style="left:${pct(prevArr)}%;width:${left - pct(prevArr)}%"
        title="Umsteigen ${formatDuration(dep - prevArr)}"></div>`;
    }

    if (isWalk(leg)) {
      html += `<div class="timeline-walk" style="left:${left}%;width:${width}%" title="${escapeHtml(tip)}"></div>`;
    } else {
      html += `<div class="timeline-segment line-container" ${getLineAttributes(leg)}
        style="left:${left}%;width:${width}%" title="${escapeHtml(tip)}">${width >= 9 ? escapeHtml(getLineLabel(leg)) : ''}</div>`;
    }
    return html;
  });

  return `<div class="timeline-bar">${parts.join('')}</div>`;
}

/**
 * Detailansicht: jede Fahrt als Block mit Linie, Fahrtnummer, Halten;
 * zwischen den Fahrten die Umsteigezeit (inkl. Fussweg und Gleiswechsel).
 */
function renderLegDetails(legs) {
  let html = '';
  let prevTransit = null;
  let walkSec = 0;

  legs.forEach((leg, i) => {
    const from = leg.from || {};
    const to = leg.to || {};

    if (isWalk(leg)) {
      const sec = (to.arrival || 0) - (from.departure || 0);
      const laterTransit = legs.slice(i + 1).some(l => !isWalk(l));
      if (prevTransit && laterTransit) {
        walkSec += sec;
        return;
      }
      html += `<div class="walk-row">Fussweg ${formatDuration(sec)}</div>`;
      return;
    }

    if (prevTransit) {
      const gap = (from.departure || 0) - (prevTransit.to?.arrival || 0);
      const a = prevTransit.to?.track;
      const b = from.track;
      const tracks = a && b ? ` · Gl. ${escapeHtml(a)} → ${escapeHtml(b)}` : '';
      const walk = walkSec ? ` (davon Fussweg ${formatDuration(walkSec)})` : '';
      html += `<div class="transfer-row${gap < 240 ? ' tight' : ''}">Umsteigen ${formatDuration(gap)}${walk}${tracks}</div>`;
      walkSec = 0;
    }

    const number = leg.tripNumber && String(leg.tripNumber) !== getLineLabel(leg)
      ? `<span class="leg-number">Nr. ${escapeHtml(leg.tripNumber)}</span>`
      : '';
    const stop = (time, name, track) => `
      <div class="leg-stop">
        <span class="leg-time">${formatTime(time)}</span>
        <span class="leg-name">${escapeHtml(name || '')}</span>
        <span class="leg-track">${track ? `Gl. ${escapeHtml(track)}` : ''}</span>
      </div>`;

    html += `
      <div class="leg-block">
        <div class="leg-header">
          ${renderLineBadge(leg)}${number}
          <span class="leg-dest">${leg.destination ? `→ ${escapeHtml(leg.destination)}` : ''}</span>
        </div>
        ${stop(from.departure, from.name, from.track)}
        ${stop(to.arrival, to.name, to.track)}
      </div>`;
    prevTransit = leg;
  });

  return html;
}

function renderRoutes(connections) {
  routeTbody.innerHTML = '';
  
  if (connections.length === 0) return;
  
  // Calculate min/max times for proportional timeline scaling
  let minDeparture = Infinity;
  let maxArrival = -Infinity;
  
  connections.forEach(conn => {
    const legs = conn.legs || [];
    if (legs.length === 0) return;
    const dep = legs[0]?.from?.departure || 0;
    const arr = legs[legs.length - 1]?.to?.arrival || 0;
    minDeparture = Math.min(minDeparture, dep);
    maxArrival = Math.max(maxArrival, arr);
  });
  
  connections.forEach((connection, connIdx) => {
    const legs = connection.legs || [];
    const first = legs[0]?.from || {};
    const last = legs[legs.length - 1]?.to || {};
    
    // Summary Row
    const row = document.createElement('tr');
    row.className = 'summary-row';
    row.innerHTML = `
      <td>${formatTime(first.departure)}</td>
      <td>${formatTime(last.arrival)}</td>
      <td>${formatDuration(connection.duration || (last.arrival - first.departure))}</td>
      <td class="route-timeline">${renderTimelineBar(connection, minDeparture, maxArrival)}</td>
      <td>${Math.max(0, legs.length - 1)}</td>
    `;
    
    row.addEventListener('click', () => {
      const detailRow = document.getElementById(`detail-row-${connIdx}`);
      if (detailRow) {
        detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
      }
    });
    
    routeTbody.appendChild(row);
    
    // Detail Row
    const detailRow = document.createElement('tr');
    detailRow.className = 'detail-row';
    detailRow.id = `detail-row-${connIdx}`;
    detailRow.style.display = 'none';
    
    const detailContent = document.createElement('td');
    detailContent.colSpan = 5;
    detailContent.className = 'detail-content';
    detailContent.innerHTML = `<div class="leg-list">${renderLegDetails(legs)}</div>`;
    
    detailRow.appendChild(detailContent);
    routeTbody.appendChild(detailRow);
  });
  
  routeResults.style.display = connections.length ? 'block' : 'none';
}

async function searchRoute() {
  let from = selectedStations.get('from');
  let to = selectedStations.get('to');
  
  if (!from || !to) {
    setHint(routeHint, 'Bitte Start und Ziel aus den Vorschlägen auswählen.', true);
    return;
  }

  try {
    from = { ...from, id: await resolveStationId(from) };
    to = { ...to, id: await resolveStationId(to) };
    if (!from.id || !to.id) throw new Error('Start oder Ziel konnte nicht aufgelöst werden.');
    selectedStations.set('from', from);
    selectedStations.set('to', to);
  } catch (error) {
    setHint(routeHint, error.message, true);
    return;
  }

  const params = new URLSearchParams({
    action: 'plan',
    fromPlace: from.id,
    toPlace: to.id,
    arriveBy: String(arriveBy),
    time: getRouteDate().toISOString()
  });
  document.querySelectorAll('#via-list-container input').forEach(input => {
    const station = selectedStations.get(input.id);
    if (station) params.append('via', station.id);
  });

  pageState = { params, connections: [], prev: null, next: null };
  routeResults.style.display = 'none';
  await loadPage();
}

/**
 * Lädt Verbindungen. Ohne direction: neue Suche.
 * 'earlier' / 'later': hängt die vorherige bzw. nächste Seite an die Liste an.
 */
async function loadPage(direction) {
  const params = new URLSearchParams(pageState.params);
  if (direction === 'earlier') params.set('pageCursor', pageState.prev);
  if (direction === 'later') params.set('pageCursor', pageState.next);

  setHint(routeHint, 'Suche Verbindungen...');
  try {
    const response = await fetch(`${PROXY}?${params}`);
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || `Routing fehlgeschlagen (${response.status})`);
    }

    const found = data.connections || data.itineraries || [];
    if (direction === 'earlier') pageState.connections = [...found, ...pageState.connections];
    else if (direction === 'later') pageState.connections = [...pageState.connections, ...found];
    else pageState.connections = found;

    if (direction !== 'later') pageState.prev = data.previousPageCursor || null;
    if (direction !== 'earlier') pageState.next = data.nextPageCursor || null;

    renderRoutes(pageState.connections);
    btnEarlier.disabled = !pageState.prev;
    btnLater.disabled = !pageState.next;

    const count = pageState.connections.length;
    setHint(routeHint, count ? `${count} Verbindungen gefunden.` : 'Keine Verbindung gefunden.');
  } catch (error) {
    console.error('Routing-Fehler:', error);
    setHint(routeHint, error.message, true);
  }
}

async function loadBoard() {
  let station = selectedStations.get('board');
  if (!station) {
    setHint(boardHint, 'Bitte eine Haltestelle aus den Vorschlägen auswählen.', true);
    return;
  }
  setHint(boardHint, 'Lade Abfahrten...');
  try {
    station = { ...station, id: await resolveStationId(station) };
    if (!station.id) throw new Error('Haltestelle konnte nicht aufgelöst werden.');
    selectedStations.set('board', station);
    const response = await fetch(`${PROXY}?action=departures&stopId=${encodeURIComponent(station.id)}&n=25`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `Abfahrten konnten nicht geladen werden (${response.status})`);
    boardTbody.innerHTML = (data.departures || []).map(departure => `
      <tr>
        <td>${formatTime(departure.scheduled || departure.live)}</td>
        <td>${renderLineBadge({
          line: departure.line,
          routeShortName: departure.line,
          mode: departure.mode,
          agencyId: departure.agencyId,
          agencyName: departure.agencyName,
          destination: departure.destination,
          tripNumber: departure.tripNumber,
          routeId: departure.routeId
        })}</td>
        <td>${escapeHtml(departure.destination || '')}</td>
        <td>${escapeHtml(departure.track || '')}</td>
      </tr>
    `).join('');
    boardResults.style.display = data.departures?.length ? 'block' : 'none';
    setHint(boardHint, data.departures?.length ? `${data.departures.length} Abfahrten geladen.` : 'Keine Abfahrten gefunden.');
  } catch (error) {
    setHint(boardHint, error.message, true);
  }
}

// ─── Datum und Zeit ────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const toDateValue = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function updateDateLabel() {
  const label = document.getElementById('route-date-label');
  if (!label) return;
  if (!routeDateInput.value) {
    label.textContent = '';
    return;
  }
  const d = new Date(`${routeDateInput.value}T12:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const rel = { '-1': 'Gestern', '0': 'Heute', '1': 'Morgen' }[diff] || '';
  label.textContent = [
    rel,
    d.toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' })
  ].filter(Boolean).join(' · ');
}

function setRouteNow() {
  const now = new Date();
  routeDateInput.value = toDateValue(now);
  routeTimeInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  updateDateLabel();
}

function adjustRouteDate(days) {
  const d = routeDateInput.value ? new Date(`${routeDateInput.value}T12:00`) : new Date();
  d.setDate(d.getDate() + days);
  routeDateInput.value = toDateValue(d);
  updateDateLabel();
}

function getRouteDate() {
  if (!routeDateInput.value) return new Date();
  return new Date(`${routeDateInput.value}T${routeTimeInput.value || '00:00'}`);
}

function setMode(arrive) {
  arriveBy = arrive;
  btnModeDep.classList.toggle('active', !arrive);
  btnModeArr.classList.toggle('active', arrive);
}

function swapFromTo() {
  const from = selectedStations.get('from');
  const to = selectedStations.get('to');
  
  if (from && to) {
    selectedStations.set('from', to);
    selectedStations.set('to', from);
    routeFromInput.value = to.name;
    routeToInput.value = from.name;
  }
}

// Load abbreviations on page load
loadAbbreviations();

attachStationSearch(routeFromInput, document.getElementById('from-suggestions'), 'from');
attachStationSearch(routeToInput, document.getElementById('to-suggestions'), 'to');
attachStationSearch(boardInput, document.getElementById('board-suggestions'), 'board');
document.getElementById('btn-add-via').addEventListener('click', createViaInput);
document.getElementById('btn-search-route').addEventListener('click', searchRoute);
document.getElementById('btn-load-board').addEventListener('click', loadBoard);
document.getElementById('btn-refresh').addEventListener('click', () => location.reload());
document.getElementById('btn-swap').addEventListener('click', swapFromTo);

// Datum, Zeit, Modus
btnModeDep.addEventListener('click', () => setMode(false));
btnModeArr.addEventListener('click', () => setMode(true));
document.getElementById('btn-now').addEventListener('click', setRouteNow);
document.getElementById('btn-date-prev').addEventListener('click', () => adjustRouteDate(-1));
document.getElementById('btn-date-next').addEventListener('click', () => adjustRouteDate(1));
routeDateInput.addEventListener('change', updateDateLabel);

// Früher / Später
btnEarlier.addEventListener('click', () => loadPage('earlier'));
btnLater.addEventListener('click', () => loadPage('later'));

setRouteNow();
updateClock();
setInterval(updateClock, 1000);

document.addEventListener('click', event => {
  if (!event.target.closest('.form-group')) {
    document.querySelectorAll('.suggestions').forEach(list => {
      list.innerHTML = '';
      list.style.display = 'none';
    });
  }
});