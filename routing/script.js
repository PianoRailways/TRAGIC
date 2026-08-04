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
    clock.textContent = now.toTimeString().split(' ')[0];
  };
  updateTime();
  setInterval(updateTime, 1000);
}

function setupEventListeners() {
  document.getElementById('btn-search-route').addEventListener('click', handleRouteSearch);
  document.getElementById('btn-load-board').addEventListener('click', handleBoardLoad);
  document.getElementById('btn-refresh').addEventListener('click', () => {
    document.getElementById('route-from-input').value = '';
    document.getElementById('route-to-input').value = '';
    document.getElementById('route-time').value = '';
    document.getElementById('board-station-input').value = '';
    state.fromStop = state.toStop = state.boardStop = null;
  });
  document.getElementById('btn-home').addEventListener('click', () => {
    window.location.href = '/';
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
      const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(query)}`);
      const data = await res.json();
      currentItems = data.stations || data.results || [];

      container.innerHTML = '';
      activeIndex = -1;

      if (!Array.isArray(currentItems) || currentItems.length === 0) {
        container.style.display = 'none';
        return;
      }

      currentItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.textContent = item.name;
        div.addEventListener('click', () => selectItem(index));
        container.appendChild(div);
      });

      container.style.display = 'block';
    } catch (err) {
      console.error(err);
    }
  }, 200);

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
    let url = `${PROXY}?action=plan&fromPlace=${encodeURIComponent(state.fromStop.id)}&toPlace=${encodeURIComponent(state.toStop.id)}`;
    if (formattedTime) url += `&time=${encodeURIComponent(formattedTime)}`;

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
      const durationFormatted = formatDurationHHMM(conn.duration);
      const transfers = conn.transfers || 0;

      const mainRow = document.createElement('tr');
      mainRow.className = 'summary-row';
      mainRow.innerHTML = `
        <td class="col-time">${startTime}</td>
        <td class="col-time">${endTime}</td>
        <td class="col-dur">${durationFormatted}</td>
        <td class="col-bar">${renderTimelineBar(conn.legs, conn.duration)}</td>
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

function renderTimelineBar(legs, totalDurationSec) {
  if (!legs || legs.length === 0 || !totalDurationSec) return '';

  let html = '<div class="timeline-bar">';
  legs.forEach((leg, idx) => {
    const legDuration = (leg.to.arrival && leg.from.departure)
      ? (leg.to.arrival - leg.from.departure)
      : 0;
    
    let pct = (legDuration / totalDurationSec) * 100;
    if (pct < 3) pct = 3;

    const mode = escapeHtml(leg.mode || 'RAIL');
    const agencyId = escapeHtml(leg.agencyId || '');
    const line = escapeHtml(leg.line || leg.routeShortName || '');
    const routeId = escapeHtml(leg.routeId || '');

    html += `<div class="timeline-segment" data-mode="${mode}" data-agency-id="${agencyId}" data-line="${line}" data-route-id="${routeId}" style="width: ${pct}%;"></div>`;

    if (idx < legs.length - 1) {
      html += `<div class="timeline-dot"></div>`;
    }
  });
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

    const mode = escapeHtml(leg.mode || 'RAIL');
    const agencyId = escapeHtml(leg.agencyId || '');
    const line = escapeHtml(leg.line || leg.routeShortName || '');
    const routeId = escapeHtml(leg.routeId || '');

    if (leg.mode === 'WALK') {
      const walkDuration = (leg.from.departure && leg.to.arrival)
        ? Math.round((leg.to.arrival - leg.from.departure) / 60)
        : '';
      legDiv.innerHTML = `
        <div class="leg-header">
          <div class="line-container" data-mode="WALK" data-agency-id="" data-line="WALK" data-route-id="">
            <span class="line-badge line" data-mode="WALK">Fußweg</span>
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
          <div class="line-container" data-mode="${mode}" data-agency-id="${agencyId}" data-line="${line}" data-route-id="${routeId}">
            <span class="line-badge line" data-mode="${mode}">${line}</span>
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

      // Prüfen, ob diese Haltestelle der Einstieg oder Ausstieg deiner Teilstrecke ist
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
    button.textContent = 'Schließen';
  } catch (err) {
    button.textContent = 'Fehler';
  }
}

function isSameStop(stopA, stopB) {
  if (stopA.stopId && stopB.id && stopA.stopId === stopB.id) return true;
  if (!stopA.name || !stopB.name) return false;
  
  // Normalisierung von Bahnhofsnamen (z.B. "Zürich HB" vs "Zürich HB, Bahnhof")
  const cleanA = stopA.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanB = stopB.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  return cleanA.includes(cleanB) || cleanB.includes(cleanA);
}

function isSameStop(stopA, stopB) {
  if (stopA.stopId && stopB.id && stopA.stopId === stopB.id) return true;
  if (stopA.name && stopB.name && stopA.name.trim().toLowerCase() === stopB.name.trim().toLowerCase()) return true;
  return false;
}

// Auch in der Abfahrtstafel die data-Attribute beim Badge mitgeben
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

      const mode = escapeHtml(dep.mode || 'RAIL');
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
          <div class="line-container" data-mode="${mode}" data-agency-id="${agencyId}" data-line="${escapeHtml(line)}" data-route-id="${routeId}">
            <span class="line-badge line" data-mode="${mode}">${escapeHtml(line)}</span>
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