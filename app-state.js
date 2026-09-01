var PROXY = 'proxy.php';
var currentStopId = null;
var currentStationName = null;
var currentMainStationId = null;
var refreshTimer = null;
var allDepartures = [];
var abbrevMap = {};
var nameToAbbrevMap = {};
var favoriteStations = [];
var params = new URLSearchParams(location.search);
var isArrivalsMode = params.get('arrivals') === 'true';

var DEFAULT_FAVORITES = [
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
var FAVORITES_STORAGE_KEY = 'tragic_favorites';
var VIA_LOADING_STORAGE_KEY = 'tragic_via_loading_enabled';

var MODE_GROUPS = {
  HIGHSPEED: ['HIGHSPEEDRAIL', 'HIGHSPEED_RAIL', 'INTERCITYRAIL', 'LONGDISTANCERAIL', 'LONG_DISTANCE'],
  RAIL: ['TRAIN', 'RAIL', 'COACHRAILWAY', 'LOCALTRAIN', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN'],
  NIGHT: ['NIGHTRAIL', 'NIGHT_RAIL'],
  SUBWAY: ['SUBWAY', 'METRO', 'URBAN_RAIL'],
  TRAM: ['TRAM', 'TROLLEYBUS', 'STREETCAR'],
  BUS: ['BUS', 'COACH', 'REGIONALBUS', 'EXPRESBUS', 'DEBUG_BUS_ROUTE'],
  FERRY: ['FERRY', 'WATER', 'BOAT', 'DEBUG_FERRY_ROUTE'],
  GONDOLA: ['GONDOLA', 'CHAIRLIFT', 'CABLEWAY', 'FUNICULAR', 'AERIAL_LIFT', 'AREAL_LIFT', 'CABLE_CAR'],
  OTHER: ['WALK', 'BIKE', 'RENTAL', 'CAR', 'CAR_PARKING', 'CAR_DROPOFF', 'ODM', 'RIDE_SHARING', 'FLEX', 'AIRPLANE', 'OTHER']
};

var MODE_META_GROUPS = {
  RAIL_ALL: ['HIGHSPEED', 'RAIL', 'SUBWAY', 'NIGHT'],
  URBAN: ['SUBWAY', 'TRAM', 'BUS'],
  TRANSIT: ['HIGHSPEED', 'RAIL', 'NIGHT', 'SUBWAY', 'TRAM', 'BUS', 'FERRY', 'GONDOLA']
};

function cloneDefaultFavorites() {
  return DEFAULT_FAVORITES.map(function (favorite) {
    return Object.assign({}, favorite);
  });
}

function normalizeFavoriteName(favorite) {
  return String(favorite && (favorite.name || favorite.stationName || favorite.label) || '').trim();
}

function getFavoriteLabelForName(stationName) {
  var normalizedName = String(stationName || '').trim();
  if (!normalizedName) return '';

  var abbrevs = getAbbrevsForName(normalizedName);
  if (abbrevs.length > 0 && abbrevs[0].abbrev) {
    return abbrevs[0].abbrev;
  }

  return normalizedName;
}

function loadFavoritesFromStorage() {
  try {
    var stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!stored) {
      return cloneDefaultFavorites();
    }

    var parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return cloneDefaultFavorites();
    }

    var seenStopIds = new Set();
    return parsed
      .map(function (entry) {
        var rawStopId = String(entry && entry.stopId || '').trim();
        var stopId = rawStopId;
        try {
          stopId = decodeURIComponent(rawStopId);
        } catch (_) {}
        var name = normalizeFavoriteName(entry);
        var label = String(entry && entry.label || '').trim();

        return {
          stopId: stopId,
          name: name,
          label: label || ''
        };
      })
      .filter(function (entry) {
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

favoriteStations = loadFavoritesFromStorage();

function saveFavoritesToStorage() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteStations));
  } catch (_) {}
}

function getFavoriteLabel(favorite) {
  return favorite.label || getFavoriteLabelForName(favorite.name);
}

function isFavoriteStation(stopId) {
  return favoriteStations.some(function (favorite) {
    return favorite.stopId === stopId;
  });
}

function formatStationWithTrack(stationName, track) {
  if (!stationName) return '';

  var cleanTrack = track ? String(track).replace(/^(Gl\.|Gleis|Pl\.|Plattform)\s*/i, '').trim() : '';
  var abbrevs = getAbbrevsForName(stationName);
  var hasAbbrev = abbrevs && abbrevs.length > 0;
  var baseName = hasAbbrev ? abbrevs[0].abbrev : stationName.trim();

  if (!cleanTrack) {
    return baseName;
  }

  return hasAbbrev ? baseName + '-' + cleanTrack : baseName + ' ' + cleanTrack;
}

function setStatus(msg) {
  var el = document.getElementById('status');
  if (el) el.textContent = msg;
}

function getModeIcon(mode) {
  if (!mode) return '';
  var m = mode.toUpperCase();
  if (m === 'TRAM') return 'T';
  if (m === 'BUS') return 'B';
  return '';
}

function getDestinationName(dest) {
  if (!dest) return '';
  if (typeof dest === 'object') return dest.name || '';
  return String(dest);
}

function fmtTime(epoch) {
  if (!epoch) return '–';
  return new Date(epoch * 1000).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

function fmtDelay(sec) {
  var sign = sec < 0 ? '-' : '+';
  var abs = Math.abs(sec);
  var m = Math.floor(abs / 60);
  return sign + m;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[\\'"]/g, function (c) {
    return '\\' + c;
  });
}

function debounce(fn, delay) {
  var t;
  return function () {
    var args = arguments;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(null, args); }, delay);
  };
}

function normalizeLineDisplay(line) {
  if (!line) return '';
  var upper = line.toUpperCase();

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

function formatTripNumber(tripNumber, line) {
  if (!tripNumber || tripNumber === '0' || tripNumber === 0) {
    return extractTripNumberFromLine(line);
  }

  tripNumber = String(tripNumber).trim();

  if (tripNumber === '0' || /^0+$/.test(tripNumber)) {
    return extractTripNumberFromLine(line);
  }

  var match1 = tripNumber.match(/\s*-\s*(\d+)$/);
  if (match1) {
    return match1[1];
  }

  var match2 = tripNumber.match(/^[A-Za-z]+\s+(\d+)$/);
  if (match2) {
    return match2[1];
  }

  return tripNumber.replace(/^0+(?=\d)/, '');
}

function extractTripNumberFromLine(line) {
  if (!line) return '';

  line = line.trim();

  var match1 = line.match(/\s*-\s*(\d+)$/);
  if (match1) {
    return match1[1];
  }

  var match2 = line.match(/(?:^|\s)(\d+)$/);
  if (match2) {
    return match2[1];
  }

  return '';
}

function canonicalMode(rawMode) {
  if (!rawMode) return 'OTHER';
  var m = rawMode.toUpperCase();
  for (var group in MODE_GROUPS) {
    if (group === 'OTHER') continue;
    if (MODE_GROUPS[group].includes(m)) return group;
  }
  return 'OTHER';
}

function getAbbrevsForName(stationName) {
  if (!stationName) return [];
  var normName = stationName.trim().toLowerCase();
  return nameToAbbrevMap[normName] || [];
}

function updateClock() {
  var el = document.getElementById('live-clock');
  if (!el) return;
  var now = new Date();
  el.textContent =
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0');
}

function getSelectedEpoch() {
  if (!datePicker || !timePicker) return null;
  if (!datePicker.value || !timePicker.value) return null;
  var dt = new Date(datePicker.value + 'T' + timePicker.value);
  return isNaN(dt.getTime()) ? null : Math.floor(dt.getTime() / 1000);
}

function setPickersFromEpoch(epoch) {
  if (!datePicker || !timePicker) return;
  if (!epoch) {
    datePicker.value = '';
    timePicker.value = '';
    return;
  }

  var date = new Date(epoch * 1000);
  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  datePicker.value = date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  timePicker.value = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function syncPickersToUrl() {
  var refEpoch = getSelectedEpoch();
  var url = new URL(location.href);
  if (refEpoch) url.searchParams.set('time', refEpoch);
  else url.searchParams.delete('time');

  if (isArrivalsMode) url.searchParams.set('arrivals', 'true');
  else url.searchParams.delete('arrivals');

  history.pushState({ stopId: currentStopId, stationName: currentStationName, epoch: refEpoch, arrivals: isArrivalsMode, calendarStart: window.calendarStart, calendarVias: window.calendarVias, calendarDest: window.calendarDest }, '', url);
  return refEpoch;
}

function loadActiveModesFromStorage() {
  try {
    var stored = localStorage.getItem('tragic_mode_filter');
    if (stored) {
      var parsed = JSON.parse(stored);
      return {
        alleModeActive: parsed.alleModeActive ?? true,
        selectedModes: new Set(parsed.selectedModes || [])
      };
    }
  } catch (_) {}
  return { alleModeActive: true, selectedModes: new Set() };
}

var filterState = loadActiveModesFromStorage();

function loadViaLoadingFromStorage() {
  try {
    return localStorage.getItem(VIA_LOADING_STORAGE_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

var viaLoadingEnabled = loadViaLoadingFromStorage();

function saveViaLoadingToStorage() {
  try {
    localStorage.setItem(VIA_LOADING_STORAGE_KEY, viaLoadingEnabled ? 'true' : 'false');
  } catch (_) {}
}

function saveModesToStorage() {
  localStorage.setItem('tragic_mode_filter', JSON.stringify({
    alleModeActive: filterState.alleModeActive,
    selectedModes: Array.from(filterState.selectedModes)
  }));
}

async function loadAbbreviations() {
  var countries = ['custom', 'ch', 'de', 'at', 'fr', 'uk'];
  try {
    for (var i = 0; i < countries.length; i++) {
      var country = countries[i];
      try {
        var res = await fetch('/didok/' + country + '.json');
        if (res.ok) {
          var data = await res.json();
          Object.entries(data).forEach(function (_ref) {
            var abbrev = _ref[0], name = _ref[1];
            if (!abbrevMap[abbrev]) {
              abbrevMap[abbrev] = [];
            }
            var countryCode = country.toUpperCase();
            abbrevMap[abbrev].push({ name: name, country: countryCode });

            var normName = name.trim().toLowerCase();
            if (!nameToAbbrevMap[normName]) {
              nameToAbbrevMap[normName] = [];
            }
            nameToAbbrevMap[normName].push({ abbrev: abbrev, country: countryCode });
          });
        }
      } catch (e) {
        console.warn('Konnte /didok/' + country + '.json nicht laden:', e);
      }
    }
    console.log('Abkürzungs-Mappings geladen:', Object.keys(abbrevMap).length, 'Abkürzungen');
  } catch (err) {
    console.error('Fehler beim Laden der Abkürzungs-Mappings:', err);
  }
}

window.PROXY = PROXY;
window.DEFAULT_FAVORITES = DEFAULT_FAVORITES;
window.currentStopId = currentStopId;
window.currentStationName = currentStationName;
window.currentMainStationId = currentMainStationId;
window.refreshTimer = refreshTimer;
window.allDepartures = allDepartures;
window.abbrevMap = abbrevMap;
window.nameToAbbrevMap = nameToAbbrevMap;
window.favoriteStations = favoriteStations;
window.params = params;
window.isArrivalsMode = isArrivalsMode;
window.filterState = filterState;
window.viaLoadingEnabled = viaLoadingEnabled;

window.cloneDefaultFavorites = cloneDefaultFavorites;
window.normalizeFavoriteName = normalizeFavoriteName;
window.getFavoriteLabelForName = getFavoriteLabelForName;
window.loadFavoritesFromStorage = loadFavoritesFromStorage;
window.saveFavoritesToStorage = saveFavoritesToStorage;
window.getFavoriteLabel = getFavoriteLabel;
window.isFavoriteStation = isFavoriteStation;
window.formatStationWithTrack = formatStationWithTrack;
window.getAbbrevsForName = getAbbrevsForName;
window.loadAbbreviations = loadAbbreviations;
window.getDestinationName = getDestinationName;
window.normalizeLineDisplay = normalizeLineDisplay;
window.extractTripNumberFromLine = extractTripNumberFromLine;
window.formatTripNumber = formatTripNumber;
window.escapeHtml = escapeHtml;
window.escapeAttr = escapeAttr;
window.debounce = debounce;
window.fmtTime = fmtTime;
window.fmtDelay = fmtDelay;
window.setStatus = setStatus;
window.updateClock = updateClock;
window.getSelectedEpoch = getSelectedEpoch;
window.setPickersFromEpoch = setPickersFromEpoch;
window.syncPickersToUrl = syncPickersToUrl;
window.loadActiveModesFromStorage = loadActiveModesFromStorage;
window.saveModesToStorage = saveModesToStorage;
window.loadViaLoadingFromStorage = loadViaLoadingFromStorage;
window.saveViaLoadingToStorage = saveViaLoadingToStorage;

window.MODE_GROUPS = MODE_GROUPS;
window.MODE_META_GROUPS = MODE_META_GROUPS;
window.FAVORITES_STORAGE_KEY = FAVORITES_STORAGE_KEY;
window.VIA_LOADING_STORAGE_KEY = VIA_LOADING_STORAGE_KEY;
