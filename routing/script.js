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
    if (query.length < 2) return;

    try {
      const stations = await searchStations(query);
      stations.slice(0, 8).forEach(station => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = station.name;
        item.addEventListener('click', () => {
          input.value = station.name;
          selectedStations.set(key, station);
          suggestions.innerHTML = '';
          suggestions.style.display = 'none';
        });
        suggestions.appendChild(item);
      });
      suggestions.style.display = stations.length ? 'block' : 'none';
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
    ['data-agency-name', leg.agencyName]
  ]
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join(' ');

  return `<span class="route-leg line-container line-badge" ${attributes} title="${escapeHtml(leg.destination || '')}">${escapeHtml(label)}</span>`;
}

function renderRoutes(connections) {
  routeTbody.innerHTML = '';
  connections.forEach(connection => {
    const legs = connection.legs || [];
    const first = legs[0]?.from || {};
    const last = legs[legs.length - 1]?.to || {};
    const row = document.createElement('tr');
    row.className = 'route-row';
    row.innerHTML = `
      <td>${formatTime(first.departure)}</td>
      <td>${formatTime(last.arrival)}</td>
      <td>${formatDuration(connection.duration || (last.arrival - first.departure))}</td>
      <td class="route-legs">${legs.map(renderLineBadge).join('')}</td>
      <td>${Math.max(0, legs.length - 1)}</td>
    `;
    routeTbody.appendChild(row);
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
    const response = await fetch(`${PROXY}?${params}`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `Routing fehlgeschlagen (${response.status})`);
    const connections = data.connections || data.itineraries || [];
    renderRoutes(connections);
    setHint(routeHint, connections.length ? `${connections.length} Verbindungen gefunden.` : 'Keine Verbindung gefunden.');
  } catch (error) {
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
        <td><span class="line-container line-badge" data-line="${escapeHtml(departure.line || '?')}">${escapeHtml(departure.line || '?')}</span></td>
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

attachStationSearch(routeFromInput, document.getElementById('from-suggestions'), 'from');
attachStationSearch(routeToInput, document.getElementById('to-suggestions'), 'to');
attachStationSearch(boardInput, document.getElementById('board-suggestions'), 'board');
document.getElementById('btn-add-via').addEventListener('click', createViaInput);
document.getElementById('btn-search-route').addEventListener('click', searchRoute);
document.getElementById('btn-load-board').addEventListener('click', loadBoard);
document.getElementById('btn-refresh').addEventListener('click', () => location.reload());

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
