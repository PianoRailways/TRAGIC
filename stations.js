function loadCombinedStations() {
  var urls = [
    'https://nowe.stellwerksim.ch/combinedstations.js',
    'https://tragic.stellwerksim.ch/combinedTRAGIC.js'
  ];

  var tempMerged = {};
  var loadedCount = 0;

  for (var i = 0; i < urls.length; i++) {
    (function (url) {
      return new Promise(function (resolve) {
        var script = document.createElement('script');
        script.src = url;
        script.onload = function () {
          console.log('combinedStations loaded from ' + url);

          if (window.combinedStations && typeof window.combinedStations === 'object') {
            Object.assign(tempMerged, window.combinedStations);
            loadedCount++;
          }

          resolve();
        };
        script.onerror = function () {
          console.warn('Failed to load combinedStations from ' + url);
          resolve();
        };
        document.head.appendChild(script);
      });
    })(urls[i]);
  }

  var prom = Promise.all(urls.map(function (url) {
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = url;
      script.onload = function () {
        console.log('combinedStations loaded from ' + url);
        if (window.combinedStations && typeof window.combinedStations === 'object') {
          Object.assign(tempMerged, window.combinedStations);
          loadedCount++;
        }
        resolve();
      };
      script.onerror = function () {
        console.warn('Failed to load combinedStations from ' + url);
        resolve();
      };
      document.head.appendChild(script);
    });
  }));

  prom.then(function () {
    window.combinedStations = tempMerged;
    window.combinedStationsReady = loadedCount > 0;
    console.log('Loaded combinedStations from ' + loadedCount + '/' + urls.length + ' sources, total entries: ' + Object.keys(window.combinedStations).length);
  });
}

function getRelatedStations(stationName) {
  if (!window.combinedStations || !window.combinedStations[stationName]) {
    return [stationName];
  }
  return window.combinedStations[stationName];
}

async function resolveStationNameToId(stationName) {
  try {
    var res = await fetch(PROXY + '?action=search&query=' + encodeURIComponent(stationName));
    var data = await res.json();
    var stations = data.stations || [];

    var match = stations.find(function (s) { return s.name.toLowerCase() === stationName.toLowerCase(); }) || stations[0];
    return match ? match.id : null;
  } catch (err) {
    console.error('Error resolving station "' + stationName + '":', err);
    return null;
  }
}

async function fetchCombinedDepartures(stopId, stationName, refEpoch, numResults) {
  if (numResults === undefined) numResults = 25;
  var relatedStationNames = getRelatedStations(stationName);

  console.log('Fetching data for ' + relatedStationNames.length + ' station(s):', relatedStationNames);

  var allDeps = [];

  for (var i = 0; i < relatedStationNames.length; i++) {
    var station = relatedStationNames[i];
    try {
      var stationStopId = await resolveStationNameToId(station);

      if (!stationStopId) {
        console.warn('Could not resolve stopId for station: ' + station);
        continue;
      }

      var q = PROXY + '?action=departures&stopId=' + encodeURIComponent(stationStopId) + '&n=' + numResults;
      if (isArrivalsMode) q += '&arrivals=true';
      if (refEpoch) {
        q += '&time=' + encodeURIComponent(new Date(refEpoch * 1000).toISOString());
      }

      var res = await fetch(q);
      var data = await res.json();

      if (data.error) {
        console.warn('Failed to fetch data for ' + station + ':', data.error);
        continue;
      }

      if (data.departures && Array.isArray(data.departures)) {
        var departuresWithStation = data.departures.map(function (dep) {
          return Object.assign({}, dep, {
            _fromStation: station,
            _isMainStation: station === stationName
          });
        });
        allDeps.push.apply(allDeps, departuresWithStation);
      }
    } catch (err) {
      console.error('Error fetching data for ' + station + ':', err);
    }
  }

  allDeps.sort(function (a, b) {
    var timeA = a.scheduled || Infinity;
    var timeB = b.scheduled || Infinity;
    return timeA - timeB;
  });

  return allDeps.slice(0, numResults);
}

function updateStationTitle(name) {
  currentStationName = name;
  var el = document.getElementById('stationTitle');
  if (el) el.textContent = name;
  document.title = name + ' | OMNI (NOWE)';
  renderFavoritesBar();
}

function selectStation(stopId, name, refEpoch) {
  if (stopId === null) {
    selectStationByName(name, refEpoch);
    return;
  }

  currentStopId = stopId;
  currentStationName = name;
  currentMainStationId = stopId;
  updateStationTitle(name);

  var list = document.getElementById('suggestions');
  if (list) list.innerHTML = '';
  if (queryInput) queryInput.value = '';

  if (refEpoch) {
    setPickersFromEpoch(refEpoch);
  }

  var currentEpoch = getSelectedEpoch();

  var url = new URL(location.href);
  url.searchParams.set('stopId', stopId);

  if (currentEpoch) url.searchParams.set('time', currentEpoch);
  else url.searchParams.delete('time');

  if (isArrivalsMode) url.searchParams.set('arrivals', 'true');
  else url.searchParams.delete('arrivals');

  history.pushState({ stopId: stopId, stationName: name, epoch: currentEpoch, arrivals: isArrivalsMode, calendarStart: calendarStart, calendarVias: calendarVias, calendarDest: calendarDest }, '', url);

  loadDepartures(currentEpoch);
  window.scrollTo({ top: 250, behavior: 'smooth' });
}

async function selectStationByName(name, refEpoch) {
  try {
    var res = await fetch(PROXY + '?action=search&query=' + encodeURIComponent(name));
    var data = await res.json();
    var stations = data.stations || [];

    if (stations.length === 0) {
      alert('Station "' + name + '" nicht gefunden.');
      return;
    }

    var match = stations.find(function (s) { return s.name.toLowerCase() === name.toLowerCase(); }) || stations[0];
    selectStation(match.id, match.name, refEpoch);
  } catch (err) {
    alert('Fehler bei der Stationssuche: ' + err.message);
  }
}

window.loadCombinedStations = loadCombinedStations;
window.getRelatedStations = getRelatedStations;
window.resolveStationNameToId = resolveStationNameToId;
window.fetchCombinedDepartures = fetchCombinedDepartures;
window.updateStationTitle = updateStationTitle;
window.selectStation = selectStation;
window.selectStationByName = selectStationByName;
