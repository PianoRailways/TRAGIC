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
const routeScroll = document.getElementById('routing-scroll');
const routeRuler = document.getElementById('route-ruler');
const routeHint = document.getElementById('routing-hint');
const boardInput = document.getElementById('board-station-input');
const boardTbody = document.getElementById('board-tbody');
const boardResults = document.getElementById('board-results');
const boardHint = document.getElementById('board-hint');

const selectedStations = new Map();
let viaCount = 0;
let arriveBy = false;
let pageState = { params: null, connections: [], prev: null, next: null, selected: null };

const isWalk = leg => leg.mode === 'WALK';

// ─── Abkürzungs-Mappings ───────────────────────────────────────────────────
let abbrevMap = {};      // { abbrev: [{ name, country }, ...] }
let nameToAbbrevMap = {}; // { normName: [{ abbrev, country }, ...] }

/**
 * Load all DIDOK JSON files from ../didok/ and merge into maps
 * Creates two mappings for bidirectional lookup
 */
async function loadAbbreviations() {
  const countries = ['custom', 'ch', 'de', 'at', 'fr', 'uk', 'zvv', 'libero', 'awelle'];
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

function updateRouteUrl(selected = pageState.selected) {
  const url = new URL(window.location.href);
  const from = selectedStations.get('from');
  const to = selectedStations.get('to');

  ['from', 'fromId', 'to', 'toId', 'via', 'viaId', 'date', 'time', 'mode', 'selected']
    .forEach(key => url.searchParams.delete(key));

  if (from && to) {
    url.searchParams.set('from', from.name);
    if (from.id) url.searchParams.set('fromId', from.id);
    url.searchParams.set('to', to.name);
    if (to.id) url.searchParams.set('toId', to.id);

    document.querySelectorAll('#via-list-container input').forEach(input => {
      const station = selectedStations.get(input.id);
      if (!station) return;
      url.searchParams.append('via', station.name);
      if (station.id) url.searchParams.append('viaId', station.id);
    });

    if (routeDateInput.value) url.searchParams.set('date', routeDateInput.value);
    if (routeTimeInput.value) url.searchParams.set('time', routeTimeInput.value);
    url.searchParams.set('mode', arriveBy ? 'arrive' : 'depart');
    if (Number.isInteger(selected)) url.searchParams.set('selected', selected);
  }

  window.history.replaceState(null, '', url);
}

function restoreRouteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromName = params.get('from');
  const toName = params.get('to');
  if (!fromName || !toName) return null;

  routeFromInput.value = fromName;
  routeToInput.value = toName;
  selectedStations.set('from', { name: fromName, id: params.get('fromId') || null });
  selectedStations.set('to', { name: toName, id: params.get('toId') || null });

  const date = params.get('date');
  const time = params.get('time');
  if (date) routeDateInput.value = date;
  if (time) routeTimeInput.value = time;
  setMode(params.get('mode') === 'arrive');
  updateDateLabel();

  const viaNames = params.getAll('via');
  const viaIds = params.getAll('viaId');
  viaNames.forEach((name, index) => {
    createViaInput({ name, id: viaIds[index] || null });
  });

  const selected = Number.parseInt(params.get('selected'), 10);
  return { selected: Number.isInteger(selected) ? selected : null };
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

function onStationPicked(key) {
  if ((key === 'from' || key === 'to') && selectedStations.has('from') && selectedStations.has('to')) {
    searchRoute();
  }
}

function attachStationSearch(input, suggestions, key) {
  let seq = 0;
  let timer;

  const getItems = () => [...suggestions.querySelectorAll('.suggestion-item')];
  const activeIndex = () => getItems().findIndex(item => item.classList.contains('selected'));

  const closeList = () => {
    suggestions.innerHTML = '';
    suggestions.style.display = 'none';
  };

  const pick = station => {
    clearTimeout(timer);
    seq += 1;
    input.value = station.name;
    selectedStations.set(key, station);
    closeList();
    onStationPicked(key);
  };

  const highlight = index => {
    const items = getItems();
    items.forEach((item, i) => item.classList.toggle('selected', i === index));
    items[index]?.scrollIntoView({ block: 'nearest' });
  };

  const runSearch = async () => {
    const current = ++seq;
    const query = input.value.trim();
    closeList();
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

      // Veraltete Antwort verwerfen
      if (current !== seq) return;

      // Display results (max 8)
      results.slice(0, 8).forEach(station => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item._station = station;
        fillSuggestion(item, station);

        item.addEventListener('click', () => pick(station));
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
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 300);
  });

  // Pfeiltasten, Enter, Escape und Tab
  input.addEventListener('keydown', event => {
    const items = getItems();
    const open = items.length > 0 && suggestions.style.display !== 'none';
    const index = activeIndex();

    if (event.key === 'ArrowDown' && open) {
      event.preventDefault();
      highlight(Math.min(index + 1, items.length - 1));
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      highlight(Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      pick(items[Math.max(index, 0)]._station);
    } else if (event.key === 'Escape' && open) {
      closeList();
    } else if (event.key === 'Tab' && !event.shiftKey) {
      if (open) {
        pick(items[Math.max(index, 0)]._station);
      } else if (input.value.trim() && !selectedStations.has(key)) {
        // Suche lief noch nicht: sofort ausführen und ersten Treffer übernehmen
        clearTimeout(timer);
        runSearch().then(() => {
          const first = getItems()[0];
          if (first) pick(first._station);
        });
      }
    }
  });
}

function createViaInput(station = null) {
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
  const input = group.querySelector('input');
  if (station) {
    input.value = station.name;
    selectedStations.set(key, station);
  }
  attachStationSearch(input, group.querySelector('.suggestions'), key);
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

function formatIcsDate(epoch) {
  const date = new Date(Number(epoch) * 1000);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcs(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldIcsLine(line) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > limit) {
      chunks.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += character;
    bytes += size;
  }
  chunks.push(current);
  return chunks.join('\r\n');
}

function formatCalendarDateRange(start, end) {
  const startDate = new Date(Number(start) * 1000);
  const endDate = new Date(Number(end) * 1000);
  const date = startDate.toLocaleDateString('de-CH', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  return `${date} · ${formatTime(start)} bis ${formatTime(end)}`;
}

function getCalendarDescription(connection, routeUrl) {
  const legs = connection.legs || [];
  const first = legs[0]?.from || {};
  const last = legs[legs.length - 1]?.to || {};
  const start = first.departure || connection.startTime;
  const end = last.arrival || connection.endTime;
  const lines = [
    `${formatTime(start)} ${first.name || ''}${first.track ? ` Gl. ${first.track}` : ''} – ${last.name || ''}`,
    formatCalendarDateRange(start, end),
    '',
    'Reise:',
    `${first.name || ''} nach ${last.name || ''}`,
    `Datum: ${new Date(Number(start) * 1000).toLocaleDateString('de-CH')}`,
    ''
  ];

  let previousTransit = null;
  let walkSinceTransit = false;
  for (const leg of legs) {
    const from = leg.from || {};
    const to = leg.to || {};
    if (isWalk(leg)) {
      const distance = leg.distance ? `: ${Math.round(Number(leg.distance))} m` : '';
      lines.push(`Ab Fussweg${distance} (Fussweg)`);
      walkSinceTransit = true;
      continue;
    }

    if (previousTransit) {
      const gap = (from.departure || 0) - (previousTransit.to?.arrival || 0);
      if (gap > 0) lines.push(`Ab Umsteigen${walkSinceTransit ? ' (Fussweg)' : ''}`);
    }

    const line = getLineLabel(leg);
    const trip = leg.tripNumber && String(leg.tripNumber) !== String(line)
      ? ` ${leg.tripNumber}`
      : '';
    const direction = leg.destination ? `, Richtung: ${leg.destination}` : '';
    lines.push(`Ab ${formatTime(from.departure)}, ${from.name || ''}${from.track ? `, Gl. ${from.track}` : ''} (${line}${trip}${direction})`);
    lines.push(`An ${formatTime(to.arrival)} ${to.name || ''}${to.track ? `, Gl. ${to.track}` : ''}`);
    previousTransit = leg;
    walkSinceTransit = false;
  }

  lines.push('', '–', '', `${formatDuration(connection.duration || (end - start))}`, '',
    'Änderungen vorbehalten. Alle Angaben, Anschlüsse und Einhaltung des Fahrplans ohne Gewähr.', '',
    `${routeUrl}`);
  return lines.join('\n');
}

async function saveConnectionToCalendar(connection, index) {
  pageState.selected = index;
  updateRouteUrl(index);
  const routeUrl = window.location.href;
  const legs = connection.legs || [];
  const first = legs[0]?.from || {};
  const last = legs[legs.length - 1]?.to || {};
  const start = first.departure || connection.startTime;
  const end = last.arrival || connection.endTime;
  const summary = `${formatTime(start)} ${first.name || ''}${first.track ? ` Gl. ${first.track}` : ''} – ${last.name || ''}`;
  const uid = `${Date.now()}-${index}@tragic.routing`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TRAGIC//Routing//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:TRAGIC Routing',
    'X-WR-TIMEZONE:Europe/Zurich',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(Date.now() / 1000)}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    `SUMMARY:${escapeIcs(summary)}`,
    `LOCATION:${escapeIcs(`${first.name || ''} – ${last.name || ''}`)}`,
    `DESCRIPTION:${escapeIcs(getCalendarDescription(connection, routeUrl))}`,
    `URL:${escapeIcs(routeUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].map(foldIcsLine).join('\r\n');
  const fileName = `TRAGIC-${(first.name || 'Start').replace(/[^\w-]+/g, '-')}-${(last.name || 'Ziel').replace(/[^\w-]+/g, '-')}.ics`;
  const file = new File([ics], fileName, { type: 'text/calendar;charset=utf-8' });
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));

  if (isMobile) {
    try {
      const response = await fetch('calendar.php?action=store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ics })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.id) {
        throw new Error(data.error || `Kalender-Export fehlgeschlagen (${response.status})`);
      }
      // GET statt POST: iOS ruft die URL nach dem Öffnen der .ics erneut ab
      window.location.href = `calendar.php?id=${data.id}&filename=${encodeURIComponent(fileName)}`;
      return;
    } catch (error) {
      setHint(routeHint, error.message, true);
    }
  }

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: summary, text: 'Verbindung im Kalender speichern', files: [file] });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }

  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

/**
 * Sollzeit mit Hinweis auf die Abweichung: 18:18 +1 (rot) bzw. 18:18 -1 (blau)
 */
function formatDelay(sched, live) {
  if (!sched || !live) return '';
  const min = Math.round((Number(live) - Number(sched)) / 60);
  if (!min) return '';
  return `<span class="delay-badge ${min > 0 ? 'late' : 'early'}">${min > 0 ? '+' : '-'}${Math.abs(min)}</span>`;
}

function renderTime(sched, live) {
  return `${formatTime(sched || live)}${formatDelay(sched, live)}`;
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

// canonicalMode() kommt aus der Abfahrtstafel; ist es hier noch nicht eingebunden, bleibt der Rohwert
const toCanonicalMode = mode => (typeof canonicalMode === 'function' ? canonicalMode(mode) : mode);

/**
 * Gleiche data-Attribute wie in der Abfahrtstafel (immer gesetzt, auch leer),
 * dazu data-raw-mode und data-trip-number.
 */
function getLineAttributes(leg) {
  const always = [
    ['data-mode', toCanonicalMode(leg.mode)],
    ['data-agency-id', leg.agencyId],
    ['data-agency-name', leg.agencyName],
    ['data-line', getLineLabel(leg)],
    ['data-raw-line', leg.rawLine ?? leg.line],
    ['data-route-id', leg.routeId]
  ].map(([name, value]) => `${name}="${escapeHtml(value ?? '')}"`);

  const optional = [
    ['data-raw-mode', leg.mode],
    ['data-trip-number', leg.tripNumber]
  ]
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`);

  return [...always, ...optional].join(' ');
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
function renderTimelineBar(connection, minDeparture, maxArrival, trackPx, gridStyle) {
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
      const label = getLineLabel(leg);
      html += `<div class="timeline-segment line-container" ${getLineAttributes(leg)}
        style="left:${left}%;width:${width}%;--w:${width.toFixed(2)};--n:${Math.max(label.length, 1)}" title="${escapeHtml(tip)}">${escapeHtml(label)}</div>`;
    }
    return html;
  });

  return `<div class="timeline-bar" style="width:${trackPx}px;${gridStyle}">${parts.join('')}</div>`;
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
      ? `<span class="leg-number"${leg.tripNumberDerived ? ' style="font-style:italic;"' : ''}>${escapeHtml(leg.tripNumber)}</span>`
      : '';
    const stop = (sched, live, name, track) => `
      <div class="leg-stop">
        <span class="leg-time">${renderTime(sched, live)}</span>
        <span class="leg-name">${escapeHtml(name || '')}</span>
        <span class="leg-track">${track ? `Gl. ${escapeHtml(track)}` : ''}</span>
      </div>`;

    const tripAttr = leg.tripId
      ? ` data-trip-id="${escapeHtml(leg.tripId)}" data-from-id="${escapeHtml(from.id || '')}" data-to-id="${escapeHtml(to.id || '')}" data-from-name="${escapeHtml(from.name || '')}" data-to-name="${escapeHtml(to.name || '')}"`
      : '';

    html += `
      <div class="leg-block${leg.tripId ? ' expandable' : ''}"${tripAttr}>
        <div class="leg-header">
          ${renderLineBadge(leg)}${number}
          <span class="leg-dest">${leg.destination ? `→ ${escapeHtml(leg.destination)}` : ''}</span>
          ${leg.tripId ? '<span class="leg-chevron">▾</span>' : ''}
        </div>
        ${stop(from.scheduled, from.departure, from.name, from.track)}
        ${stop(to.scheduled, to.arrival, to.name, to.track)}
        <div class="trip-course" style="display:none"></div>
      </div>`;
    prevTransit = leg;
  });

  return html;
}

/**
 * Zeitachse für die ganze Liste: Die ersten zwei Verbindungen füllen die
 * sichtbare Breite, spätere liegen rechts davon und werden per Scroll erreicht.
 */
function computeTimeScale(spans, minDeparture, maxArrival) {
  const viewWidth = routeScroll.clientWidth || window.innerWidth;
  routeScroll.style.setProperty('--view-w', `${viewWidth}px`);

  const leftWidth = parseFloat(getComputedStyle(routeScroll).getPropertyValue('--left-w')) || 104;
  const available = Math.max(viewWidth - leftWidth - 16, 160);

  const firstTwo = spans.slice(0, 2).filter(span => span.dep && span.arr);
  const focusSec = firstTwo.length
    ? Math.max(...firstTwo.map(span => span.arr)) - Math.min(...firstTwo.map(span => span.dep))
    : maxArrival - minDeparture;
  const totalSec = Math.max(maxArrival - minDeparture, 60);

  // zwischen 2.5 und 12 px pro Minute
  const wanted = available / Math.max(focusSec, 60);
  const pxPerSec = Math.min(Math.max(wanted, 2.5 / 60), 12 / 60);
  const trackPx = Math.max(Math.round(totalSec * pxPerSec), available);

  return { trackPx, pxPerSec: trackPx / totalSec };
}

/**
 * Stundenraster: Beschriftung in der Kopfzeile, feine Linien in den Balken.
 */
function buildTimeGrid(minDeparture, maxArrival, trackPx, pxPerSec) {
  const pxPerMin = pxPerSec * 60;
  const stepSec = (pxPerMin >= 6 ? 15 : pxPerMin >= 3 ? 30 : 60) * 60;
  const tzOffsetSec = -new Date(minDeparture * 1000).getTimezoneOffset() * 60;
  const firstTick = Math.ceil((minDeparture + tzOffsetSec) / stepSec) * stepSec - tzOffsetSec;

  let ticks = '';
  for (let t = firstTick; t <= maxArrival; t += stepSec) {
    ticks += `<span class="ruler-tick" style="left:${((t - minDeparture) * pxPerSec).toFixed(1)}px">${formatTime(t)}</span>`;
  }
  routeRuler.style.width = `${trackPx}px`;
  routeRuler.innerHTML = ticks;

  return `--grid-step:${(stepSec * pxPerSec).toFixed(2)}px;--grid-offset:${((firstTick - minDeparture) * pxPerSec).toFixed(2)}px`;
}

function renderRoutes(connections, selectedIndex = null) {
  routeTbody.innerHTML = '';

  if (connections.length === 0) return;
  routeResults.style.display = 'block';

  // Min/Max über alle Verbindungen für die gemeinsame Zeitachse
  let minDeparture = Infinity;
  let maxArrival = -Infinity;
  const spans = connections.map(conn => {
    const legs = conn.legs || [];
    const dep = legs[0]?.from?.departure || 0;
    const arr = legs[legs.length - 1]?.to?.arrival || 0;
    if (legs.length) {
      minDeparture = Math.min(minDeparture, dep);
      maxArrival = Math.max(maxArrival, arr);
    }
    return { dep, arr };
  });

  const { trackPx, pxPerSec } = computeTimeScale(spans, minDeparture, maxArrival);
  const gridStyle = buildTimeGrid(minDeparture, maxArrival, trackPx, pxPerSec);

  connections.forEach((connection, connIdx) => {
    const legs = connection.legs || [];
    const first = legs[0]?.from || {};
    const last = legs[legs.length - 1]?.to || {};
    const transfers = Number.isInteger(connection.transfers) ? connection.transfers : Math.max(0, legs.length - 1);

    // Summary Row
    const row = document.createElement('tr');
    row.className = 'summary-row';
    if (connIdx === selectedIndex) row.classList.add('open');
    row.innerHTML = `
      <td class="col-summary">
        <div class="sum-dep">${renderTime(first.scheduled, first.departure)}</div>
        <div class="sum-arr">→ ${renderTime(last.scheduled, last.arrival)}</div>
        <div class="sum-meta">${formatDuration(connection.duration || (last.arrival - first.departure))} · ${transfers} Um.</div>
      </td>
      <td class="route-timeline">${renderTimelineBar(connection, minDeparture, maxArrival, trackPx, gridStyle)}</td>
    `;

    row.addEventListener('click', () => {
      const detailRow = document.getElementById(`detail-row-${connIdx}`);
      if (detailRow) {
        const open = detailRow.style.display === 'none';
        detailRow.style.display = open ? 'table-row' : 'none';
        row.classList.toggle('open', open);
        pageState.selected = open ? connIdx : null;
        updateRouteUrl();
      }
    });

    routeTbody.appendChild(row);

    // Detail Row
    const detailRow = document.createElement('tr');
    detailRow.className = 'detail-row';
    detailRow.id = `detail-row-${connIdx}`;
    detailRow.style.display = connIdx === selectedIndex ? 'table-row' : 'none';

    const detailContent = document.createElement('td');
    detailContent.colSpan = 2;
    detailContent.className = 'detail-content';
    detailContent.innerHTML = `
      <div class="detail-inner">
        <div class="detail-actions">
          <button type="button" class="btn-secondary btn-calendar" data-connection-index="${connIdx}">Kalender speichern</button>
        </div>
        <div class="leg-list">${renderLegDetails(legs)}</div>
      </div>`;

    detailRow.appendChild(detailContent);
    routeTbody.appendChild(detailRow);
  });
}

// Bei Drehen/Grössenänderung nur die sichtbare Breite für die Details nachziehen
window.addEventListener('resize', () => {
  if (routeScroll.clientWidth) routeScroll.style.setProperty('--view-w', `${routeScroll.clientWidth}px`);
});

/**
 * Fahrtverlauf einer einzelnen Fahrt: Einstieg und Ausstieg fett,
 * Halte davor und danach abgeblendet.
 */
function renderTripCourse(trip, block) {
  const stops = trip.stops || [];
  const { fromId, toId, fromName, toName } = block.dataset;
  const match = (s, id, name) => (id && s.stopId === id) || s.name === name;

  let a = stops.findIndex(s => match(s, fromId, fromName));
  let b = -1;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (match(stops[i], toId, toName)) { b = i; break; }
  }
  if (a < 0) a = 0;
  if (b < 0) b = stops.length - 1;

  return stops.map((s, i) => {
    const cls = ['course-stop'];
    if (i < a || i > b) cls.push('outside');
    if (i === a || i === b) cls.push('key');
    if (s.cancelled) cls.push('cancelled');

    const sched = s.departureSched || s.arrivalSched;
    const live = s.departureLive || s.arrivalLive;

    return `
      <div class="${cls.join(' ')}">
        <span class="leg-time">${renderTime(sched, live)}</span>
        <span class="leg-name">${escapeHtml(s.name)}</span>
        <span class="leg-track">${s.track ? `Gl. ${escapeHtml(s.track)}` : ''}</span>
      </div>`;
  }).join('');
}

routeTbody.addEventListener('click', async event => {
  const calendarButton = event.target.closest('.btn-calendar');
  if (calendarButton) {
    event.preventDefault();
    event.stopPropagation();
    const index = Number(calendarButton.dataset.connectionIndex);
    try {
      await saveConnectionToCalendar(pageState.connections[index], index);
    } catch (error) {
      if (error.name !== 'AbortError') setHint(routeHint, error.message, true);
    }
    return;
  }
  if (event.target.closest('.trip-course')) return;
  const block = event.target.closest('.leg-block.expandable');
  if (!block) return;

  const course = block.querySelector('.trip-course');
  const open = course.style.display === 'none';
  course.style.display = open ? 'block' : 'none';
  block.classList.toggle('open', open);
  if (!open || block.dataset.loaded) return;

  course.textContent = 'Lade Fahrtverlauf...';
  try {
    const response = await fetch(`${PROXY}?action=trip&tripId=${encodeURIComponent(block.dataset.tripId)}`);
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || `Fahrtverlauf konnte nicht geladen werden (${response.status})`);
    }
    course.innerHTML = renderTripCourse(data, block);
    block.dataset.loaded = '1';
  } catch (error) {
    course.textContent = error.message;
  }
});

async function searchRoute(selected = null) {
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

    for (const input of document.querySelectorAll('#via-list-container input')) {
      const station = selectedStations.get(input.id);
      if (!station) continue;
      const resolved = { ...station, id: await resolveStationId(station) };
      if (!resolved.id) throw new Error(`Via konnte nicht aufgelöst werden: ${station.name}`);
      selectedStations.set(input.id, resolved);
    }
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

  pageState = { params, connections: [], prev: null, next: null, selected };
  updateRouteUrl();
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

    renderRoutes(pageState.connections, pageState.selected);
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
        <td>${renderTime(departure.scheduled, departure.live)}</td>
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
  updateRouteUrl();
}

function adjustRouteDate(days) {
  const d = routeDateInput.value ? new Date(`${routeDateInput.value}T12:00`) : new Date();
  d.setDate(d.getDate() + days);
  routeDateInput.value = toDateValue(d);
  updateDateLabel();
  updateRouteUrl();
}

function getRouteDate() {
  if (!routeDateInput.value) return new Date();
  return new Date(`${routeDateInput.value}T${routeTimeInput.value || '00:00'}`);
}

function setMode(arrive) {
  arriveBy = arrive;
  btnModeDep.classList.toggle('active', !arrive);
  btnModeArr.classList.toggle('active', arrive);
  updateRouteUrl();
}

function swapFromTo() {
  const from = selectedStations.get('from');
  const to = selectedStations.get('to');
  
  if (from && to) {
    selectedStations.set('from', to);
    selectedStations.set('to', from);
    routeFromInput.value = to.name;
    routeToInput.value = from.name;
    updateRouteUrl();
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
routeDateInput.addEventListener('change', () => {
  updateDateLabel();
  updateRouteUrl();
});
routeTimeInput.addEventListener('change', updateRouteUrl);

// Früher / Später
btnEarlier.addEventListener('click', () => loadPage('earlier'));
btnLater.addEventListener('click', () => loadPage('later'));

const restoredRoute = restoreRouteFromUrl();
if (restoredRoute) searchRoute(restoredRoute.selected);
else setRouteNow();
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