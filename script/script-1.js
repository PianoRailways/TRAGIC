const PROXY = 'proxy.php';
let currentStopId = null;
let currentStationName = null;
let currentMainStationId = null;
let refreshTimer = null;
let allDepartures = [];
let abbrevMap = {};
let nameToAbbrevMap = {};

const DEFAULT_FAVORITES = [
  { stopId: 'ch-opentransportdataswiss26_Parentch:1:sloid:8100', label: 'Langenthal', name: 'Langenthal' },
  { stopId: 'ch-opentransportdataswiss26_Parentch:1:sloid:5000', label: 'Luzern', name: 'Luzern' },
  { stopId: 'de-DELFI_ch:23005:6', label: 'Basel Badischer Bhf', name: 'Basel Badischer Bhf' },
  { stopId: 'fr-agregat-des-reseaux-urbains-et-interurbains-en-region-grand-est_SNCF:OCETrainTER87182063', label: 'Mulhouse-Ville', name: 'Mulhouse-Ville' },
  { stopId: 'ch-opentransportdataswiss26_Parent8721202', label: 'Strasbourg', name: 'Strasbourg' },
  { stopId: 'ch-opentransportdataswiss26_Parentch:1:sloid:10', label: 'Basel SBB', name: 'Basel SBB' },
  { stopId: 'ch-opentransportdataswiss26_Parentch:1:sloid:3000', label: 'Zürich HB', name: 'Zürich HB' },
  { stopId: 'ch-opentransportdataswiss26_Parentch:1:sloid:7000', label: 'Bern', name: 'Bern' },
  { stopId: 'pl-PKP-Intercity_1008_parent', label: 'Świnoujście', name: 'Świnoujście' },
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
      return [];
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
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
    return [];
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

// ─── Ende Calendar Tracking ──────────────────────────────────────────────────

const datePicker = document.getElementById('datePicker');
const timePicker = document.getElementById('timePicker');
const destFilter = document.getElementById('destFilter');

// ─── Combined Stations laden (mehrere Quellen) ──────────────────────────────

async function loadCombinedStations() {
  const urls = [
    'https://nowe.stellwerksim.ch/combinedstations.js',
    'https://tragic.stellwerksim.ch/script/combinedTRAGIC.js',
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

// ─── Geolocation & Nearby Stations ──────────────────────────────

let geolocationSupported = 'geolocation' in navigator;

function toggleNearbyView() {
  const nearbyView = document.getElementById('nearby-view');
  if (!nearbyView) return;
  
  if (nearbyView.style.display === 'flex') {
    closeNearbyView();
    return;
  }
  
  const btn = document.getElementById('btn-nearby');
  if (!btn) return;
  
  btn.disabled = true;
  btn.textContent = '📍 Lade…';
  
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      fetchNearbyStations(latitude, longitude);
      btn.disabled = false;
      btn.textContent = '📍';
    },
    (error) => {
      console.warn('Geolocation error:', error);
      btn.disabled = false;
      btn.textContent = '📍';
      alert(`Geolocation-Fehler: ${error.message}`);
    },
    { timeout: 8000, maximumAge: 60000 }
  );
}

async function fetchNearbyStations(lat, lon) {
  try {
    const res = await fetch(`${PROXY}?action=reverse-geocode&lat=${lat}&lon=${lon}&radius=300`);
    const data = await res.json();
    
    if (data.error) {
      alert(`Fehler: ${data.error}`);
      return;
    }
    
    const stations = data.stations || [];
    if (stations.length === 0) {
      alert('Keine Stationen in der Nähe gefunden.');
      return;
    }
    
    renderNearbyView(stations);
  } catch (err) {
    console.error('Error fetching nearby stations:', err);
    alert('Fehler beim Laden der Stationen: ' + err.message);
  }
}

function renderNearbyView(stations) {
  const nearbyView = document.getElementById('nearby-view');
  const nearbyList = document.getElementById('nearby-list');
  
  if (!nearbyView || !nearbyList) return;
  
  nearbyList.innerHTML = '';
  
  stations.forEach(station => {
    const li = document.createElement('li');
    
    const itemContainer = document.createElement('div');
    itemContainer.style.display = 'flex';
    itemContainer.style.flex = '1';
    itemContainer.style.flexDirection = 'column';
    itemContainer.style.gap = '4px';
    
    const link = document.createElement('a');
    link.className = 'stations-item';
    link.href = 'javascript:void(0);';
    link.textContent = station.name;
    link.style.flex = '1';
    
    link.addEventListener('click', (e) => {
      e.preventDefault();
      selectStation(station.id, station.name, null);
      closeNearbyView();
    });
    
    const distanceLabel = document.createElement('div');
    distanceLabel.style.fontSize = '0.85em';
    distanceLabel.style.color = '#888';
    const distance = station.distance ? Math.round(station.distance) : '?';
    distanceLabel.textContent = `${distance}m entfernt`;
    
    itemContainer.appendChild(link);
    itemContainer.appendChild(distanceLabel);
    li.appendChild(itemContainer);
    nearbyList.appendChild(li);
  });
  
  nearbyView.style.display = 'flex';
}

function closeNearbyView() {
  const nearbyView = document.getElementById('nearby-view');
  if (nearbyView) {
    nearbyView.style.display = 'none';
  }
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

// ─── Favorites-View (Benutzerdefinierte Favoriten) ────────────────────

function renderFavoritesView() {
  const favoritesView = document.getElementById('favorites-view');
  const favoritesList = document.getElementById('favorites-list');
  
  if (!favoritesView || !favoritesList) return;
  
  favoritesList.innerHTML = '';
  
  favoriteStations.forEach(favorite => {
    const li = document.createElement('li');
    
    const itemContainer = document.createElement('div');
    itemContainer.style.display = 'flex';
    itemContainer.style.flex = '1';
    itemContainer.style.alignItems = 'center';
    itemContainer.style.justifyContent = 'space-between';
    
    const link = document.createElement('a');
    link.className = 'stations-item';
    link.textContent = favorite.name;
    link.href = 'javascript:void(0);';
    link.style.flex = '1';
    
    link.addEventListener('click', (e) => {
      e.preventDefault();
      selectStation(favorite.stopId, favorite.name, null);
      closeFavoritesView();
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'fav-remove-btn';
    deleteBtn.title = `Favorit ${favorite.name} löschen`;
    deleteBtn.textContent = '×';
    deleteBtn.style.marginRight = '10px';
    deleteBtn.dataset.stopId = favorite.stopId;
    deleteBtn.dataset.confirmPending = 'false';
    
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      const isConfirmPending = deleteBtn.dataset.confirmPending === 'true';
      
      if (!isConfirmPending) {
        // Erster Klick: In Bestätigungs-State wechseln
        deleteBtn.dataset.confirmPending = 'true';
        deleteBtn.textContent = '✓ Löschen?';
        deleteBtn.classList.add('fav-remove-btn-confirm');
        
        // Nach 3 Sekunden zurücksetzen wenn nicht bestätigt
        setTimeout(() => {
          if (deleteBtn.dataset.confirmPending === 'true') {
            deleteBtn.dataset.confirmPending = 'false';
            deleteBtn.textContent = '×';
            deleteBtn.classList.remove('fav-remove-btn-confirm');
          }
        }, 3000);
      } else {
        // Zweiter Klick: Wirklich löschen
        favoriteStations = favoriteStations.filter(entry => entry.stopId !== favorite.stopId);
        saveFavoritesToStorage();
        renderFavoritesView();
        renderFavoritesBar();
      }
    });
    
    itemContainer.appendChild(link);
    itemContainer.appendChild(deleteBtn);
    li.appendChild(itemContainer);
    favoritesList.appendChild(li);
  });
  
  favoritesView.style.display = 'flex';
}

function closeFavoritesView() {
  const favoritesView = document.getElementById('favorites-view');
  if (favoritesView) {
    favoritesView.style.display = 'none';
  }
}

// ─── Home-View ────────────────────────────────────────────

function renderHomeView() {
  const homeView = document.getElementById('home-view');
  if (homeView) {
    homeView.style.display = 'flex';
  }

  const url = new URL(location.href);
  if (url.searchParams.get('view') === 'home') {
    url.searchParams.delete('view');
    history.replaceState({}, '', url);
  }
}

function closeHomeView() {
  const homeView = document.getElementById('home-view');
  if (homeView) {
    homeView.style.display = 'none';
  }
}

function checkAndRenderView() {
  const viewParam = params.get('view');
  
  if (viewParam === 'home') {
    renderHomeView();
  } else if (viewParam === 'stations') {
    closeHomeView();
    renderStationsView();
  } else if (viewParam === 'favorites') {
    closeHomeView();
    renderFavoritesView();
  }
  // Für alle anderen Views (departures, arrivals, settings, oder keine View) nichts machen
  // Die default Panel wird sowieso angezeigt
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

  // Favorites-View Event-Listener
  const btnCloseFavorites = document.getElementById('btn-close-favorites');
  if (btnCloseFavorites) {
    btnCloseFavorites.addEventListener('click', closeFavoritesView);
  }

  // Nearby-View Event-Listener
  const btnNearby = document.getElementById('btn-nearby');
  if (btnNearby) {
    if (!geolocationSupported) {
      btnNearby.disabled = true;
      btnNearby.title = 'Geolocation wird von diesem Browser nicht unterstützt';
    } else {
      btnNearby.addEventListener('click', toggleNearbyView);
    }
  }

  const btnCloseNearby = document.getElementById('btn-close-nearby');
  if (btnCloseNearby) {
    btnCloseNearby.addEventListener('click', closeNearbyView);
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

  updateFilterMenuIndicator();
}

function updateFilterMenuIndicator() {
  const btn = document.getElementById('filter-menu-button');
  if (!btn) return;

  const destQuery = destFilter ? destFilter.value.trim() : '';
  const hasActiveModeFilter = !filterState.alleModeActive || filterState.selectedModes.size > 0;
  const isActive = Boolean(destQuery) || hasActiveModeFilter;

  btn.classList.toggle('has-active-filters', isActive);
  btn.title = isActive ? 'Filter aktiv – klicken zum Öffnen' : 'Filter öffnen';
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
  destFilter.addEventListener('input', () => {
    applyFilters();
    updateFilterMenuIndicator();
  });
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
    const visibleLine = (tr.querySelector('.line')?.textContent || '').toLowerCase();
    const routeId = (tr.dataset.routeId || '').toLowerCase();

    const modeHide = !filterState.alleModeActive && !filterState.selectedModes.has(mode);
    
    const destHide = destQuery && 
      !dest.includes(destQuery) && 
      !line.includes(destQuery) && 
      !visibleLine.includes(destQuery) &&
      !routeId.includes(destQuery) &&
      !trip.includes(destQuery) && 
      !agencyId.includes(destQuery) && 
      !agencyName.includes(destQuery) && 
      !tripId.includes(destQuery) &&
      !vias.includes(destQuery);

    tr.classList.toggle('filtered-mode', modeHide);
    tr.classList.toggle('filtered-dest', destHide);
  });

  updateFilterMenuIndicator();
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