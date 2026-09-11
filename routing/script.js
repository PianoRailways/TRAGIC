const PROXY = 'proxy.php';

const routeFromInput = document.getElementById('route-from-input');
const routeToInput = document.getElementById('route-to-input');
const routeTimeInput = document.getElementById('route-time');
const routeTbody = document.getElementById('routing-tbody');
const routeResults = document.getElementById('routing-results');
const routeHint = document.getElementById('routing-hint');
const boardInput = document.getElementById('board-station-input');
const boardTbody = document.getElementById('board-tbody');
const boardResults = document.getElementById('board-results');
const boardHint = document.getElementById('board-hint');

const selectedStations = new Map();
let viaCount = 0;

// ─── Abkürzungs-Mappings ───────────────────────────────────────────────────
let abbrevMap = {};      // { abbrev: [{ name, country }, ...] }
let nameToAbbrevMap = {}; // { normName: [{ abbrev, country }, ...] }

/**
 * Load all DIDOK JSON files from ../didok/ and merge into maps
 * Creates two mappings for bidirectional lookup
 */
async function loadAbbreviations() {
  const countries = ['custom', 'ch', 'de', 'at', 'fr', 'uk'];
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
        
        // Show abbreviation matches with country indicator
        if (station.isAbbrev) {
          item.textContent = `${station.name} (${station.abbrev} [${station.country}])`;
        } else {
          item.textContent = station.name;
        }
        
        item.addEventListener('click', () => {
          input.value = station.name;
          selectedStations.set(key, station);
          suggestions.innerHTML = '';
          suggestions.style.display = 'none';
        });
        suggestions.appendChild(item);
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
 * Render a proportional timeline bar showing journey duration relative to all connections.
 * The bar starts at 0% and extends to (arrival - departure) / (maxArrival - minDeparture).
 * Colors are applied via line-container CSS rules based on the first leg.
 */
function renderTimelineBar(connection, minDeparture, maxArrival) {
  const legs = connection.legs || [];
  if (legs.length === 0) return '';
  
  const firstLeg = legs[0];
  const departure = firstLeg?.from?.departure || 0;
  const arrival = legs[legs.length - 1]?.to?.arrival || 0;
  
  // Time range for proportional scaling
  const timeRange = maxArrival - minDeparture;
  if (timeRange <= 0) return '<!-- Empty time range -->';
  
  // Calculate start position (% from minDeparture) and width (% of timeRange)
  const startPercent = ((departure - minDeparture) / timeRange) * 100;
  const durationPercent = ((arrival - departure) / timeRange) * 100;
  
  // Get line attributes from first leg for coloring
  const attributes = getLineAttributes(firstLeg);
  
  const barHTML = `
    <div class="timeline-bar" style="width: 100%;">
      <div class="timeline-dot"></div>
      <div 
        class="timeline-segment line-container" 
        ${attributes}
        style="
          margin-left: ${startPercent}%;
          width: ${durationPercent}%;
          min-width: 2px;
        "
        title="Abfahrt: ${formatTime(departure)}, Ankunft: ${formatTime(arrival)}"
      ></div>
    </div>
  `;
  
  return barHTML;
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
    
    const legsList = document.createElement('div');
    legsList.className = 'trip-stops-list';
    
    legs.forEach((leg, legIdx) => {
      const legItem = document.createElement('div');
      legItem.className = 'leg-item';
      
      const from = leg.from || {};
      const to = leg.to || {};
      
      const legHeader = document.createElement('div');
      legHeader.className = 'leg-header';
      legHeader.innerHTML = `
        ${renderLineBadge(leg)}
        <span>${escapeHtml(to.name || '')}</span>
      `;
      legItem.appendChild(legHeader);
      
      const legTimes = document.createElement('div');
      legTimes.style.fontSize = '0.75rem';
      legTimes.style.color = 'var(--text-muted)';
      legTimes.innerHTML = `
        ${escapeHtml(from.name || '')}: ${formatTime(from.departure)} →
        ${escapeHtml(to.name || '')}: ${formatTime(to.arrival)}
      `;
      legItem.appendChild(legTimes);
      
      if (legIdx < legs.length - 1) {
        const transfer = document.createElement('div');
        transfer.className = 'transfer-info';
        const nextLeg = legs[legIdx + 1];
        const transferTime = (nextLeg?.from?.departure || 0) - (to.arrival || 0);
        transfer.textContent = `Umstieg: ${formatDuration(transferTime)}`;
        legItem.appendChild(transfer);
      }
      
      legsList.appendChild(legItem);
    });
    
    detailContent.appendChild(legsList);
    detailRow.appendChild(detailContent);
    routeTbody.appendChild(detailRow);
  });
  
  routeResults.style.display = connections.length ? 'block' : 'none';
}

async function searchRoute() {
  let from = selectedStations.get('from');
  let to = selectedStations.get('to');
  
  console.log('🔴 searchRoute called');
  console.log('📍 From object:', from);
  console.log('📍 To object:', to);
  console.log('📍 From.id:', from?.id);
  console.log('📍 To.id:', to?.id);
  
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

  const params = new URLSearchParams({ action: 'plan', fromPlace: from.id, toPlace: to.id });
  if (routeTimeInput.value) params.set('time', new Date(routeTimeInput.value).toISOString());
  document.querySelectorAll('#via-list-container input').forEach(input => {
    const station = selectedStations.get(input.id);
    if (station) params.append('via', station.id);
  });

  setHint(routeHint, 'Suche Verbindungen...');
  routeResults.style.display = 'none';
  try {
    const url = `${PROXY}?${params}`;
    console.log('🔍 Full URL:', url);
    console.log('📍 fromPlace:', from.id);
    console.log('📍 toPlace:', to.id);
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('📊 Full API Response:', JSON.stringify(data, null, 2));
    console.log('✅ Response status:', response.status);
    console.log('✅ Response OK:', response.ok);
    console.log('❌ Data.error:', data.error);
    
    if (!response.ok || data.error) {
      const errorMsg = data.error || `Routing fehlgeschlagen (${response.status})`;
      console.error('🚨 Throwing Error:', errorMsg);
      throw new Error(errorMsg);
    }
    
    const connections = data.connections || data.itineraries || [];
    console.log('🚌 Connections found:', connections.length);
    
    renderRoutes(connections);
    setHint(routeHint, connections.length ? `${connections.length} Verbindungen gefunden.` : 'Keine Verbindung gefunden.');
  } catch (error) {
    console.error('💥 Catch Error:', error.message);
    console.error('💥 Full Error:', error);
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

function adjustRouteTime(days) {
  const currentTime = routeTimeInput.value;
  let date;
  
  if (currentTime) {
    date = new Date(currentTime);
  } else {
    date = new Date();
  }
  
  date.setDate(date.getDate() + days);
  
  // Format: YYYY-MM-DDTHH:mm (HTML5 datetime-local format)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  
  routeTimeInput.value = `${year}-${month}-${day}T${hours}:${mins}`;
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

// Date navigation
document.getElementById('btn-date-prev').addEventListener('click', () => {
  adjustRouteTime(-1);
});

document.getElementById('btn-date-next').addEventListener('click', () => {
  adjustRouteTime(1);
});

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