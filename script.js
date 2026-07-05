const PROXY = 'proxy.php';
let currentStopId = null;
let refreshTimer = null;
let allDepartures = []; // alle geladenen Abfahrten im Speicher

const params = new URLSearchParams(location.search);
const datePicker = document.getElementById('datePicker');
const timePicker = document.getElementById('timePicker');
const destFilter = document.getElementById('destFilter');

// ─── Modus-Filter (localStorage-persistent) ────────────────────────────────

// Kanonische Gruppen: welche API-modes gehören zu welchem Button
const MODE_GROUPS = {
  TRAIN:  ['TRAIN', 'RAIL', 'HIGHSPEEDRAIL', 'INTERCITYRAIL', 'LONGDISTANCERAIL', 'NIGHTRAIL', 'COACHRAILWAY', 'LOCALTRAIN'],
  SUBWAY: ['SUBWAY', 'METRO', 'URBAN_RAIL'],
  TRAM:   ['TRAM', 'TROLLEYBUS', 'STREETCAR'],
  BUS:    ['BUS', 'COACH', 'REGIONALBUS', 'EXPRESBUS'],
  FERRY:  ['FERRY', 'WATER', 'BOAT'],
  OTHER:  [], // alles was nicht in obigen passt
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

// Geladene Einstellungen aus localStorage, Default: alle aktiv
function loadActiveModesFromStorage() {
  try {
    const stored = localStorage.getItem('tragic_mode_filter');
    if (stored) return new Set(JSON.parse(stored));
  } catch (_) {}
  return new Set(Object.keys(MODE_GROUPS));
}

let activeModes = loadActiveModesFromStorage();

function saveModesToStorage() {
  localStorage.setItem('tragic_mode_filter', JSON.stringify([...activeModes]));
}

// Buttons initialisieren
document.querySelectorAll('.mode-btn').forEach(btn => {
  const mode = btn.dataset.mode;
  if (!activeModes.has(mode)) btn.classList.remove('active');

  btn.addEventListener('click', () => {
    if (activeModes.has(mode)) {
      activeModes.delete(mode);
      btn.classList.remove('active');
    } else {
      activeModes.add(mode);
      btn.classList.add('active');
    }
    saveModesToStorage();
    applyFilters();
  });
});

// ─── Ziel-Filter ────────────────────────────────────────────────────────────

destFilter.addEventListener('input', () => applyFilters());

// ─── Filter anwenden (lokal, kein Netz) ─────────────────────────────────────

function applyFilters() {
  const destQuery = destFilter.value.trim().toLowerCase();

  document.querySelectorAll('#departureBody tr.dep-row').forEach(tr => {
    const mode   = tr.dataset.mode   || 'OTHER';
    const dest   = (tr.dataset.dest  || '').toLowerCase();

    const modeOk = activeModes.has(mode);  // data-mode ist bereits kanonisch
    const destOk = !destQuery || dest.includes(destQuery);

    tr.classList.toggle('hidden-row', !(modeOk && destOk));

    // zugehörige Chain-Row ebenfalls ausblenden wenn Dep-Row hidden
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('chain-row')) {
      next.classList.toggle('hidden-row', !(modeOk && destOk));
    }
  });
}

// ─── Datum / Zeit (URL ↔ Picker) ────────────────────────────────────────────

function getSelectedEpoch() {
  if (!datePicker.value || !timePicker.value) return null;
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
  const pad2 = n => String(n).padStart(2, '0');
  // Lokale Zeit verwenden, nicht UTC
  datePicker.value = `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
  timePicker.value = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function syncPickersToUrl() {
  const refEpoch = getSelectedEpoch();
  const url = new URL(location.href);
  if (refEpoch) url.searchParams.set('time', refEpoch);
  else          url.searchParams.delete('time');
  history.replaceState({}, '', url);
  return refEpoch;
}

const triggerTimeChange = () => {
  if (!currentStopId) return;
  const refEpoch = syncPickersToUrl();
  loadDepartures(refEpoch);
};

datePicker.addEventListener('change', triggerTimeChange);
timePicker.addEventListener('change', triggerTimeChange);

// ─── Stationssuche ──────────────────────────────────────────────────────────

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
      li.innerHTML = `${escapeHtml(st.name)} <span class="suggestion-id">(${escapeHtml(st.id)})</span>`;
      li.onclick = () => selectStation(st.id, st.name);
      list.appendChild(li);
    });
  } catch (err) {
    setStatus('Fehler bei der Stationssuche: ' + err.message);
  }
}, 350));

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-box')) {
    document.getElementById('suggestions').innerHTML = '';
  }
});

// ─── Init aus URL ────────────────────────────────────────────────────────────

// Zeit aus URL lesen und sofort in Picker setzen
const urlTimeRaw = params.get('time');
const urlEpoch   = urlTimeRaw && !isNaN(Number(urlTimeRaw)) ? Number(urlTimeRaw) : null;
if (urlEpoch) setPickersFromEpoch(urlEpoch);

if (params.get('stopId')) {
  currentStopId = params.get('stopId');
  loadDepartures(urlEpoch);
}

// ─── Station auswählen ───────────────────────────────────────────────────────

function selectStation(stopId, name, refEpoch) {
  currentStopId = stopId;
  document.getElementById('stationTitle').textContent = name;
  document.getElementById('suggestions').innerHTML = '';
  document.getElementById('query').value = '';

  setPickersFromEpoch(refEpoch ?? null);

  const url = new URL(location.href);
  url.searchParams.set('stopId', stopId);
  if (refEpoch) url.searchParams.set('time', refEpoch);
  else          url.searchParams.delete('time');
  history.pushState({}, '', url);

  loadDepartures(refEpoch ?? null);
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// ─── Abfahrten laden ─────────────────────────────────────────────────────────

async function loadDepartures(refEpoch) {
  if (!currentStopId) return;
  setStatus('Lade Abfahrten…');

  if (refEpoch === undefined) {
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

    allDepartures = data.departures || [];
    renderDepartures(allDepartures);
    setStatus(refEpoch
      ? 'Abfahrten ab ausgewähltem Zeitpunkt · ' + new Date().toLocaleTimeString('de-CH')
      : 'Aktualisiert: ' + new Date().toLocaleTimeString('de-CH'));
  } catch (err) {
    renderError(err.message);
  }

  clearTimeout(refreshTimer);
  if (!refEpoch) refreshTimer = setTimeout(() => loadDepartures(null), 30000);
}

// ─── Rendern ─────────────────────────────────────────────────────────────────

function renderError(msg) {
  document.getElementById('departureTable').style.display = 'none';
  document.getElementById('status').innerHTML = `<div class="error-hint">Fehler: ${escapeHtml(msg)}</div>`;
}

function getModeIcon(mode) {
  if (!mode) return '';
  const m = mode.toUpperCase();
  if (m === 'TRAM') return 'T';
  if (m === 'BUS')  return 'B';
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

    // SOLL-Zeit anzeigen (scheduled), NICHT live
    const timeStr = dep.scheduled
      ? new Date(dep.scheduled * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit'})
      : '–';

    // Verspätungs-Badge
    let delayHtml = '';
    if (dep.cancelled) {
      delayHtml = '<span class="cancelled">Ausfall</span>';
    } else if (dep.delaySec !== null && dep.delaySec !== undefined && dep.delaySec > 30) {
      delayHtml = `<span class="delay">${fmtDelay(dep.delaySec)}</span>`;
    } else if (dep.delaySec !== null && dep.delaySec !== undefined && dep.delaySec < -30) {
      delayHtml = `<span class="vbz-delay">${fmtDelay(dep.delaySec)}</span>`;
    }

    const iconHtml = getModeIcon(dep.mode);

    // data-Attribute für Filter — kanonischen Mode speichern, nicht Rohwert
    tr.dataset.mode = canonicalMode(dep.mode);
    tr.dataset.dest = dep.destination || '';

    tr.innerHTML = `
      <td class="col-time">${timeStr}<br><span class="delay-badge">${delayHtml}</span></td>
      <td class="col-line">
        <div class="line-container"><span class="line">${iconHtml}${escapeHtml(dep.line)}</span></div>
        <div class="col-nr tripnr">${dep.tripNumber ? escapeHtml(dep.tripNumber) : ''}</div>
      </td>
      <td class="col-dest">${escapeHtml(dep.destination)}</td>
      <td class="col-platform">${escapeHtml(dep.track)}</td>
    `;
    tr.onclick = () => toggleChain(tr, dep);
    tbody.appendChild(tr);
  });

  // Filter nach dem Rendern sofort anwenden
  applyFilters();
}

// ─── Fahrt-Chain ─────────────────────────────────────────────────────────────

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
    // SOLL-Zeiten im Chain: scheduled, mit live-Delay als Badge
    const arrDisp = stop.arrivalSched   ? fmtTime(stop.arrivalSched)   : null;
    const depDisp = stop.departureSched ? fmtTime(stop.departureSched) : null;
    const times = [
      arrDisp ? 'An ' + arrDisp : null,
      depDisp ? 'Ab ' + depDisp : null,
    ].filter(Boolean).join(' · ');

    const delaySec = stop.departureDelaySec ?? stop.arrivalDelaySec;
    const delayHtml = stop.cancelled
      ? '<span class="cancelled">Ausfall</span>'
      : (delaySec && Math.abs(delaySec) > 30 ? `<span class="delay">${fmtDelay(delaySec)}</span>` : '');

    // Referenzzeit für "klick auf Stop" = SOLL-Ankunft (damit die Abfahrtstafel korrekt startet)
    const refEpoch = stop.arrivalSched || stop.arrivalLive;
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
      <b>Linie ${escapeHtml(data.line || '?')}${data.destination ? ' → ' + escapeHtml(data.destination) : ''}</b>${data.tripNumber ? ' · Fahrt: ' + escapeHtml(data.tripNumber) : ''}
    </div>
    <div class="timeline">${stopsHtml}</div>`;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function fmtTime(epoch) {
  if (!epoch) return '–';
  return new Date(epoch * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

function fmtDelay(sec) {
  const sign = sec < 0 ? '-' : '+';
  const abs  = Math.abs(sec);
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

document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 1000);
});