const PROXY = 'proxy.php';

const state = {
  fromStop: null,
  toStop: null,
  boardStop: null
};

document.addEventListener('DOMContentLoaded', () => {
  setupAutocompletes();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('btn-search-route').addEventListener('click', handleRouteSearch);
  document.getElementById('btn-load-board').addEventListener('click', handleBoardLoad);
}

function debounce(func, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => func(...args), delay);
  };
}

function setupAutocompletes() {
  initAutocomplete('route-from-input', 'from-suggestions', (stop) => { state.fromStop = stop; });
  initAutocomplete('route-to-input', 'to-suggestions', (stop) => { state.toStop = stop; });
  initAutocomplete('board-station-input', 'board-suggestions', (stop) => { state.boardStop = stop; });
}

function initAutocomplete(inputId, suggestionsId, onSelect) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(suggestionsId);

  const fetchSuggestions = debounce(async (query) => {
    if (query.length < 2) {
      container.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(query)}`);
      const data = await res.json();

      container.innerHTML = '';
      const list = data.stations || data.results || [];
      if (!Array.isArray(list) || list.length === 0) {
        container.style.display = 'none';
        return;
      }

      list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.textContent = item.name;
        div.addEventListener('click', () => {
          input.value = item.name;
          onSelect(item);
          container.style.display = 'none';
        });
        container.appendChild(div);
      });

      container.style.display = 'block';
    } catch (err) {
      console.error('Autocomplete Fehler:', err);
    }
  }, 250);

  input.addEventListener('input', (e) => fetchSuggestions(e.target.value.trim()));

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !container.contains(e.target)) {
      container.style.display = 'none';
    }
  });
}

async function handleRouteSearch() {
  const resultsContainer = document.getElementById('routing-results');

  if (!state.fromStop || !state.toStop) {
    resultsContainer.innerHTML = '<div class="error-hint">Bitte Start- und Zielhaltestelle aus den Vorschlägen auswählen.</div>';
    return;
  }

  resultsContainer.innerHTML = 'Verbindungen werden geladen…';

  const timeInput = document.getElementById('route-time').value;
  let formattedTime = '';
  if (timeInput) {
    formattedTime = new Date(timeInput).toISOString();
  }

  try {
    let url = `${PROXY}?action=plan&fromPlace=${encodeURIComponent(state.fromStop.id)}&toPlace=${encodeURIComponent(state.toStop.id)}`;
    if (formattedTime) {
      url += `&time=${encodeURIComponent(formattedTime)}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    const connections = data.connections || data.itineraries || [];

    if (data.error || connections.length === 0) {
      resultsContainer.innerHTML = '<div class="empty-hint">Keine Verbindungen gefunden.</div>';
      return;
    }

    renderItineraries(connections, resultsContainer);
  } catch (err) {
    resultsContainer.innerHTML = `<div class="error-hint">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
  }
}

function renderItineraries(itineraries, container) {
  container.innerHTML = '';

  itineraries.forEach((itinerary) => {
    const startTime = formatTime(itinerary.startTime);
    const endTime = formatTime(itinerary.endTime);
    const durationMin = itinerary.duration ? Math.round(itinerary.duration / 60) : '--';

    const card = document.createElement('div');
    card.className = 'card';

    const legsSummary = itinerary.legs.map(leg => {
      if (leg.mode === 'WALK') return '🚶';
      const name = leg.line || leg.routeShortName || leg.mode || 'Zug';
      return `<span class="line-badge">${escapeHtml(name)}</span>`;
    }).join(' → ');

    card.innerHTML = `
      <div class="route-header">
        <span>${startTime} → ${endTime}</span>
        <span>Dauer: ${durationMin} min</span>
      </div>
      <div class="route-legs">${legsSummary}</div>
    `;

    container.appendChild(card);
  });
}

async function handleBoardLoad() {
  const resultsContainer = document.getElementById('board-results');

  if (!state.boardStop) {
    resultsContainer.innerHTML = '<div class="error-hint">Bitte eine Haltestelle aus den Vorschlägen auswählen.</div>';
    return;
  }

  resultsContainer.innerHTML = 'Abfahrten werden geladen…';

  try {
    const url = `${PROXY}?action=departures&stopId=${encodeURIComponent(state.boardStop.id)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error || !data.departures || data.departures.length === 0) {
      resultsContainer.innerHTML = '<div class="empty-hint">Keine Abfahrten vorhanden.</div>';
      return;
    }

    renderDepartures(data.departures, resultsContainer);
  } catch (err) {
    resultsContainer.innerHTML = `<div class="error-hint">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDepartures(departures, container) {
  container.innerHTML = '';

  departures.forEach(dep => {
    const timeStr = formatTime(dep.live || dep.scheduled);
    const line = dep.line || dep.tripNumber || '?';
    const destination = dep.destination || 'Unbekannt';
    const delayInfo = dep.delayMin ? ` <span style="color:#f87171;">(+${dep.delayMin}')</span>` : '';
    const trackInfo = dep.track ? ` <span style="color:var(--text-muted); font-size:0.85rem;">Gleis ${escapeHtml(dep.track)}</span>` : '';

    const row = document.createElement('div');
    row.className = 'dep-row';
    row.innerHTML = `
      <div>
        <span class="line-badge">${escapeHtml(line)}</span>
        <span style="margin-left: 0.5rem;">${escapeHtml(destination)}</span>
        ${trackInfo}
      </div>
      <div><strong>${timeStr}</strong>${delayInfo}</div>
    `;
    container.appendChild(row);
  });
}

function formatTime(timestamp) {
  if (!timestamp) return '--:--';
  const date = typeof timestamp === 'number' && timestamp < 1e11 ? new Date(timestamp * 1000) : new Date(timestamp);
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