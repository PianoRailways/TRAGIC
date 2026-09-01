const PROXY = 'proxy.php';
let currentStopId = null;
let currentStationName = null;
let currentMainStationId = null;
let refreshTimer = null;
let allDepartures = [];
let abbrevMap = {};
let nameToAbbrevMap = {};

const DEFAULT_FAVORITES = [
  { stopId: 'ch-opentransportdataswiss26_Parentch:1:sloid:8100', label: 'LTH', name: 'LTH' },
  { stopId: 'ch-opentransportdataswiss26_Parentch:1:sloid:5000', label: 'LZ', name: 'LZ' },
  { stopId: 'de-DELFI_ch:23005:6', label: 'BAD', name: 'BAD' },
  { stopId: 'fr-agregat-des-reseaux-urbains-et-interurbains-en-region-grand-est_SNCF:OCETrainTER87182063', label: 'MUL', name: 'MUL' },
  { stopId: 'ch-opentransportdataswiss26_Parent8721202', label: 'STRS', name: 'STRS' },
  { stopId: 'ch-opentransportdataswiss26_Parentch:1:sloid:10', label: 'BS', name: 'BS' }
];
const FAVORITES_STORAGE_KEY = 'tragic_favorites';
const VIA_LOADING_STORAGE_KEY = 'tragic_via_loading_enabled';

const params = new URLSearchParams(location.search);
let isArrivalsMode = params.get('arrivals') === 'true';

// ─── Hilfsfunktion zur Formatierung von Station & Gleis ───────────────────

function formatStationWithTrack(stationName, track) {
  if (!stationName) return '';

  const cleanTrack = track ? String(track).replace(/^(Gl\.|Gleis|Pl\.|Plattform)\s*/i, '').trim() : '';

  const abbrevs = getAbbrevsForName(stationName);
  const hasAbbrev = abbrevs && abbrevs.length > 0;
  const baseName = hasAbbrev ? abbrevs[0].abbrev : stationName.trim();

  if (!cleanTrack) {
    return baseName;
  }

  return hasAbbrev ? `${baseName}-${cleanTrack}` : `${baseName} ${cleanTrack}`;
}

function cloneDefaultFavorites() {
  return DEFAULT_FAVORITES.map(favorite => ({ ...favorite }));
}

function normalizeFavoriteName(favorite) {
  return String(favorite?.name || favorite?.stationName || favorite?.label || '').trim();
}

function getFavoriteLabelForName(stationName) {
  const normalizedName = String(stationName || '').trim();
  if (!normalizedName) return '';

  const abbrevs = getAbbrevsForName(normalizedName);
  if (abbrevs.length > 0 && abbrevs[0].abbrev) {
    return abbrevs[0].abbrev;
  }

  return normalizedName;
}

function loadFavoritesFromStorage() {
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!stored) {
      return cloneDefaultFavorites();
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return cloneDefaultFavorites();
    }

    const seenStopIds = new Set();
    return parsed
      .map(entry => {
        const rawStopId = String(entry?.stopId || '').trim();
        let stopId = rawStopId;
        try {
          stopId = decodeURIComponent(rawStopId);
        } catch (_) {}
        const name = normalizeFavoriteName(entry);
        const label = String(entry?.label || '').trim();

        return {
          stopId,
          name,
          label: label || ''
        };
      })
      .filter(entry => {
        if (!entry.stopId || !entry.name || seenStopIds.has(entry.stopId)) {
          return false;
        }
        seenStopIds.add(entry.stopId);
        return true;
      });
  } catch (_) {
    return cloneDefaultFavorites();
  }
}

let favoriteStations = loadFavoritesFromStorage();

function saveFavoritesToStorage() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteStations));
  } catch (_) {}
}

function getFavoriteLabel(favorite) {
  return favorite.label || getFavoriteLabelForName(favorite.name);
}

function isFavoriteStation(stopId) {
  return favoriteStations.some(favorite => favorite.stopId === stopId);
}

function renderFavoritesBar() {
  const bar = document.getElementById('fav-bar');
  if (!bar) return;

  bar.innerHTML = '';

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'fav-scroll-container';

  const favoritesList = document.createElement('div');
  favoritesList.className = 'fav-list';

  favoriteStations.forEach(favorite => {
    const item = document.createElement('span');
    item.className = 'fav-item';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fav-btn';
    btn.textContent = getFavoriteLabel(favorite);
    btn.title = favorite.name;
    if (currentStopId && favorite.stopId === currentStopId) {
      btn.classList.add('is-current');
    }
    btn.addEventListener('click', () => {
      window.location = `./?stopId=${encodeURIComponent(favorite.stopId)}`;
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'fav-remove-btn';
    removeBtn.title = `Favorit ${getFavoriteLabel(favorite)} entfernen`;
    removeBtn.setAttribute('aria-label', `Favorit ${getFavoriteLabel(favorite)} entfernen`);
    removeBtn.textContent = '×';
    removeBtn.dataset.stopId = favorite.stopId;
    removeBtn.dataset.confirmPending = 'false';

    removeBtn.addEventListener('click', event => {
      event.stopPropagation();
      
      const isConfirmPending = removeBtn.dataset.confirmPending === 'true';
      
      if (!isConfirmPending) {
        // Erster Klick: In Bestätigungs-State wechseln
        removeBtn.dataset.confirmPending = 'true';
        removeBtn.textContent = '✓ Löschen?';
        removeBtn.classList.add('fav-remove-btn-confirm');
        
        // Nach 3 Sekunden zurücksetzen wenn nicht bestätigt
        setTimeout(() => {
          if (removeBtn.dataset.confirmPending === 'true') {
            removeBtn.dataset.confirmPending = 'false';
            removeBtn.textContent = '×';
            removeBtn.classList.remove('fav-remove-btn-confirm');
          }
        }, 3000);
      } else {
        // Zweiter Klick: Wirklich löschen
        favoriteStations = favoriteStations.filter(entry => entry.stopId !== favorite.stopId);
        saveFavoritesToStorage();
        renderFavoritesBar();
      }
    });

    item.appendChild(btn);
    item.appendChild(removeBtn);
    favoritesList.appendChild(item);
  });

  scrollContainer.appendChild(favoritesList);
  bar.appendChild(scrollContainer);

  const controls = document.createElement('div');
  controls.className = 'fav-controls';

  const starBtn = document.createElement('button');
  starBtn.type = 'button';
  starBtn.className = 'fav-star-btn';
  const canFavorite = !!currentStopId && !!currentStationName && currentStationName !== 'Station wählen';
  const activeFavorite = canFavorite && isFavoriteStation(currentStopId);
  starBtn.textContent = activeFavorite ? '★' : '☆';
  starBtn.title = canFavorite
    ? (activeFavorite ? 'Aktuelle Station aus Favoriten entfernen' : 'Aktuelle Station zu Favoriten hinzufügen')
    : 'Station auswählen, um Favorit zu speichern';
  starBtn.disabled = !canFavorite;
  if (activeFavorite) {
    starBtn.classList.add('is-active');
  }
  starBtn.addEventListener('click', () => {
    if (!canFavorite) return;

    if (activeFavorite) {
      favoriteStations = favoriteStations.filter(entry => entry.stopId !== currentStopId);
    } else {
      if (isFavoriteStation(currentStopId)) {
        renderFavoritesBar();
        return;
      }

      favoriteStations = [...favoriteStations, {
        stopId: currentStopId,
        name: currentStationName,
        label: getFavoriteLabelForName(currentStationName)
      }];
    }

    saveFavoritesToStorage();
    renderFavoritesBar();
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'fav-reset-btn';
  resetBtn.title = 'Favoriten auf die eingebauten Standards zurücksetzen';
  resetBtn.textContent = 'Standard';
  resetBtn.dataset.confirmPending = 'false';
  resetBtn.addEventListener('click', () => {
    const isConfirmPending = resetBtn.dataset.confirmPending === 'true';

    if (!isConfirmPending) {
      resetBtn.dataset.confirmPending = 'true';
      resetBtn.textContent = '✓ Löschen?';
      resetBtn.classList.add('fav-remove-btn-confirm');

      setTimeout(() => {
        if (resetBtn.dataset.confirmPending === 'true') {
          resetBtn.dataset.confirmPending = 'false';
          resetBtn.textContent = 'Standard';
          resetBtn.classList.remove('fav-remove-btn-confirm');
        }
      }, 3000);
      return;
    }

    favoriteStations = cloneDefaultFavorites();
    localStorage.removeItem(FAVORITES_STORAGE_KEY);
    renderFavoritesBar();
  });

  controls.appendChild(starBtn);
  controls.appendChild(resetBtn);
  bar.appendChild(controls);
}

// ─── Calendar Journey Tracking ────────────────────────────────────────────
let calendarStart = null;
let calendarVias = [];
let calendarDest = null;
let calendarTrips = [];
let currentChainData = null;

function loadCalendarStateFromUrl() {
  const cstartRaw = params.get('cstart');
  const cviasRaw = params.get('cvias');
  const cdestRaw = params.get('cdest');

  if (cstartRaw) {
    try {
      const parts = cstartRaw.split('|');
      calendarStart = {
        stopId: parts[0],
        name: decodeURIComponent(parts[1]),
        epoch: parseInt(parts[2]),
        track: parts[3] ? decodeURIComponent(parts[3]) : ''
      };
    } catch (_) {}
  }

  if (cviasRaw) {
    try {
      const viaParts = cviasRaw.split(';;');
      calendarVias = viaParts
        .map(v => {
          const parts = v.split('|');
          return {
            stopId: parts[0],
            name: decodeURIComponent(parts[1]),
            epoch: parseInt(parts[2]),
            track: parts[3] ? decodeURIComponent(parts[3]) : ''
          };
        })
        .filter(v => v.stopId && v.name);
    } catch (_) {}
  }

  if (cdestRaw) {
    try {
      const parts = cdestRaw.split('|');
      calendarDest = {
        stopId: parts[0],
        name: decodeURIComponent(parts[1]),
        epoch: parseInt(parts[2]),
        track: parts[3] ? decodeURIComponent(parts[3]) : ''
      };
    } catch (_) {}
  }
}

loadCalendarStateFromUrl();

function saveCalendarStateToUrl() {
  const url = new URL(location.href);

  if (calendarStart) {
    url.searchParams.set('cstart', `${calendarStart.stopId}|${encodeURIComponent(calendarStart.name)}|${calendarStart.epoch}|${encodeURIComponent(calendarStart.track || '')}`);
  } else {
    url.searchParams.delete('cstart');
  }

  if (calendarVias.length > 0) {
    const viasStr = calendarVias
      .map(v => `${v.stopId}|${encodeURIComponent(v.name)}|${v.epoch}|${encodeURIComponent(v.track || '')}`)
      .join(';;');
    url.searchParams.set('cvias', viasStr);
  } else {
    url.searchParams.delete('cvias');
  }

  if (calendarDest) {
    url.searchParams.set('cdest', `${calendarDest.stopId}|${encodeURIComponent(calendarDest.name)}|${calendarDest.epoch}|${encodeURIComponent(calendarDest.track || '')}`);
  } else {
    url.searchParams.delete('cdest');
  }

  history.replaceState(
    { ...history.state, calendarStart, calendarVias, calendarDest, calendarTrips },
    '',
    url
  );
}

function setCalendarStart(stopId, name, epoch, track) {
  calendarStart = { stopId, name, epoch, track: track || '' };
  calendarVias = [];
  calendarDest = null;
  calendarTrips = [];
  saveCalendarStateToUrl();
  updateCalendarExportButton();
}

function selectCalendarRole(event, role, stopId, name, epoch, track, stopIndex) {
  event.stopPropagation();

  if (role === 'start') {
    setCalendarStart(stopId, name, epoch, track);
    alert('Start gesetzt: ' + formatStationWithTrack(name, track));
  } else if (role === 'via') {
    addCalendarVia(stopId, name, epoch, track, stopIndex);
    selectStation(stopId, name, epoch || null);
  } else {
    setCalendarDest(stopId, name, epoch, track, stopIndex);
  }

  const menu = event.currentTarget.closest('details');
  if (menu) menu.open = false;
}

function recordSubtrip(endStopId, endName, endEpoch, endTrack, stopIndex) {
  const lastPoint = calendarVias.length > 0 
    ? calendarVias[calendarVias.length - 1] 
    : calendarStart;

  if (!lastPoint) return;

  let startName = lastPoint.name;
  let startTrack = lastPoint.track || '';
  let startTimeEpoch = lastPoint.epoch;
  let matchedStartIdx = -1;
  let tripVias = [];

  if (currentChainData && currentChainData.stops) {
    const stops = currentChainData.stops;

    if (lastPoint.stopId) {
      matchedStartIdx = stops.findIndex(s => s.stopId === lastPoint.stopId);
    }
    if (matchedStartIdx < 0 && lastPoint.name) {
      matchedStartIdx = stops.findIndex(s => s.name.toLowerCase() === lastPoint.name.toLowerCase());
    }

    if (matchedStartIdx >= 0 && typeof stopIndex === 'number' && matchedStartIdx < stopIndex) {
      const startObj = stops[matchedStartIdx];
      startName = startObj.name;
      startTrack = startObj.track || startTrack;
      startTimeEpoch = startObj.departureSched || startObj.departureLive || startObj.arrivalSched || startTimeEpoch;

      const seenViaNames = new Set();
      for (let idx = matchedStartIdx + 1; idx < stopIndex; idx++) {
        const viaName = String(stops[idx]?.name || '').trim();
        const viaKey = viaName.toLowerCase();
        if (!viaName || seenViaNames.has(viaKey)) continue;
        seenViaNames.add(viaKey);
        tripVias.push(viaName);
      }
    }
  }

  const rawTripNum = currentChainData ? (currentChainData.tripNumber || currentChainData.line || '') : '';
  const cleanTripNum = String(rawTripNum).replace(/^0+(?=\d)/, '');

  calendarTrips.push({
    startStation: startName,
    startTrack: startTrack || '',
    startTimeEpoch: startTimeEpoch,
    endStation: endName,
    endTrack: endTrack || '',
    endTimeEpoch: endEpoch,
    tripNumber: cleanTripNum,
    vias: tripVias
  });
}

function addCalendarVia(stopId, name, epoch, track, stopIndex) {
  recordSubtrip(stopId, name, epoch, track, stopIndex);
  calendarVias.push({ stopId, name, epoch, track: track || '' });
  saveCalendarStateToUrl();
  updateCalendarExportButton();
}

function setCalendarDest(stopId, name, epoch, track, stopIndex) {
  recordSubtrip(stopId, name, epoch, track, stopIndex);
  calendarDest = { stopId, name, epoch, track: track || '' };
  saveCalendarStateToUrl();
  updateCalendarExportButton();
  exportCalendarJourney();
}

function clearCalendarJourney() {
  calendarStart = null;
  calendarVias = [];
  calendarDest = null;
  calendarTrips = [];
  saveCalendarStateToUrl();
  updateCalendarExportButton();
}

function updateCalendarExportButton() {
  const exportBtn = document.getElementById('btn-export-calendar');
  if (!exportBtn) return;

  const isValid = calendarStart && calendarDest;
  exportBtn.style.display = isValid ? 'block' : 'none';
}

function generateICS(startStop, viaStops, destStop, trips) {
  if (!startStop || !destStop) return null;

  const startEpoch = startStop.epoch;
  const destEpoch = destStop.epoch;

  if (!startEpoch || !destEpoch) return null;

  const startDate = new Date(startEpoch * 1000);
  const endDate = new Date(destEpoch * 1000);

  const formatDateTimeUTC = (date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const mins = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${mins}${secs}Z`;
  };

  const formatTimeHHMM = (epoch) => {
    if (!epoch) return '--:--';
    const d = new Date(epoch * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const dtStart = formatDateTimeUTC(startDate);
  const dtEnd = formatDateTimeUTC(endDate);

  let descriptionLines = [];

  if (trips && trips.length > 0) {
    descriptionLines = trips.map(trip => {
      const sTime = formatTimeHHMM(trip.startTimeEpoch);
      const eTime = formatTimeHHMM(trip.endTimeEpoch);
      const startFormatted = formatStationWithTrack(trip.startStation, trip.startTrack);
      const endFormatted = formatStationWithTrack(trip.endStation, trip.endTrack);
      const tripNum = trip.tripNumber ? ` (${trip.tripNumber})` : '';
      const viaText = Array.isArray(trip.vias) && trip.vias.length > 0
        ? ` via ${trip.vias.join(' · ')}`
        : '';

      return `${sTime} ${startFormatted} - ${eTime} ${endFormatted}${tripNum}${viaText}`;
    });
  } else {
    const sTime = formatTimeHHMM(startEpoch);
    const eTime = formatTimeHHMM(destEpoch);
    const startFormatted = formatStationWithTrack(startStop.name, startStop.track);
    const endFormatted = formatStationWithTrack(destStop.name, destStop.track);
    descriptionLines.push(`${sTime} ${startFormatted} - ${eTime} ${endFormatted}`);
  }

  const description = descriptionLines.join('\n');

  const firstTrip = (trips && trips.length > 0) ? trips[0] : null;
  const locStation = firstTrip ? firstTrip.startStation : startStop.name;
  const locTrack = firstTrip ? firstTrip.startTrack : (startStop.track || '');
  const eventLocation = formatStationWithTrack(locStation, locTrack);

  const escapeICS = (str) => {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')
      .replace(/\n/g, '\\n');
  };

  const eventTitle = `Fahrt: ${startStop.name} → ${destStop.name}`;
  const uid = `calendar-${startEpoch}-${destEpoch}-${Date.now()}@stellwerksim.ch`;

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//NOWE-OMNI//Calendar Export//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:NOWE-OMNI Fahrten
X-WR-TIMEZONE:Europe/Zurich
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${formatDateTimeUTC(new Date())}
DTSTART:${dtStart}
DTEND:${dtEnd}
SUMMARY:${escapeICS(eventTitle)}
DESCRIPTION:${escapeICS(description)}
LOCATION:${escapeICS(eventLocation)}
SEQUENCE:0
STATUS:CONFIRMED
TRANSP:TRANSPARENT
END:VEVENT
END:VCALENDAR`;
}

function downloadICS(icsContent) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `fahrt-${new Date().getTime()}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function exportCalendarJourney() {
  if (!calendarStart || !calendarDest) {
    alert('Start und Ziel müssen gesetzt sein.');
    return;
  }

  const icsContent = generateICS(calendarStart, calendarVias, calendarDest, calendarTrips);
  if (!icsContent) {
    alert('Fehler beim Generieren der ICS-Datei.');
    return;
  }

  downloadICS(icsContent);
  clearCalendarJourney();
}

// ─── Ende Calendar Tracking ──────────────────────────────────────────────────

const datePicker = document.getElementById('datePicker');
const timePicker = document.getElementById('timePicker');
const destFilter = document.getElementById('destFilter');

// ─── Combined Stations laden (mehrere Quellen) ──────────────────────────────

async function loadCombinedStations() {
  const urls = [
    'https://nowe.stellwerksim.ch/combinedstations.js',
    'https://tragic.stellwerksim.ch/combinedTRAGIC.js',
  ];
  
  const tempMerged = {};
  let loadedCount = 0;
  
  for (const url of urls) {
    try {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
          console.log(`combinedStations loaded from ${url}`);
          
          if (window.combinedStations && typeof window.combinedStations === 'object') {
            Object.assign(tempMerged, window.combinedStations);
            loadedCount++;
          }
          
          resolve();
        };
        script.onerror = () => {
          console.warn(`Failed to load combinedStations from ${url}`);
          resolve();
        };
        document.head.appendChild(script);
      });
    } catch (err) {
      console.error(`Error loading combinedStations from ${url}:`, err);
    }
  }
  
  window.combinedStations = tempMerged;
  window.combinedStationsReady = loadedCount > 0;
  
  console.log(`Loaded combinedStations from ${loadedCount}/${urls.length} sources, total entries: ${Object.keys(window.combinedStations).length}`);
}

function getRelatedStations(stationName) {
  if (!window.combinedStations || !window.combinedStations[stationName]) {
    return [stationName];
  }
  return window.combinedStations[stationName];
}

async function resolveStationNameToId(stationName) {
  try {
    const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(stationName)}`);
    const data = await res.json();
    const stations = data.stations || [];
    
    const match = stations.find(s => s.name.toLowerCase() === stationName.toLowerCase()) || stations[0];
    return match ? match.id : null;
  } catch (err) {
    console.error(`Error resolving station "${stationName}":`, err);
    return null;
  }
}

async function fetchCombinedDepartures(stopId, stationName, refEpoch, numResults = 25) {
  const relatedStationNames = getRelatedStations(stationName);
  
  console.log(`Fetching data for ${relatedStationNames.length} station(s):`, relatedStationNames);
  
  const allDeps = [];
  
  for (const station of relatedStationNames) {
    try {
      const stationStopId = await resolveStationNameToId(station);
      
      if (!stationStopId) {
        console.warn(`Could not resolve stopId for station: ${station}`);
        continue;
      }
      
      let q = `${PROXY}?action=departures&stopId=${encodeURIComponent(stationStopId)}&n=${numResults}`;
      if (isArrivalsMode) q += '&arrivals=true';
      if (refEpoch) {
        q += `&time=${encodeURIComponent(new Date(refEpoch * 1000).toISOString())}`;
      }
      
      const res = await fetch(q);
      const data = await res.json();
      
      if (data.error) {
        console.warn(`Failed to fetch data for ${station}:`, data.error);
        continue;
      }
      
      if (data.departures && Array.isArray(data.departures)) {
        const departuresWithStation = data.departures.map(dep => ({
          ...dep,
          _fromStation: station,
          _isMainStation: station === stationName
        }));
        allDeps.push(...departuresWithStation);
      }
    } catch (err) {
      console.error(`Error fetching data for ${station}:`, err);
    }
  }
  
  allDeps.sort((a, b) => {
    const timeA = a.scheduled || Infinity;
    const timeB = b.scheduled || Infinity;
    return timeA - timeB;
  });
  
  return allDeps.slice(0, numResults);
}

// ─── Abkürzungs-Mappings laden ──────────────────────────────────────────────

async function loadAbbreviations() {
  const countries = ['custom', 'ch', 'de', 'at', 'fr', 'uk'];
  try {
    for (const country of countries) {
      try {
        const res = await fetch(`/didok/${country}.json`);
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
        console.warn(`Konnte /didok/${country}.json nicht laden:`, e);
      }
    }
    console.log('Abkürzungs-Mappings geladen:', Object.keys(abbrevMap).length, 'Abkürzungen');
  } catch (err) {
    console.error('Fehler beim Laden der Abkürzungs-Mappings:', err);
  }
}

function getAbbrevsForName(stationName) {
  if (!stationName) return [];
  const normName = stationName.trim().toLowerCase();
  return nameToAbbrevMap[normName] || [];
}

// ─── Hamburger-Menü ─────────────────────────────────────────

function toggleMenu() {
  const sidebar = document.getElementById('menu-sidebar');
  const overlay = document.getElementById('menu-overlay');
  
  if (!sidebar || !overlay) return;
  
  sidebar.classList.toggle('active');
  overlay.classList.toggle('active');
  document.body.style.overflow = sidebar.classList.contains('active') ? 'hidden' : '';
}

function closeMenu() {
  const sidebar = document.getElementById('menu-sidebar');
  const overlay = document.getElementById('menu-overlay');
  
  if (!sidebar || !overlay) return;
  
  sidebar.classList.remove('active');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

// ─── Stations-View (Wichtige Bahnhöfe) ──────────────────────────

function renderStationsView() {
  const stationsView = document.getElementById('stations-view');
  const stationsList = document.getElementById('stations-list');
  
  if (!stationsView || !stationsList) return;
  
  stationsList.innerHTML = '';
  
  DEFAULT_FAVORITES.forEach(station => {
    const li = document.createElement('li');
    
    const link = document.createElement('a');
    link.className = 'stations-item';
    link.textContent = station.name;
    link.href = 'javascript:void(0);';
    
    link.addEventListener('click', (e) => {
      e.preventDefault();
      selectStation(station.stopId, station.name, null);
      closeStationsView();
    });
    
    li.appendChild(link);
    stationsList.appendChild(li);
  });
  
  stationsView.style.display = 'flex';
}

function closeStationsView() {
  const stationsView = document.getElementById('stations-view');
  if (stationsView) {
    stationsView.style.display = 'none';
  }
}

function checkAndRenderView() {
  const viewParam = params.get('view');
  
  if (viewParam === 'stations') {
    renderStationsView();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadAbbreviations().then(() => renderFavoritesBar());
  loadCombinedStations();
  updateCalendarExportButton();

  // Hamburger-Menü Event-Listener
  const btnMenuToggle = document.getElementById('btn-menu-toggle');
  const btnMenuClose = document.getElementById('btn-menu-close');
  const menuOverlay = document.getElementById('menu-overlay');
  const menuLinks = document.querySelectorAll('.menu-link');

  if (btnMenuToggle) {
    btnMenuToggle.addEventListener('click', toggleMenu);
  }

  if (btnMenuClose) {
    btnMenuClose.addEventListener('click', closeMenu);
  }

  if (menuOverlay) {
    menuOverlay.addEventListener('click', closeMenu);
  }

  menuLinks.forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  // Stations-View Event-Listener
  const btnCloseStations = document.getElementById('btn-close-stations');
  if (btnCloseStations) {
    btnCloseStations.addEventListener('click', closeStationsView);
  }

  // Check for view parameter and render accordingly
  checkAndRenderView();
});

// ─── Modus-Filter (localStorage-persistent) ────────────────────────────────

const MODE_GROUPS = {
  HIGHSPEED: ['HIGHSPEEDRAIL', 'HIGHSPEED_RAIL', 'INTERCITYRAIL', 'LONGDISTANCERAIL', 'LONG_DISTANCE'],
  RAIL: ['TRAIN', 'RAIL', 'COACHRAILWAY', 'LOCALTRAIN', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN'],
  NIGHT: ['NIGHTRAIL', 'NIGHT_RAIL'],
  SUBWAY:  ['SUBWAY', 'METRO', 'URBAN_RAIL'],
  TRAM:    ['TRAM', 'TROLLEYBUS', 'STREETCAR'],
  BUS:     ['BUS', 'COACH', 'REGIONALBUS', 'EXPRESBUS', 'DEBUG_BUS_ROUTE'],
  FERRY:   ['FERRY', 'WATER', 'BOAT', 'DEBUG_FERRY_ROUTE'],
  GONDOLA: ['GONDOLA', 'CHAIRLIFT', 'CABLEWAY', 'FUNICULAR', 'AERIAL_LIFT', 'AREAL_LIFT', 'CABLE_CAR'],
  OTHER:   ['WALK', 'BIKE', 'RENTAL', 'CAR', 'CAR_PARKING', 'CAR_DROPOFF', 'ODM', 'RIDE_SHARING', 'FLEX', 'AIRPLANE', 'OTHER']
};

// Meta-groups for quick filtering
const MODE_META_GROUPS = {
  RAIL_ALL: ['HIGHSPEED', 'RAIL', ,'SUBWAY', 'NIGHT'],
  URBAN: ['SUBWAY', 'TRAM', 'BUS'],
  TRANSIT: ['HIGHSPEED', 'RAIL', 'NIGHT', 'SUBWAY', 'TRAM', 'BUS', 'FERRY', 'GONDOLA']
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

function loadActiveModesFromStorage() {
  try {
    const stored = localStorage.getItem('tragic_mode_filter');
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        alleModeActive: parsed.alleModeActive ?? true,
        selectedModes: new Set(parsed.selectedModes || [])
      };
    }
  } catch (_) {}
  return { alleModeActive: true, selectedModes: new Set() };
}

let filterState = loadActiveModesFromStorage();

function loadViaLoadingFromStorage() {
  try {
    return localStorage.getItem(VIA_LOADING_STORAGE_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

let viaLoadingEnabled = loadViaLoadingFromStorage();

function saveViaLoadingToStorage() {
  try {
    localStorage.setItem(VIA_LOADING_STORAGE_KEY, viaLoadingEnabled ? 'true' : 'false');
  } catch (_) {}
}

function updateViaToggleButton() {
  const btn = document.getElementById('btn-toggle-vias');
  if (!btn) return;

  btn.classList.toggle('active', viaLoadingEnabled);
  btn.textContent = viaLoadingEnabled ? '$vias ein' : '$vias';
  btn.title = viaLoadingEnabled
    ? 'Via-Nachladung ist aktiv (klick zum Deaktivieren)'
    : 'Via-Nachladung ist deaktiviert (klick zum Aktivieren)';
}

function toggleViaLoading() {
  viaLoadingEnabled = !viaLoadingEnabled;
  saveViaLoadingToStorage();
  updateViaToggleButton();

  if (allDepartures.length > 0) {
    renderDepartures(allDepartures);
  }
}

function saveModesToStorage() {
  localStorage.setItem('tragic_mode_filter', JSON.stringify({
    alleModeActive: filterState.alleModeActive,
    selectedModes: [...filterState.selectedModes]
  }));
}

function updateModeButtons() {
  const btnAll = document.getElementById('btn-mode-all');
  if (btnAll) btnAll.classList.toggle('active', filterState.alleModeActive);
  
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    const mode = btn.dataset.mode;
    btn.classList.toggle('active', filterState.selectedModes.has(mode));
  });
}

function activateModesInGroup(groupModes) {
  filterState.alleModeActive = false;
  filterState.selectedModes.clear();
  groupModes.forEach(mode => filterState.selectedModes.add(mode));
  saveModesToStorage();
  updateModeButtons();
  applyFilters();
}

document.addEventListener('DOMContentLoaded', () => {
  const btnAll = document.getElementById('btn-mode-all');
  if (btnAll) {
    btnAll.addEventListener('click', () => {
      filterState.alleModeActive = true;
      filterState.selectedModes.clear();
      saveModesToStorage();
      updateModeButtons();
      applyFilters();
    });
  }

  // Meta-group buttons
  const btnRailAll = document.getElementById('btn-mode-rail-all');
  if (btnRailAll) {
    btnRailAll.addEventListener('click', () => {
      activateModesInGroup(MODE_META_GROUPS.RAIL_ALL);
    });
  }

  const btnUrban = document.getElementById('btn-mode-urban');
  if (btnUrban) {
    btnUrban.addEventListener('click', () => {
      activateModesInGroup(MODE_META_GROUPS.URBAN);
    });
  }

  const btnTransit = document.getElementById('btn-mode-transit');
  if (btnTransit) {
    btnTransit.addEventListener('click', () => {
      activateModesInGroup(MODE_META_GROUPS.TRANSIT);
    });
  }
});

document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
  const mode = btn.dataset.mode;

  btn.addEventListener('click', () => {
    filterState.alleModeActive = false;
    
    if (filterState.selectedModes.has(mode)) {
      filterState.selectedModes.delete(mode);
    } else {
      filterState.selectedModes.add(mode);
    }
    
    saveModesToStorage();
    updateModeButtons();
    applyFilters();
  });
});

updateModeButtons();

// ─── Ankunft / Abfahrt Modus-Umschaltung ───────────────────────────────────

function toggleArrivalMode() {
  isArrivalsMode = !isArrivalsMode;
  updateArrivalToggleUI();
  const refEpoch = syncPickersToUrl();
  loadDepartures(refEpoch);
}

function updateArrivalToggleUI() {
  const titleEl = document.getElementById('app-title');
  const thTime = document.getElementById('th-col-time');
  const thDest = document.getElementById('th-col-dest');
  
  if (titleEl) {
    titleEl.textContent = isArrivalsMode ? 'öV OMNI (An)' : 'öV OMNI';
  }
  if (thTime) {
    thTime.textContent = isArrivalsMode ? 'An' : 'Ab';
  }
  if (thDest) {
    thDest.textContent = isArrivalsMode ? 'Von' : 'Ziel';
  }
}

// ─── Ziel-Filter ────────────────────────────────────────────────────────────

if (destFilter) {
  destFilter.addEventListener('input', () => applyFilters());
}

function applyFilters() {
  const destQuery = destFilter ? destFilter.value.trim().toLowerCase() : '';

  document.querySelectorAll('#departureBody tr.dep-row').forEach(tr => {
    const mode   = tr.dataset.mode   || 'OTHER';
    const dest   = (tr.dataset.dest  || '').toLowerCase();
    const line   = (tr.dataset.line  || '').toLowerCase();
    const trip   = (tr.dataset.trip  || '').toLowerCase();
    const agencyId   = (tr.dataset.agencyId   || '').toLowerCase();
    const agencyName = (tr.dataset.agencyName || '').toLowerCase();
    const tripId     = (tr.dataset.tripId     || '').toLowerCase();
    const vias       = (tr.dataset.vias       || '').toLowerCase();

    const modeHide = !filterState.alleModeActive && !filterState.selectedModes.has(mode);
    
    const destHide = destQuery && 
      !dest.includes(destQuery) && 
      !line.includes(destQuery) && 
      !trip.includes(destQuery) && 
      !agencyId.includes(destQuery) && 
      !agencyName.includes(destQuery) && 
      !tripId.includes(destQuery) &&
      !vias.includes(destQuery);

    tr.classList.toggle('filtered-mode', modeHide);
    tr.classList.toggle('filtered-dest', destHide);
  });
}

// ─── Datum / Zeit (URL ↔ Picker) ────────────────────────────────────────────

function getSelectedEpoch() {
  if (!datePicker.value || !timePicker.value) return null;
  const dt = new Date(`${datePicker.value}T${timePicker.value}`);
  return isNaN(dt.getTime()) ? null : Math.floor(dt.getTime() / 1000);
}

function setPickersFromEpoch(epoch) {
  if (!datePicker || !timePicker) return;
  if (!epoch) {
    datePicker.value = '';
    timePicker.value = '';
    return;
  }
  const date = new Date(epoch * 1000);
  const pad2 = n => String(n).padStart(2, '0');
  datePicker.value = `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
  timePicker.value = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function syncPickersToUrl() {
  const refEpoch = getSelectedEpoch();
  const url = new URL(location.href);
  if (refEpoch) url.searchParams.set('time', refEpoch);
  else          url.searchParams.delete('time');

  if (isArrivalsMode) url.searchParams.set('arrivals', 'true');
  else                url.searchParams.delete('arrivals');

  history.pushState({
    stopId: currentStopId, 
    stationName: currentStationName, 
    epoch: refEpoch,
    arrivals: isArrivalsMode,
    calendarStart,
    calendarVias,
    calendarDest
  }, '', url);
  return refEpoch;
}

const triggerTimeChange = () => {
  if (!currentStopId) return;
  const refEpoch = syncPickersToUrl();
  loadDepartures(refEpoch);
};

if (datePicker) datePicker.addEventListener('change', triggerTimeChange);
if (timePicker) timePicker.addEventListener('change', triggerTimeChange);

// ─── Navigation Buttons (Früher / Später) ──────────────────────────────────

function setupNavigationButtons() {
  const handleEarlier = () => {
    const currentEpoch = getSelectedEpoch();
    if (!currentEpoch) return;
    const earlierEpoch = currentEpoch - (20 * 60);
    setPickersFromEpoch(earlierEpoch);
    triggerTimeChange();
  };

  const handleLater = () => {
    const currentEpoch = getSelectedEpoch() || Math.floor(Date.now() / 1000);
    
    if (allDepartures.length === 0) {
      setPickersFromEpoch(currentEpoch + (20 * 60));
      triggerTimeChange();
      return;
    }

    const maxTime = Math.max(...allDepartures.map(d => d.scheduled || d.live || 0));

    if (maxTime > currentEpoch) {
      setPickersFromEpoch(maxTime + 60);
    } else {
      setPickersFromEpoch(currentEpoch + (20 * 60));
    }
    
    triggerTimeChange();
  };

  const btnEarlierTop = document.getElementById('btn-earlier-top');
  const btnLaterTop = document.getElementById('btn-later-top');
  const btnEarlierBottom = document.getElementById('btn-earlier-bottom');
  const btnLaterBottom = document.getElementById('btn-later-bottom');
  
  if (btnEarlierTop) btnEarlierTop.addEventListener('click', handleEarlier);
  if (btnLaterTop) btnLaterTop.addEventListener('click', handleLater);
  if (btnEarlierBottom) btnEarlierBottom.addEventListener('click', handleEarlier);
  if (btnLaterBottom) btnLaterBottom.addEventListener('click', handleLater);
}

document.addEventListener('DOMContentLoaded', () => {
  const btnToggleArrivals = document.getElementById('btn-toggle-arrivals');
  if (btnToggleArrivals) btnToggleArrivals.addEventListener('click', toggleArrivalMode);

  const btnToggleVias = document.getElementById('btn-toggle-vias');
  if (btnToggleVias) btnToggleVias.addEventListener('click', toggleViaLoading);
  updateViaToggleButton();

  updateArrivalToggleUI();

  setTimeout(() => {
    setupNavigationButtons();
  }, 100);
  
  updateClock();
  setInterval(updateClock, 1000);

  window.addEventListener('popstate', (event) => {
    const state = event.state;
    if (state && state.stopId) {
      currentStopId = state.stopId;
      currentStationName = state.stationName || 'Station wählen';
      isArrivalsMode = state.arrivals || false;
      if (state.calendarStart) calendarStart = state.calendarStart;
      if (state.calendarVias) calendarVias = state.calendarVias;
      if (state.calendarDest) calendarDest = state.calendarDest;
      updateArrivalToggleUI();
      updateStationTitle(currentStationName);
      setPickersFromEpoch(state.epoch);
      loadDepartures(state.epoch);
      updateCalendarExportButton();
    }
  });

  const btnJetzt = document.getElementById('btn-jetzt');
  if (btnJetzt) btnJetzt.addEventListener('click', setCurrentTime);
  
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) btnRefresh.addEventListener('click', reloadDepartures);

  const btnExportCalendar = document.getElementById('btn-export-calendar');
  if (btnExportCalendar) {
    btnExportCalendar.addEventListener('click', exportCalendarJourney);
  }
});

// ─── Stationssuche ───────────────────────────────────────────────────────────

const queryInput = document.getElementById('query');
if (queryInput) {
  queryInput.addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    const list = document.getElementById('suggestions');
    if (!list) return;
    list.innerHTML = '';
    if (q.length < 2) return;
   
    try {
      const abbrevMatches = [];
      const qUpper = q.toUpperCase();
      if (abbrevMap[qUpper]) {
        for (const match of abbrevMap[qUpper]) {
          try {
            const searchRes = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(match.name)}`);
            const searchData = await searchRes.json();
            const station = (searchData.stations || []).find(s => s.name.toLowerCase() === match.name.toLowerCase());
            
            if (station) {
              abbrevMatches.push({
                id: station.id,
                name: match.name,
                abbrev: qUpper,
                country: match.country,
                source: 'abbrev'
              });
            }
          } catch (_) {}
        }
      }
   
      const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(q)}`);
      const data = await res.json();
      
      const apiMatches = (data.stations || []).map(st => {
        const foundAbbrevs = getAbbrevsForName(st.name);
        const primary = foundAbbrevs.length > 0 ? foundAbbrevs[0] : null;
        return {
          id: st.id,
          name: st.name,
          abbrev: primary ? primary.abbrev : null,
          country: primary ? primary.country : null,
          source: 'api'
        };
      });
   
      const seen = new Set();
      const allMatches = [...abbrevMatches, ...apiMatches];
      
      allMatches.forEach(match => {
        const key = (match.id || match.name).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
   
        const li = document.createElement('li');
        let html = escapeHtml(match.name);
        
        if (match.abbrev) {
          html += ` <span class="abbrev-label">${escapeHtml(match.abbrev)}${match.country ? ` [${escapeHtml(match.country)}]` : ''}</span>`;
        }
        
        if (match.id) {
          html += ` <span class="suggestion-id">(${escapeHtml(match.id)})</span>`;
        }
        
        li.innerHTML = html;
        li.onclick = () => selectStation(match.id, match.name, null);
        list.appendChild(li);
      });
    } catch (err) {
      setStatus('Fehler bei der Stationssuche: ' + err.message);
    }
  }, 350));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-box')) {
    const list = document.getElementById('suggestions');
    if (list) list.innerHTML = '';
  }
});

// ─── Init aus URL ────────────────────────────────────────────────────────────

const urlTimeRaw = params.get('time');
const urlEpoch   = urlTimeRaw && !isNaN(Number(urlTimeRaw)) ? Number(urlTimeRaw) : null;

let initialEpoch = urlEpoch;
if (!initialEpoch) {
  const now = new Date();
  initialEpoch = Math.floor(now.getTime() / 1000);
  setPickersFromEpoch(initialEpoch);
} else {
  setPickersFromEpoch(initialEpoch);
}

if (params.get('stopId')) {
  currentStopId = params.get('stopId');
  currentStationName = 'Station wählen';
  updateStationTitle(currentStationName);
  loadDepartures(initialEpoch);
}

// ─── Station Title aktualisieren ────────────────────────────────────────────

function updateStationTitle(name) {
  currentStationName = name;
  const el = document.getElementById('stationTitle');
  if (el) el.textContent = name;
  document.title = name + ' | OMNI (NOWE)';
  renderFavoritesBar();
}

// ─── Station auswählen ───────────────────────────────────────────────────────

function selectStation(stopId, name, refEpoch) {
  if (stopId === null) {
    selectStationByName(name, refEpoch);
    return;
  }

  currentStopId = stopId;
  currentStationName = name;
  currentMainStationId = stopId;
  updateStationTitle(name);
  
  const list = document.getElementById('suggestions');
  if (list) list.innerHTML = '';
  if (queryInput) queryInput.value = '';

  if (refEpoch) {
    setPickersFromEpoch(refEpoch);
  }

  const currentEpoch = getSelectedEpoch();

  const url = new URL(location.href);
  url.searchParams.set('stopId', stopId);
  
  if (currentEpoch) url.searchParams.set('time', currentEpoch);
  else              url.searchParams.delete('time');

  if (isArrivalsMode) url.searchParams.set('arrivals', 'true');
  else                url.searchParams.delete('arrivals');

  history.pushState({stopId, stationName: name, epoch: currentEpoch, arrivals: isArrivalsMode, calendarStart, calendarVias, calendarDest}, '', url);

  loadDepartures(currentEpoch);
  window.scrollTo({top: 250, behavior: 'smooth'});
}

async function selectStationByName(name, refEpoch) {
  try {
    const res = await fetch(`${PROXY}?action=search&query=${encodeURIComponent(name)}`);
    const data = await res.json();
    const stations = data.stations || [];
    
    if (stations.length === 0) {
      alert(`Station "${name}" nicht gefunden.`);
      return;
    }
    
    const match = stations.find(s => s.name.toLowerCase() === name.toLowerCase()) || stations[0];
    selectStation(match.id, match.name, refEpoch);
  } catch (err) {
    alert('Fehler bei der Stationssuche: ' + err.message);
  }
}

// ─── Line Normalization ──────────────────────────────────────────────────────

function normalizeLineDisplay(line) {
  if (!line) return '';
  const upper = line.toUpperCase();
  
  if (upper.startsWith('TGV LYRIA')) return 'TGV Lyria';
  if (upper.startsWith('TER')) return 'TER';
  if (upper.startsWith('ICE')) return 'ICE';
  if (upper.startsWith('ICD')) return 'ICD';
  if (upper.startsWith('ECD')) return 'ECD';
  if (upper.startsWith('FR')) return 'FR';
  if (upper.startsWith('EC')) return 'EC';
  if (upper.startsWith('RV')) return 'RV';
  if (upper.startsWith('GATWICK EXPRESS')) return 'GX';
  if (upper.startsWith('ELIZABETH LINE')) return 'ELZ';
  
  return line.replace(/\s*\(\d+\)\s*$/g, '').trim();
}

// ─── Async Destination Loading ───────────────────────────────────────────────

let tripDetailsQueue = Promise.resolve();

function queueTripDetailsLoad(dep, tbody, depIdx) {
  tripDetailsQueue = tripDetailsQueue
    .then(() => loadTripDestinationAsync(dep, tbody, depIdx))
    .catch(err => {
      console.warn(`Trip details queue error for ${dep.tripId}:`, err);
    });
}

function normalizeStationKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getStopRefEpoch(stop, arrivalsMode) {
  if (!stop) return 0;
  if (arrivalsMode) {
    return stop.arrivalLive || stop.arrivalSched || stop.departureLive || stop.departureSched || 0;
  }
  return stop.departureLive || stop.departureSched || stop.arrivalLive || stop.arrivalSched || 0;
}

function pickClosestStopIndexByTime(stops, indices, refEpoch) {
  if (!Array.isArray(indices) || indices.length === 0) return -1;
  if (!refEpoch) return indices[0];

  let bestIdx = -1;
  let bestDelta = Infinity;

  indices.forEach(idx => {
    const t = getStopRefEpoch(stops[idx], isArrivalsMode);
    if (!t) return;
    const delta = Math.abs(t - refEpoch);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = idx;
    }
  });

  return bestIdx >= 0 ? bestIdx : indices[0];
}

function findOriginStopIndex(stops, dep, originName) {
  if (!Array.isArray(stops) || stops.length === 0) return -1;
  const refEpoch = dep?.scheduled || dep?.live || 0;

  const candidates = [];
  if (dep?.stopId) candidates.push(String(dep.stopId));
  if (currentStopId) candidates.push(String(currentStopId));
  if (currentMainStationId) candidates.push(String(currentMainStationId));

  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  if (uniqueCandidates.length > 0) {
    const matchingIndices = [];
    stops.forEach((stop, idx) => {
      if (uniqueCandidates.includes(String(stop?.stopId || ''))) {
        matchingIndices.push(idx);
      }
    });
    const byStopId = pickClosestStopIndexByTime(stops, matchingIndices, refEpoch);
    if (byStopId >= 0) return byStopId;
  }

  const normalizedOriginNames = [originName, dep?._fromStation, currentStationName]
    .map(normalizeStationKey)
    .filter(Boolean);

  if (normalizedOriginNames.length > 0) {
    const matchingIndices = [];
    stops.forEach((stop, idx) => {
      const stopName = normalizeStationKey(stop?.name);
      if (normalizedOriginNames.includes(stopName)) {
        matchingIndices.push(idx);
      }
    });
    const byName = pickClosestStopIndexByTime(stops, matchingIndices, refEpoch);
    if (byName >= 0) return byName;
  }

  if (!refEpoch) return -1;

  let bestIdx = -1;
  let bestDelta = Infinity;
  stops.forEach((stop, idx) => {
    const t = getStopRefEpoch(stop, isArrivalsMode);
    if (!t) return;
    const delta = Math.abs(t - refEpoch);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = idx;
    }
  });

  // Guardrail: only trust time fallback if reasonably close.
  if (bestIdx >= 0 && bestDelta <= 120 * 60) {
    return bestIdx;
  }

  return -1;
}

function getLegInfoByIndex(legInfos, legIndex) {
  if (!legInfos) return null;

  if (Array.isArray(legInfos)) {
    return legInfos[legIndex] || null;
  }

  if (typeof legInfos === 'object') {
    return legInfos[String(legIndex)] || null;
  }

  return null;
}

function resolveLegContext(data, dep, originName) {
  const stops = Array.isArray(data?.stops) ? data.stops : [];
  if (stops.length === 0) {
    return { stops: [], originIdx: -1, legIndex: 0, legStartIdx: 0, legEndIdx: -1, legInfo: null };
  }

  let originIdx = findOriginStopIndex(stops, dep, originName);
  if (originIdx < 0 && !isArrivalsMode) {
    originIdx = 0;
  }

  const safeOriginIdx = Math.max(0, Math.min(originIdx, stops.length - 1));
  const legIndex = Number.isFinite(stops[safeOriginIdx]?.legIndex) ? stops[safeOriginIdx].legIndex : 0;

  let legStartIdx = safeOriginIdx;
  while (legStartIdx > 0 && (Number.isFinite(stops[legStartIdx - 1]?.legIndex) ? stops[legStartIdx - 1].legIndex : 0) === legIndex) {
    legStartIdx--;
  }

  let legEndIdx = safeOriginIdx;
  while (legEndIdx + 1 < stops.length && (Number.isFinite(stops[legEndIdx + 1]?.legIndex) ? stops[legEndIdx + 1].legIndex : 0) === legIndex) {
    legEndIdx++;
  }

  return {
    stops,
    originIdx: safeOriginIdx,
    legIndex,
    legStartIdx,
    legEndIdx,
    legInfo: getLegInfoByIndex(data?.legInfos, legIndex)
  };
}

function resolveDestinationForLeg(data, dep, originName) {
  const context = resolveLegContext(data, dep, originName);
  const { stops, legInfo, legEndIdx } = context;

  let finalDestination = getDestinationName(legInfo?.destination || '');
  let isFromLastStop = false;

  if (!finalDestination && stops.length > 0 && legEndIdx >= 0) {
    finalDestination = getDestinationName(stops[legEndIdx]?.name || '');
    isFromLastStop = !!finalDestination;
  }

  if (!finalDestination) {
    finalDestination = getDestinationName(data?.destination || '');
  }

  if (!finalDestination && stops.length > 0) {
    finalDestination = getDestinationName(stops[stops.length - 1]?.name || '');
    isFromLastStop = !!finalDestination;
  }

  return { finalDestination, isFromLastStop, context };
}

function extractViasFromTripData(data, dep, originName, destinationName) {
  const { stops, originIdx, legStartIdx, legEndIdx } = resolveLegContext(data, dep, originName);
  if (stops.length < 3) return [];

  const destNorm = normalizeStationKey(destinationName);
  const originNorm = normalizeStationKey(originName);

  const rawVias = [];

  if (isArrivalsMode && originIdx > legStartIdx) {
    for (let i = legStartIdx; i < originIdx; i++) {
      const viaName = String(stops[i]?.name || '').trim();
      if (viaName) rawVias.push(viaName);
    }
  } else {
    const startIdx = Math.max(originIdx, legStartIdx);
    for (let i = startIdx + 1; i < legEndIdx; i++) {
      const viaName = String(stops[i]?.name || '').trim();
      if (viaName) rawVias.push(viaName);
    }
  }

  const seen = new Set();
  return rawVias.filter(name => {
    const norm = name.toLowerCase();
    if (!name || norm === destNorm || norm === originNorm || seen.has(norm)) {
      return false;
    }
    seen.add(norm);
    return true;
  });
}

function renderViaLine(vias) {
  if (!viaLoadingEnabled) return '';
  if (!Array.isArray(vias) || vias.length === 0) return '';
  return `<span class="via">via ${vias.map(v => escapeHtml(v)).join(' · ')}</span>`;
}

function renderDestinationCellHtml(destName, isFromLastStop, stationHintHtml, vias) {
  const destDisplay = isFromLastStop
    ? `<em>${escapeHtml(destName)}</em>`
    : escapeHtml(destName);
  const viaHtml = renderViaLine(vias);
  return `${destDisplay}${viaHtml}${stationHintHtml}`;
}

async function loadTripDestinationAsync(dep, tbody, depIdx) {
  if (!dep.tripId) return;
  
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 800));
  
  try {
    const res = await fetch(`${PROXY}?action=trip&tripId=${encodeURIComponent(dep.tripId)}`);
    const data = await res.json();
    
    if (data.error) {
      console.warn(`Failed to load trip ${dep.tripId}:`, data.error);
      return;
    }
    
    const { finalDestination, isFromLastStop } = resolveDestinationForLeg(data, dep, dep._fromStation || currentStationName);

    const destName = getDestinationName(finalDestination);
    const viaNames = viaLoadingEnabled
      ? extractViasFromTripData(data, dep, dep._fromStation || currentStationName, destName)
      : [];
    dep.vias = viaNames;
    
    if (finalDestination) {
      dep.destination = finalDestination;
    }

    const rows = tbody.querySelectorAll('tr.dep-row');
    if (rows[depIdx]) {
      const row = rows[depIdx];
      const isSameTrip = (row.dataset.tripId || '') === (dep.tripId || '');
      if (!isSameTrip) {
        return;
      }
      const destCell = row.querySelector('.col-dest');
      if (destCell && destName) {
        row.dataset.dest = destName;
        row.dataset.vias = viaLoadingEnabled ? viaNames.join(' ') : '';

        const stationHint = destCell.querySelector('.station-hint');
        const stationHintHtml = stationHint ? stationHint.outerHTML : '';

        destCell.innerHTML = renderDestinationCellHtml(destName, isFromLastStop, stationHintHtml, viaNames);

        applyFilters();
      }
    }
  } catch (err) {
    console.warn(`Failed to load destination for trip ${dep.tripId}:`, err);
  }
}

// ─── Abfahrten/Ankünfte laden ────────────────────────────────────────────────

async function loadDepartures(refEpoch) {
  if (!currentStopId) return;
  setStatus(isArrivalsMode ? 'Lade Ankünfte…' : 'Lade Abfahrten…');

  if (refEpoch === undefined) {
    refEpoch = getSelectedEpoch();
  }

  try {
    let departures;
    
    if (window.combinedStationsReady && window.combinedStations && window.combinedStations[currentStationName]) {
      console.log('Using combined departures/arrivals for:', currentStationName);
      departures = await fetchCombinedDepartures(currentStopId, currentStationName, refEpoch, 25);
      // Deduplicate combined departures
      departures = deduplicateDepartures(departures);
    } else {
      console.log('Using single station departures/arrivals for:', currentStationName);
      let q = `${PROXY}?action=departures&stopId=${encodeURIComponent(currentStopId)}&n=25`;
      if (isArrivalsMode) q += '&arrivals=true';
      if (refEpoch) {
        q += `&time=${encodeURIComponent(new Date(refEpoch * 1000).toISOString())}`;
      }
      const res = await fetch(q);
      const data = await res.json();

      if (data.error) {
        renderError(data.error);
        setStatus('');
        updateNavButtonsVisibility();
        return;
      }

      departures = data.departures || [];
      departures = departures.map(dep => ({
        ...dep,
        _fromStation: currentStationName,
        _isMainStation: true
      }));
    }

    allDepartures = departures;
    renderDepartures(allDepartures);
    setStatus(refEpoch
      ? (isArrivalsMode ? 'Ankünfte' : 'Abfahrten') + ' ab ausgewähltem Zeitpunkt · ' + (timePicker ? timePicker.value : '')
      : 'Aktualisiert um: ' + new Date().toLocaleTimeString('de-CH'));
    
    updateNavButtonsVisibility();
  } catch (err) {
    renderError(err.message);
    updateNavButtonsVisibility();
  }

  clearTimeout(refreshTimer);
  if (!refEpoch) refreshTimer = setTimeout(() => loadDepartures(null), 30000);
}

// ─── Navigation Buttons anzeigen/verstecken ────────────────────────────────

function updateNavButtonsVisibility() {
  const isVisible = allDepartures.length > 0;
  const topNav = document.getElementById('nav-buttons-top');
  const bottomNav = document.getElementById('nav-buttons-bottom');
  if (topNav) topNav.style.display = isVisible ? 'flex' : 'none';
  if (bottomNav) bottomNav.style.display = isVisible ? 'flex' : 'none';
}

// ─── Rendern ─────────────────────────────────────────────────────────────────

function renderError(msg) {
  const table = document.getElementById('departureTable');
  if (table) table.style.display = 'none';
  document.getElementById('status').innerHTML = `<div class="error-hint">Fehler: ${escapeHtml(msg)}</div>`;
}

function getModeIcon(mode) {
  if (!mode) return '';
  const m = mode.toUpperCase();
  if (m === 'TRAM') return 'T';
  if (m === 'BUS')  return 'B';
  return '';
}

// ─── Trip Number Formatting Helper ──────────────────────────────────────────

function formatTripNumber(tripNumber, line) {
  if (!tripNumber || tripNumber === '0' || tripNumber === 0) {
    return extractTripNumberFromLine(line);
  }
  
  tripNumber = String(tripNumber).trim();
  
  if (tripNumber === '0' || /^0+$/.test(tripNumber)) {
    return extractTripNumberFromLine(line);
  }
  
  const match1 = tripNumber.match(/\s*-\s*(\d+)$/);
  if (match1) {
    return match1[1];
  }

  const match2 = tripNumber.match(/^[A-Za-z]+\s+(\d+)$/);
  if (match2) {
    return match2[1];
  }
  
  return tripNumber.replace(/^0+(?=\d)/, '');
}

function extractTripNumberFromLine(line) {
  if (!line) return '';
  
  line = line.trim();
  
  const match1 = line.match(/\s*-\s*(\d+)$/);
  if (match1) {
    return match1[1];
  }
  
  const match2 = line.match(/(?:^|\s)(\d+)$/);
  if (match2) {
    return match2[1];
  }
  
  return '';
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateDepartures(departures) {
  const seen = new Map();
  const deduplicated = [];

  departures.forEach(dep => {
    const tripId = dep.tripId || '';
    const scheduled = dep.scheduled || 0;
    const line = dep.line || '';
    
    // Key: tripId + scheduled time + line (for trips without tripId)
    const key = tripId ? `${tripId}:${scheduled}` : `${line}:${scheduled}`;
    
    if (!seen.has(key)) {
      seen.set(key, true);
      deduplicated.push(dep);
    }
  });

  return deduplicated;
}

// ─── Rendern ─────────────────────────────────────────────────────────────────

function renderDepartures(departures) {
  const tbody = document.getElementById('departureBody');
  const table = document.getElementById('departureTable');
  if (!tbody || !table) return;

  tbody.innerHTML = '';
  table.style.display = departures.length ? 'table' : 'none';

  if (!departures.length) {
    document.getElementById('status').innerHTML = '<div class="empty-hint">Keine Einträge gefunden.</div>';
    return;
  }

  const sorted = [...departures].sort((a, b) => {
    const timeA = a.scheduled || Infinity;
    const timeB = b.scheduled || Infinity;
    return timeA - timeB;
  });

  let lastDate = null;

  sorted.forEach((dep, depIdx) => {
    // Check if date changed and insert date separator
    if (dep.scheduled) {
      const depDate = new Date(dep.scheduled * 1000);
      const dateKey = `${depDate.getFullYear()}-${String(depDate.getMonth() + 1).padStart(2, '0')}-${String(depDate.getDate()).padStart(2, '0')}`;
      
      if (lastDate !== dateKey) {
        const dateStr = depDate.toLocaleDateString('de-CH', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
        const separatorRow = document.createElement('tr');
        separatorRow.className = 'date-separator-row';
        separatorRow.innerHTML = `<td colspan="4"><div class="date-separator">${escapeHtml(dateStr)}</div></td>`;
        tbody.appendChild(separatorRow);
        lastDate = dateKey;
      }
    }

    const tr = document.createElement('tr');
    tr.className = 'dep-row';

    const needsDestinationFallback = !!dep.tripId && !dep.destination;
    const needsViaLoading = !!dep.tripId && viaLoadingEnabled && !Array.isArray(dep.vias);
    const shouldLoadTripDetails = needsDestinationFallback || needsViaLoading;
    if (shouldLoadTripDetails) {
      queueTripDetailsLoad(dep, tbody, depIdx);
    }

    const timeStr = dep.scheduled
      ? new Date(dep.scheduled * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit'})
      : '–';

    let delayHtml = '';
    if (dep.cancelled) {
      delayHtml = '<span class="cancelled">Ausfall</span>';
    } else if (dep.delaySec !== null && dep.delaySec !== undefined) {
      const delayMin = Math.floor(dep.delaySec / 60);
      if (delayMin < 0) {
        delayHtml = `<span class="vbz-delay">${fmtDelay(dep.delaySec)}</span>`;
      } else if (delayMin > 0) {
        delayHtml = `<span class="delay">${fmtDelay(dep.delaySec)}</span>`;
      }
    }

    const iconHtml = getModeIcon(dep.mode);
    const destName = getDestinationName(dep.destination);
    const displayLine = normalizeLineDisplay(dep.line);

    const tripNumDisplay = formatTripNumber(dep.tripNumber, dep.line);

    tr.dataset.mode = canonicalMode(dep.mode);
    tr.dataset.dest = destName;
    tr.dataset.trip = dep.tripNumber || '';
    tr.dataset.line = dep.line || '';
    tr.dataset.agencyId = dep.agencyId || '';
    tr.dataset.agencyName = dep.agencyName || '';
    tr.dataset.tripId = dep.tripId || '';
    tr.dataset.vias = Array.isArray(dep.vias) ? dep.vias.join(' ') : '';
    tr.dataset.scheduled = dep.scheduled || '';

    let stationLabelHtml = '';
    if (dep._fromStation && !dep._isMainStation) {
      stationLabelHtml = `<div class="station-hint">${isArrivalsMode ? 'an' : 'ab'} ${escapeHtml(dep._fromStation)}</div>`;
    }

    const destDisplay = (!dep.destination && shouldLoadTripDetails)
      ? '<span style="color:#999; font-style:italic;">Lade Zielbahnhof aus Trip…</span>'
      : escapeHtml(destName);

    const viaHtml = renderViaLine(dep.vias);

    tr.innerHTML = `
      <td class="col-time">${timeStr}<br><span class="delay-badge">${delayHtml}</span></td>
      <td class="col-line">
        <div class="line-container" data-mode="${canonicalMode(dep.mode)}" data-agency-id="${escapeHtml(dep.agencyId || '')}" data-agency-name="${escapeHtml(dep.agencyName || '')}" data-line="${escapeHtml(dep.line || '')}" data-route-id="${escapeHtml(dep.routeId || '')}"><span class="line">${iconHtml}${escapeHtml(displayLine)}</span></div>
        <div class="col-nr tripnr">${tripNumDisplay}</div>
      </td>
      <td class="col-dest">${destDisplay}${viaHtml}${stationLabelHtml}</td>
      <td class="col-platform">${escapeHtml(dep.track)}</td>
    `;
    tr.onclick = () => toggleChain(tr, dep);
    tbody.appendChild(tr);
  });

  applyFilters();
}

// ─── Fahrt-Chain 	─────────────────────────────────────────────────────────────

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

function getStopTime(stop) {
  if (!stop) return 0;
  return stop.departureSched || stop.departureLive || stop.arrivalSched || stop.arrivalLive || 0;
}

function renderChain(data) {
  currentChainData = data;

  const legMetadata = {};
  if (data.legInfos) {
    Object.entries(data.legInfos).forEach(([key, value]) => {
      legMetadata[parseInt(key)] = value;
    });
  }

  const refEpoch = getSelectedEpoch() || Math.floor(Date.now() / 1000);
  const refTimeStr = fmtTime(refEpoch);

  const legs = [];
  let currentLeg = null;

  (data.stops || []).forEach((stop, i) => {
    const lIdx = stop.legIndex ?? 0;
    if (!currentLeg || currentLeg.legIndex !== lIdx) {
      const meta = legMetadata[lIdx] || {};
      currentLeg = {
        legIndex: lIdx,
        meta: meta,
        stops: []
      };
      legs.push(currentLeg);
    }
    currentLeg.stops.push({ stop, originalIndex: i });
  });

  const totalStops = data.stops ? data.stops.length : 0;
  const pastStopsCount = (data.stops || []).filter(s => {
    const t = getStopTime(s);
    return t > 0 && t < refEpoch;
  }).length;

  const ignoreTimeFilter = totalStops > 0 && pastStopsCount === totalStops;

  // Count future legs (not fully past) for collapsing logic
  const futureLegs = [];
  legs.forEach((leg) => {
    const legPastStops = leg.stops.filter(s => {
      if (ignoreTimeFilter) return false;
      const t = getStopTime(s.stop);
      return t > 0 && t < refEpoch;
    });
    const isLegFullyPast = !ignoreTimeFilter && legPastStops.length === leg.stops.length;
    if (!isLegFullyPast) {
      futureLegs.push({ leg, isCollapsed: futureLegs.length >= 2 });
    }
  });

  let legsHtml = '';
  let futureLegToggleInserted = false;
  let futureLegContainerHtml = '';

  legs.forEach((leg, legIdx) => {
    const legPastStops = leg.stops.filter(s => {
      if (ignoreTimeFilter) return false;
      const t = getStopTime(s.stop);
      return t > 0 && t < refEpoch;
    });

    const isLegFullyPast = !ignoreTimeFilter && legPastStops.length === leg.stops.length;
    
    // Find current leg in futureLegs to check if it should be collapsed
    const futureLegInfo = futureLegs.find(fl => fl.leg === leg);
    const shouldCollapseFutureLeg = futureLegInfo && futureLegInfo.isCollapsed;
    
    const lineStr = leg.meta.line ? escapeHtml(leg.meta.line) : (data.line ? escapeHtml(data.line) : '?');
    const destStr = leg.meta.destination ? escapeHtml(getDestinationName(leg.meta.destination)) : (data.destination ? escapeHtml(getDestinationName(data.destination)) : '');
    const legLabel = `Linie ${lineStr}${destStr ? ' → ' + destStr : ''}`;

    let legContentHtml = '';
    let pastStopsToggleInserted = false;

    leg.stops.forEach(({ stop, originalIndex: i }, stopInLegIdx) => {
      const isLast = (i === totalStops - 1);
      const isFirst = (i === 0);
      const t = getStopTime(stop);
      
      const isPast = !ignoreTimeFilter && !isLegFullyPast && t > 0 && t < refEpoch;

      const arrDisp = stop.arrivalSched   ? fmtTime(stop.arrivalSched)   : null;
      const depDisp = stop.departureSched ? fmtTime(stop.departureSched) : null;
      
      const arrDelayHtml = stop.cancelled
        ? '<span class="cancelled">Ausfall</span>'
        : (stop.arrivalDelaySec !== null && stop.arrivalDelaySec !== undefined
            ? (Math.floor(stop.arrivalDelaySec / 60) < 0
                ? `<span class="vbz-delay">${fmtDelay(stop.arrivalDelaySec)}</span>`
                : Math.abs(stop.arrivalDelaySec) > 30
                  ? `<span class="delay">${fmtDelay(stop.arrivalDelaySec)}</span>`
                  : '')
            : '');
      
      const depDelayHtml = stop.cancelled
        ? '<span class="cancelled">Ausfall</span>'
        : (stop.departureDelaySec !== null && stop.departureDelaySec !== undefined
            ? (Math.floor(stop.departureDelaySec / 60) < 0
                ? `<span class="vbz-delay">${fmtDelay(stop.departureDelaySec)}</span>`
                : Math.abs(stop.departureDelaySec) > 30
                  ? `<span class="delay">${fmtDelay(stop.departureDelaySec)}</span>`
                  : '')
            : '');
      
      let platHtml = stop.track ? `Gl. ${escapeHtml(stop.track)}` : '';
     
      let boardingBadge = '';
      const noPickup  = stop.pickupType === 'NOT_ALLOWED' || stop.pickupType === 'MUST_PHONE' || stop.pickupType === 'COORDINATE_WITH_DRIVER';
      const noDropoff = stop.dropoffType === 'NOT_ALLOWED' || stop.dropoffType === 'MUST_PHONE' || stop.dropoffType === 'COORDINATE_WITH_DRIVER';
     
      if (noPickup && !noDropoff) {
        boardingBadge = '<span class="boarding-badge badge-sd" title="Halt nur zum Aussteigen">SD</span>';
      } else if (noDropoff && !noPickup) {
        boardingBadge = '<span class="boarding-badge badge-sm" title="Halt nur zum Einsteigen">SM</span>';
      }
      
      const stopNameStyle = stop.cancelled ? 'text-decoration: line-through; color: #555;' : '';
      const dotStyle = stop.cancelled ? ' style="background:#555;"' : '';
      
      const stopAbbrevs = getAbbrevsForName(stop.name);
      const stopAbbrevBadge = stopAbbrevs.length > 0
        ? ` <span class="abbrev-label">${escapeHtml(stopAbbrevs[0].abbrev)}</span>`
        : '';

      const refEpochStop = stop.arrivalSched || stop.arrivalLive || stop.departureSched || stop.departureLive;
      const isClickable = !!stop.stopId;
      
      const calendarOptions = stop.stopId && (!calendarStart || !calendarDest)
        ? `<details class="chain-actions">
            <summary class="cal-menu-toggle" onclick="event.stopPropagation()" title="Kalenderaktion auswählen">📅</summary>
            <div class="cal-menu" onclick="event.stopPropagation()">
              ${!calendarStart ? `<button type="button" onclick="selectCalendarRole(event, 'start', '${escapeAttr(stop.stopId)}', '${escapeAttr(stop.name)}', ${refEpochStop}, '${escapeAttr(stop.track || '')}', ${i})">Start</button>` : ''}
              ${!calendarDest && !isFirst ? `<button type="button" onclick="selectCalendarRole(event, 'via', '${escapeAttr(stop.stopId)}', '${escapeAttr(stop.name)}', ${refEpochStop}, '${escapeAttr(stop.track || '')}', ${i})">Via</button>` : ''}
              ${!calendarDest ? `<button type="button" onclick="selectCalendarRole(event, 'dest', '${escapeAttr(stop.stopId)}', '${escapeAttr(stop.name)}', ${refEpochStop}, '${escapeAttr(stop.track || '')}', ${i})">Ende</button>` : ''}
            </div>
          </details>`
        : '';
      
      const clickAttrs = isClickable
        ? `onclick="selectStation('${escapeAttr(stop.stopId)}','${escapeAttr(stop.name)}',${refEpochStop || 'null'})"`
        : '';
      
      let legSeparatorHtml = '';
      if (stopInLegIdx === 0 && legIdx > 0) {
        const nextLegMeta = leg.meta || {};
        const lStr = nextLegMeta.line ? escapeHtml(nextLegMeta.line) : '?';
        const tStr = nextLegMeta.tripNumber ? ` (${escapeHtml(nextLegMeta.tripNumber)})` : '';
        const dStr = nextLegMeta.destination ? ` nach <strong>${escapeHtml(getDestinationName(nextLegMeta.destination))}</strong>` : '';
        legSeparatorHtml = `
          <div class="chain-leg-separator">
            <div class="separator-text">
              ↓ Weiter als Linie ${lStr}${tStr}${dStr}
            </div>
          </div>
        `;
      }

      if (!isLegFullyPast && !isPast && !pastStopsToggleInserted && legPastStops.length > 0) {
        const count = legPastStops.length;
        const stopWord = count === 1 ? 'früheren Halt' : 'frühere Halte';
        const labelText = `+ ${count} ${stopWord} (vor ${refTimeStr}) anzeigen`;
        
        legContentHtml += `
          <div class="chain-stops-toggle-wrap">
            <button type="button" class="btn-toggle-past" data-label-show="${escapeHtml(labelText)}" onclick="event.stopPropagation(); togglePastStopsInLeg(this)">
              ${escapeHtml(labelText)}
            </button>
          </div>
        `;
        pastStopsToggleInserted = true;
      }

      const pastClass = isPast ? ' chain-past-stop' : '';
      const hideStyle = isPast ? ' style="display:none;"' : '';

      legContentHtml += legSeparatorHtml + `
        <div class="chain-stop${pastClass}${stop.cancelled ? ' chain-cancelled' : ''}${isClickable ? ' chain-clickable' : ''}"${hideStyle} ${clickAttrs}>
          <div class="chain-dot-col">
            <div class="chain-dot-wrapper">
              <div class="chain-dot${isFirst ? ' dot-first' : ''}"${dotStyle}></div>
            </div>
            ${!isLast ? `
              <div class="chain-line-wrapper">
                <div class="chain-line"${stop.cancelled ? ' style="background:rgba(255,255,255,0.05);"' : ''}></div>
              </div>
            ` : ''}
          </div>
          
          <div class="chain-times">
            ${arrDisp ? `<div class="time-row"><span class="label">An</span> <span class="time-val">${escapeHtml(arrDisp)}</span>${arrDelayHtml}</div>` : '<div class="time-row">&nbsp;</div>'}
            ${depDisp ? `<div class="time-row"><span class="label">Ab</span> <span class="time-val">${escapeHtml(depDisp)}</span>${depDelayHtml}</div>` : '<div class="time-row">&nbsp;</div>'}
          </div>
          
          <div class="chain-info">
            <div class="chain-name" style="${stopNameStyle}">${escapeHtml(stop.name)}${stopAbbrevBadge}${boardingBadge}</div>
            ${platHtml ? `<div class="chain-platform">${escapeHtml(platHtml)}</div>` : ''}
          </div>
          
          ${calendarOptions}
        </div>
      `;
    });

    if (isLegFullyPast) {
      const legToggleHtml = `
        <div class="chain-leg-toggle-wrap">
          <button type="button" class="btn-toggle-past-leg" data-label-show="+ Früheres Leg anzeigen (${escapeHtml(legLabel)})" onclick="event.stopPropagation(); togglePastLeg(this)">
            + Früheres Leg anzeigen (${escapeHtml(legLabel)})
          </button>
        </div>
      `;
      legsHtml += legToggleHtml + `<div class="chain-past-leg-body" style="display:none;">${legContentHtml}</div>`;
    } else if (shouldCollapseFutureLeg) {
      // Add future legs to container instead of showing directly
      if (!futureLegToggleInserted) {
        // Insert toggle button before the first future leg
        const remainingCount = futureLegs.length - 2;
        legsHtml += `
          <div class="chain-leg-toggle-wrap">
            <button type="button" class="btn-toggle-future-leg" data-label-show="+ ${remainingCount > 1 ? remainingCount + ' weitere Legs' : '1 weiteres Leg'} anzeigen" onclick="event.stopPropagation(); toggleFutureLeg(this)">
              + ${remainingCount > 1 ? remainingCount + ' weitere Legs' : '1 weiteres Leg'} anzeigen
            </button>
          </div>
          <div class="chain-future-leg-container" style="display:none;">
        `;
        futureLegToggleInserted = true;
      }
      futureLegContainerHtml += `<div class="chain-leg-body">${legContentHtml}</div>`;
    } else {
      legsHtml += `<div class="chain-leg-body">${legContentHtml}</div>`;
    }
  });

  // Close the future legs container if it was opened
  if (futureLegToggleInserted) {
    legsHtml += futureLegContainerHtml + '</div>';
  }

  const chainDestName = getDestinationName(data.destination);
  const tripIdHtml = data.tripId ? `<div class="trip-id-row">Trip-ID: <code title="${escapeHtml(data.tripId)}" onclick="navigator.clipboard.writeText('${data.tripId.replace(/'/g, "\\'")}'); this.innerText='✅ Kopiert!'; setTimeout(() => this.innerText='${escapeHtml(data.tripId).replace(/'/g, "\\'")}', 1500);">${escapeHtml(data.tripId)}</code></div>` : '';
  const BetreiberHTML = (data.agency && (data.agency.name || data.agency.id))
    ? `<div class="agency-row">
        <span class="agency-label">Betreiber:</span>
        <span class="agency-content">
          ${
            data.agency.url 
              ? `<a href="${escapeHtml(data.agency.url)}" target="_blank" rel="noopener noreferrer" class="agency-name">${escapeHtml(data.agency.name || 'Unbekannt')}</a>`
              : `<span class="agency-name">${escapeHtml(data.agency.name || 'Unbekannt')}</span>`
          }
          ${
            data.agency.id 
              ? `<code class="agency-id" title="${escapeHtml(data.agency.id)}">${escapeHtml(data.agency.id)}</code>` 
              : ''
          }
        </span>
      </div>`
    : '';

  return `
    <div class="chain-header">
      <b>Linie ${escapeHtml(data.line || '?')}${chainDestName ? ' → ' + escapeHtml(chainDestName) : ''}</b>${data.tripNumber ? ' · ' + escapeHtml(String(data.tripNumber).replace(/^0+/, '')) : ''}
    </div>
    <div class="chain">
      ${legsHtml}
    </div>
    ${tripIdHtml}
    ${BetreiberHTML}
  `;
}

function togglePastLeg(btn) {
  const legToggleWrap = btn.parentElement;
  const legBody = legToggleWrap.nextElementSibling;
  if (!legBody) return;

  const isHidden = legBody.style.display === 'none';
  legBody.style.display = isHidden ? 'block' : 'none';
  btn.textContent = isHidden 
    ? '– Früheres Leg ausblenden' 
    : btn.getAttribute('data-label-show');
}

function toggleFutureLeg(btn) {
  const legToggleWrap = btn.parentElement;
  const legContainer = legToggleWrap.nextElementSibling;
  if (!legContainer) return;

  const isHidden = legContainer.style.display === 'none';
  legContainer.style.display = isHidden ? 'block' : 'none';
  btn.textContent = isHidden 
    ? '– Weitere Legs ausblenden' 
    : btn.getAttribute('data-label-show');
}

function togglePastStopsInLeg(btn) {
  const legBody = btn.closest('.chain-leg-body');
  if (!legBody) return;

  const pastStops = legBody.querySelectorAll('.chain-past-stop');
  if (pastStops.length === 0) return;

  const isHidden = pastStops[0].style.display === 'none';
  pastStops.forEach(el => {
    el.style.display = isHidden ? 'flex' : 'none';
  });

  btn.textContent = isHidden 
    ? '– Frühere Halte ausblenden' 
    : btn.getAttribute('data-label-show');
}

function togglePastStops(btn) {
  const chainWrap = btn.closest('.chain-wrap');
  if (!chainWrap) return;

  const pastStops = chainWrap.querySelectorAll('.chain-past-stop');
  const pastSeparators = chainWrap.querySelectorAll('.chain-leg-separator');
  if (pastStops.length === 0) return;

  const isHidden = pastStops[0].style.display === 'none';

  pastStops.forEach(el => {
    el.style.display = isHidden ? 'flex' : 'none';
  });

  pastSeparators.forEach(el => {
    if (el.nextElementSibling && el.nextElementSibling.classList.contains('chain-past-stop')) {
      el.style.display = isHidden ? 'block' : 'none';
    }
  });

  btn.textContent = isHidden 
    ? 'Frühere Halte ausblenden' 
    : `Gesamte Fahrt anzeigen (${pastStops.length} frühere Halte)`;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function getDestinationName(dest) {
  if (!dest) return '';
  if (typeof dest === 'object') return dest.name || '';
  return String(dest);
}

function fmtTime(epoch) {
  if (!epoch) return '–';
  return new Date(epoch * 1000).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit'});
}

function fmtDelay(sec) {
  const sign = sec < 0 ? '-' : '+';
  const abs  = Math.abs(sec);
  const m = Math.floor(abs / 60);
  return `${sign}${m}`;
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

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

// ─── JETZT Button ───────────────────────────────────────────────────────────

function setCurrentTime() {
  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  
  if (datePicker && timePicker) {
    datePicker.value = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`;
    timePicker.value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  }
  
  triggerTimeChange();
}

// ─── GO Button ──────────────────────────────────────────────────────────────

function reloadDepartures() {
  const currentEpoch = getSelectedEpoch();
  if (!currentStopId) return;
  loadDepartures(currentEpoch);
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