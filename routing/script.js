const PROXY = 'proxy.php';

const state = {
  fromStop: null,
  toStop: null,
  boardStop: null
};

document.addEventListener('DOMContentLoaded', () => {
  setupLiveClock();
  setupAutocompletes();
  setupEventListeners();
});

function setupLiveClock() {
  const clock = document.getElementById('live-clock');
  const updateTime = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    clock.textContent = `${h}:${m}:${s}`;
  };
  updateTime();
  setInterval(updateTime, 1000);
}

function setupEventListeners() {
  document.getElementById('btn-search-route').addEventListener('click', handleRouteSearch);
  document.getElementById('btn-load-board').addEventListener('click', handleBoardLoad);
  document.getElementById('btn-refresh').addEventListener('click', () => {
    document.getElementById('route-time').value = '';
    document.getElementById('board-station-input').value = '';
  });
  document.getElementById('btn-home').addEventListener('click', () => {
    window.location.href = '/';
  });
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
      console.error('Autocomplete error:', err);
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
  const hintsContainer = document.getElementById('routing-hint');
  const resultsContainer = document.getElementById('routing-results');
  const tbody = document.getElementById('routing-tbody');

  if (!state.fromStop || !state.toStop) {
    hintsContainer.innerHTML = '<div class="error-hint">Bitte Start- und Zielstation wählen.</div>';
    resultsContainer.style.display = 'none';
    return;
  }

  hintsContainer.innerHTML = '<div class="loading">Verbindungen werden geladen…</div>';
  resultsContainer.style.display = 'none';

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
      hintsContainer.innerHTML = '<div class="empty-hint">Keine Verbindungen gefunden.</div>';
      resultsContainer.style.display = 'none';
      return;
    }

    tbody.innerHTML = '';
    connections.forEach((conn) => {
      const startTime = formatTime(conn.startTime);
      const endTime = formatTime(conn.endTime);
      const duration = conn.duration ? Math.round(conn.duration / 60) : '--';
      const transfers = conn.transfers || 0;

      const legsSummary = conn.legs
        .map(leg => leg.line || leg.routeShortName || leg.mode || '?')
        .join(' → ');

      const mainRow = document.createElement('tr');
      mainRow.className = 'summary-row';
      mainRow.innerHTML = `
        <td class="col-time">${startTime}</td>
        <td class="col-time">${endTime}</td>
        <td>${duration} min</td>
        <td><small>${escapeHtml(legsSummary)}</small></td>
        <td>${transfers}</td>
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

    if (leg.mode === 'WALK') {
      const walkDuration = (leg.from.departure && leg.to.arrival)
        ? Math.round((leg.to.arrival - leg.from.departure) / 60)
        : '';
      legDiv.innerHTML = `
        <div class="leg-header">
          <span class="line-container" data-mode="WALK">Fußweg</span>
          <span>${walkDuration ? walkDuration + ' min' : ''} nach ${escapeHtml(leg.to.name)}</span>
        </div>
      `;
    } else {
      const depTime = formatTime(leg.from.departure);
      const arrTime = formatTime(leg.to.arrival);
      const depTrack = leg.from.track ? ` (Gleis ${escapeHtml(leg.from.track)})` : '';
      const arrTrack = leg.to.track ? ` (Gleis ${escapeHtml(leg.to.track)})` : '';
      const headsign = leg.destination ? ` Richtg. ${escapeHtml(leg.destination)}` : '';

      let tripButtonHtml = '';
      if (leg.tripId) {
        tripButtonHtml = `<button class="btn-trip-detail" data-trip-id="${escapeHtml(leg.tripId)}">Zuglauf anzeigen</button>`;
      }

      legDiv.innerHTML = `
        <div class="leg-header">
          <span class="line-container" data-mode="${escapeHtml(leg.mode || 'RAIL')}">${escapeHtml(leg.line)}</span>
          <span>${headsign}</span>
          ${tripButtonHtml}
        </div>
        <div class="leg-station">
          <span>Abfahrt: <strong>${depTime}</strong> ${escapeHtml(leg.from.name)}${depTrack}</span>
        </div>
        <div class="leg-station">
          <span>Ankunft: <strong>${arrTime}</strong> ${escapeHtml(leg.to.name)}${arrTrack}</span>
        </div>
        <div class="trip-container"></div>
      `;

      if (leg.tripId) {
        const btn = legDiv.querySelector('.btn-trip-detail');
        const tripContainer = legDiv.querySelector('.trip-container');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleTripStops(leg.tripId, tripContainer, btn);
        });
      }
    }

    container.appendChild(legDiv);
  });
}

async function toggleTripStops(tripId, container, button) {
  if (container.childElementCount > 0) {
    container.innerHTML = '';
    button.textContent = 'Zuglauf anzeigen';
    return;
  }

  button.textContent = 'Lade Halte…';
  try {
    const res = await fetch(`${PROXY}?action=trip&tripId=${encodeURIComponent(tripId)}`);
    const data = await res.json();

    if (data.error || !data.stops || data.stops.length === 0) {
      button.textContent = 'Keine Halte verfügbar';
      return;
    }

    const listDiv = document.createElement('div');
    listDiv.className = 'trip-stops-list';

    data.stops.forEach(stop => {
      const arr = formatTime(stop.arrivalLive || stop.arrivalSched);
      const dep = formatTime(stop.departureLive || stop.departureSched);
      const timeDisplay = (arr !== '--:--' && dep !== '--:--' && arr !== dep) ? `${arr} / ${dep}` : (dep !== '--:--' ? dep : arr);
      const track = stop.track ? ` (Gl. ${escapeHtml(stop.track)})` : '';

      const stopRow = document.createElement('div');
      stopRow.className = 'trip-stop-item';
      stopRow.innerHTML = `
        <span>${escapeHtml(stop.name)}${track}</span>
        <span>${timeDisplay}</span>
      `;
      listDiv.appendChild(stopRow);
    });

    container.appendChild(listDiv);
    button.textContent = 'Zuglauf ausblenden';
  } catch (err) {
    console.error(err);
    button.textContent = 'Fehler beim Laden';
  }
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
    const url = `${PROXY}?action=departures&stopId=${encodeURIComponent(state.boardStop.id)}&n=25`;
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

      const mainRow = document.createElement('tr');
      mainRow.className = 'dep-row';
      if (dep.cancelled) mainRow.classList.add('cancelled');

      let delayHtml = '';
      if (dep.delayMin && dep.delayMin !== 0) {
        if (dep.delayMin > 0) {
          delayHtml = `<span class="delay-badge">+${dep.delayMin}'</span>`;
        } else if (dep.delayMin < 0) {
          delayHtml = `<span class="delay-badge" style="color: var(--sob-green);">${dep.delayMin}'</span>`;
        }
      }

      const lineContainer = `<span class="line-container" data-mode="${escapeHtml(dep.mode || 'RAIL')}">${escapeHtml(line)}</span>`;

      mainRow.innerHTML = `
        <td class="col-time"><strong>${timeStr}</strong>${delayHtml}</td>
        <td class="col-line">${lineContainer}</td>
        <td class="col-dest">${escapeHtml(destination)}</td>
        <td class="col-platform">${escapeHtml(track)}</td>
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