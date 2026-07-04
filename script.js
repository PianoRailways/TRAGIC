const PROXY = 'proxy.php';
let currentStopId = null;
let refreshTimer = null;

const params = new URLSearchParams(location.search);
const datePicker = document.getElementById('datePicker');
const timePicker = document.getElementById('timePicker');

if (params.get('stopId')) {
  currentStopId = params.get('stopId');
  const initialTime = params.get('time') ? Number(params.get('time')) : null;
  if (initialTime) {
    setPickersFromEpoch(initialTime);
  }
  loadDepartures(initialTime);
}

document.getElementById('query').addEventListener('input', debounce(async (e) => {
  const q = e.target.value.trim();
  const list = document.getElementById('suggestions');
  list.innerHTML = '';
  if (q.length < 2) return;

  try {
    const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(q)}`);
    const data = await res.json();
    (data.stations || []).forEach(st => {
      if (!st.id) return;
      const li = document.createElement('li');
      li.textContent = st.name;
      li.onclick = () => selectStation(st.id, st.name);
      list.appendChild(li);
    });
  } catch (err) {
    setStatus('Fehler bei der Stationssuche: ' + err.message);
  }
}, 350));

function getSelectedEpoch() {
  if (!datePicker.value || !timePicker.value) return null;
  // Kombiniert Datum und Uhrzeit zu einem lokalen JS-Date-Objekt
  const dt = new Date(`${datePicker.value}T${timePicker.value}`);
  return isNaN(dt.getTime()) ? null : Math.floor(dt.getTime() / 1000);
}

function setPickersFromEpoch(epoch) {
  if (!epoch) {
    datePicker.value = '';
    timePicker.value = '';
    return;
  }
  const date = new Date(epoch * 1000);
  const tzOffset = date.getTimezoneOffset() * 60000;
  const localISO = new Date(date.getTime() - tzOffset).toISOString(); // Format: YYYY-MM-DDTHH:mm:ss.sssZ
  
  datePicker.value = localISO.slice(0, 10);
  timePicker.value = localISO.slice(11, 16);
}

const triggerTimeChange = () => {
  if (!currentStopId) return;
  const refEpoch = getSelectedEpoch();
  
  const url = new URL(location.href);
  if (refEpoch) url.searchParams.set('time', refEpoch); else url.searchParams.delete('time');
  history.pushState({}, '', url);
  
  loadDepartures(refEpoch);
};

datePicker.addEventListener('change', triggerTimeChange);
timePicker.addEventListener('change', triggerTimeChange);

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-box')) {
    document.getElementById('suggestions').innerHTML = '';
  }
});

function selectStation(stopId, name, refEpoch) {
  currentStopId = stopId;
  document.getElementById('stationTitle').textContent = name;
  document.getElementById('suggestions').innerHTML = '';
  document.getElementById('query').value = '';

  setPickersFromEpoch(refEpoch);

  const url = new URL(location.href);
  url.searchParams.set('stopId', stopId);
  if (refEpoch) url.searchParams.set('time', refEpoch); else url.searchParams.delete('time');
  history.pushState({}, '', url);

  loadDepartures(refEpoch);
  window.scrollTo({top: 0, behavior: 'smooth'});
}

async function loadDepartures(refEpoch) {
  if (!currentStopId) return;
  setStatus('Lade Abfahrten…');

  if (!refEpoch) {
    refEpoch = getSelectedEpoch();
  }

  try {
    let q = `${PROXY}?action=departures&stopId=${encodeURIComponent(currentStopId)}&n=25`;
    if (refEpoch) {
      q += `&time=${encodeURIComponent(new Date(refEpoch * 1000).toISOString())}`;
    }
    const res = await fetch(q);
    const data = await res.json();

    if (data.error) {
      renderError(data.error);
      setStatus('');
      return;
    }

    renderDepartures(data.departures || []);
    setStatus(refEpoch
      ? 'Abfahrten ab ausgewähltem Zeitpunkt · ' + new Date().toLocaleTimeString('de-CH')
      : 'Aktualisiert: ' + new Date().toLocaleTimeString('de-CH'));
  } catch (err) {
    renderError(err.message);
  }

  clearTimeout(refreshTimer);
  if (!refEpoch) refreshTimer = setTimeout(() => loadDepartures(), 30000);
}

function renderError(msg) {
  document.getElementById('departureTable').style.display = 'none';
  const status = document.getElementById('status');
  status.innerHTML = `<div class="error-hint">Fehler: ${escapeHtml(msg)}</div>`;
}

function getModeIcon(mode) {
  if (!mode) return '';
  const m = mode.toUpperCase();
  
  if (m === 'RAIL' || m === 'SUBWAY') { return `<span class="mode-icon">🚇</span>`; }
  if (m === 'TRAM' || m === 'METRO') { return `<span class="mode-icon">🚋</span>`; }
  if (m === 'REGIONAL_RAIL') { return `<span class="mode-icon">🚉</span>`; }
  if (m === 'BUS') { return `<span class="mode-icon">🚎</span>`; }
  if (m === 'LONG_DISTANCE' || m === 'HIGHSPEED_RAIL') { return `<span class="mode-icon">🚄</span>`; }
  if (m === 'FERRY') { return `<span class="mode-icon">🚢</span>`; }
  return '';
}

function renderDepartures(departures) {
  const tbody = document.getElementById('departureBody');
  tbody.innerHTML = '';
  document.getElementById('departureTable').style.display = departures.length ? 'table' : 'none';

  if (!departures.length) {
    document.getElementById('status').innerHTML = '<div class="empty-hint">Keine Abfahrten gefunden.</div>';
    return;
  }

  departures.forEach(dep => {
    const tr = document.createElement('tr');
    tr.className = 'dep-row';

    const timeStr = dep.live ? new Date(dep.live * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit'}) : '–';

    let delayCell = '<span class="ontime"></span>';
    if (dep.cancelled) {
      delayCell = '<span class="cancelled">Ausfall</span>';
    } else if (dep.delayMin !== null && dep.delayMin > 0) {
      delayCell = `<span class="delay">+${dep.delayMin}′</span>`;
    } else if (dep.delayMin !== null && dep.delayMin < 0) {
      delayCell = `<span class="vbz-delay">${dep.delayMin}′</span>`;
    }

    const iconHtml = getModeIcon(dep.mode);

    tr.innerHTML = `
      <td class="col-time">${timeStr}</td>
      <td class="col-delay">${delayCell}</td>
      <td class="col-line"><div class="line-container">${iconHtml}<span class="line">${escapeHtml(dep.line)}</span></div></td>
      <td class="col-nr tripnr">${dep.tripNumber ? escapeHtml(dep.tripNumber) : '–'}</td>
      <td class="col-dest">${escapeHtml(dep.destination)}</td>
    `;
    tr.onclick = () => toggleChain(tr, dep);
    tbody.appendChild(tr);
  });
}

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
  const stopsHtml = (data.stops || []).map(stop => {
    const arr = fmtTime(stop.arrivalLive);
    const dep = fmtTime(stop.departureLive);
    const times = [arr !== '–' ? 'an ' + arr : null, dep !== '–' ? 'ab ' + dep : null].filter(Boolean).join(' · ');

    const delaySec = stop.departureDelaySec ?? stop.arrivalDelaySec;
    const delayHtml = stop.cancelled
      ? '<span class="cancelled">Ausfall</span>'
      : (delaySec ? `<span class="delay">${fmtDelay(delaySec)}</span>` : '<span class="ontime"></span>');

    const refEpoch = stop.arrivalLive || stop.arrivalSched;
    const isLink = !!stop.stopId;
    const nameAttrs = isLink
      ? `onclick="selectStation('${escapeAttr(stop.stopId)}','${escapeAttr(stop.name)}',${refEpoch || 'null'})"`
      : '';

    return `
      <div class="stop${stop.cancelled ? ' cancelled-stop' : ''}">
        <div class="stop-dot"></div>
        <div>
          <div class="stop-name${isLink ? '' : ' no-link'}" ${nameAttrs}>${escapeHtml(stop.name)}</div>
          <div class="stop-times">${escapeHtml(times || '–')}</div>
        </div>
        <div class="stop-right">
          ${delayHtml}
          ${stop.track ? `<div class="stop-track">Gl. ${escapeHtml(stop.track)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="chain-header">
      <b>Linie ${escapeHtml(data.line || '?')} ${data.destination ? ' Richtung → ' + escapeHtml(data.destination) : ''}</b>${data.tripNumber ? ' · Fahrtnummer: ' + escapeHtml(data.tripNumber) : ''}
      
    </div>
    <div class="timeline">${stopsHtml}</div>`;
}

function fmtTime(epoch) {
  if (!epoch) return '–';
  return new Date(epoch * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

function fmtDelay(sec) {
  const sign = sec < 0 ? '-' : '+';
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${String(s).padStart(2,'0')}`;
}

function setStatus(msg) { document.getElementById('status').textContent = msg; }

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

  // ─── Uhr ──────────────────────────────────────────────────────────────────────

function updateClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const now = new Date();
    el.textContent =
        String(now.getHours()).padStart(2,'0') + ':' +
        String(now.getMinutes()).padStart(2,'0') + ':' +
        String(now.getSeconds()).padStart(2,'0');
}

document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
});