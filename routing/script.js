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

function attachStationSearch(input, suggestions, key) {
  const search = debounce(async () => {
    const query = input.value.trim();
    suggestions.innerHTML = '';
    suggestions.style.display = 'none';
    selectedStations.delete(key);
    if (query.length < 1) return;

    try {
      let results = [];

      // First: Check if query matches a DIDOK abbreviation (case-insensitive)
      if (query.length <= 6) { // Abbreviations are typically short
        const abbrevMatches = getAbbrevsForStation(query);
        if (abbrevMatches.length > 0) {
          // Convert abbreviation results to station-like objects
          results = abbrevMatches.map(match => ({
            name: match.name,
            country: match.country,
            id: `didok:${match.country.toLowerCase()}:${query.toUpperCase()}`,
            isAbbrev: true,
            abbrev: query.toUpperCase()
          }));
        }
      }

      // Second: If no abbreviation match, search stations normally
      if (results.length === 0 && query.length >= 2) {
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

function renderLineBadge(leg) {
  const label = getLineLabel(leg);
  const attributes = [
    ['data-mode', leg.mode],
    ['data-raw-mode', leg.mode],
    ['data-line', label],
    ['data-agency-id', leg.agencyId],
    ['data-agency-name', leg.agencyName],
    ['data-route-id', leg.routeId],
    ['data-trip-number', leg.tripNumber]
  ]
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join(' ');

  return `<span class="route-leg line-container line-badge" ${attributes} title="${escapeHtml(leg.destination || '')}">${escapeHtml(label)}</span>`;
}

function renderRoutes(connections) {
  routeTbody.innerHTML = '';
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
      <td class="route-legs">${legs.map(renderLineBadge).join('')}</td>
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
  const from = selectedStations.get('from');
  const to = selectedStations.get('to');
  if (!from || !to) {
    setHint(routeHint, 'Bitte Start und Ziel aus den Vorschlägen auswählen.', true);
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
    console.log('🔍 Routing Request URL:', url);
    console.log('📍 From:', from);
    console.log('📍 To:', to);
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('📊 API Response:', data);
    console.log('✅ Response OK:', response.ok);
    console.log('❌ Data Error:', data.error);
    
    if (!response.ok || data.error) {
      const errorMsg = data.error || `Routing fehlgeschlagen (${response.status})`;
      console.error('🚨 Error:', errorMsg);
      throw new Error(errorMsg);
    }
    
    const connections = data.connections || data.itineraries || [];
    console.log('🚌 Connections found:', connections.length);
    
    renderRoutes(connections);
    setHint(routeHint, connections.length ? `${connections.length} Verbindungen gefunden.` : 'Keine Verbindung gefunden.');
  } catch (error) {
    console.error('💥 Catch Error:', error);
    setHint(routeHint, error.message, true);
  }
}

async function loadBoard() {
  const station = selectedStations.get('board');
  if (!station) {
    setHint(boardHint, 'Bitte eine Haltestelle aus den Vorschlägen auswählen.', true);
    return;
  }
  setHint(boardHint, 'Lade Abfahrten...');
  try {
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

function adjustRouteTime(minutes) {
  const currentTime = routeTimeInput.value;
  let date;
  
  if (currentTime) {
    date = new Date(currentTime);
  } else {
    date = new Date();
  }
  
  date.setMinutes(date.getMinutes() + minutes);
  
  // Format: YYYY-MM-DDTHH:mm (HTML5 datetime-local format)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  
  routeTimeInput.value = `${year}-${month}-${day}T${hours}:${mins}`;
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

const btnEarlier = document.getElementById('btn-earlier');
if (btnEarlier) {
  btnEarlier.addEventListener('click', () => {
    adjustRouteTime(-30);
    searchRoute();
  });
}

const btnLater = document.getElementById('btn-later');
if (btnLater) {
  btnLater.addEventListener('click', () => {
    adjustRouteTime(30);
    searchRoute();
  });
}

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