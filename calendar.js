var calendarStart = null;
var calendarVias = [];
var calendarDest = null;
var calendarTrips = [];
var currentChainData = null;

function loadCalendarStateFromUrl() {
  var cstartRaw = params.get('cstart');
  var cviasRaw = params.get('cvias');
  var cdestRaw = params.get('cdest');

  if (cstartRaw) {
    try {
      var parts = cstartRaw.split('|');
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
      var viaParts = cviasRaw.split(';;');
      calendarVias = viaParts
        .map(function (v) {
          var p = v.split('|');
          return {
            stopId: p[0],
            name: decodeURIComponent(p[1]),
            epoch: parseInt(p[2]),
            track: p[3] ? decodeURIComponent(p[3]) : ''
          };
        })
        .filter(function (v) { return v.stopId && v.name; });
    } catch (_) {}
  }

  if (cdestRaw) {
    try {
      var parts2 = cdestRaw.split('|');
      calendarDest = {
        stopId: parts2[0],
        name: decodeURIComponent(parts2[1]),
        epoch: parseInt(parts2[2]),
        track: parts2[3] ? decodeURIComponent(parts2[3]) : ''
      };
    } catch (_) {}
  }
}

loadCalendarStateFromUrl();

function saveCalendarStateToUrl() {
  var url = new URL(location.href);

  if (calendarStart) {
    url.searchParams.set('cstart', calendarStart.stopId + '|' + encodeURIComponent(calendarStart.name) + '|' + calendarStart.epoch + '|' + encodeURIComponent(calendarStart.track || ''));
  } else {
    url.searchParams.delete('cstart');
  }

  if (calendarVias.length > 0) {
    var viasStr = calendarVias
      .map(function (v) { return v.stopId + '|' + encodeURIComponent(v.name) + '|' + v.epoch + '|' + encodeURIComponent(v.track || ''); })
      .join(';;');
    url.searchParams.set('cvias', viasStr);
  } else {
    url.searchParams.delete('cvias');
  }

  if (calendarDest) {
    url.searchParams.set('cdest', calendarDest.stopId + '|' + encodeURIComponent(calendarDest.name) + '|' + calendarDest.epoch + '|' + encodeURIComponent(calendarDest.track || ''));
  } else {
    url.searchParams.delete('cdest');
  }

  history.replaceState({
    stopId: currentStopId,
    stationName: currentStationName,
    epoch: getSelectedEpoch(),
    arrivals: isArrivalsMode,
    calendarStart: calendarStart,
    calendarVias: calendarVias,
    calendarDest: calendarDest,
    calendarTrips: calendarTrips
  }, '', url);
}

function setCalendarStart(stopId, name, epoch, track) {
  calendarStart = { stopId: stopId, name: name, epoch: epoch, track: track || '' };
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

  var menu = event.currentTarget.closest('details');
  if (menu) menu.open = false;
}

function recordSubtrip(endStopId, endName, endEpoch, endTrack, stopIndex) {
  var lastPoint = calendarVias.length > 0 ? calendarVias[calendarVias.length - 1] : calendarStart;

  if (!lastPoint) return;

  var startName = lastPoint.name;
  var startTrack = lastPoint.track || '';
  var startTimeEpoch = lastPoint.epoch;
  var matchedStartIdx = -1;
  var tripVias = [];

  if (currentChainData && currentChainData.stops) {
    var stops = currentChainData.stops;

    if (lastPoint.stopId) {
      matchedStartIdx = stops.findIndex(function (s) { return s.stopId === lastPoint.stopId; });
    }
    if (matchedStartIdx < 0 && lastPoint.name) {
      matchedStartIdx = stops.findIndex(function (s) { return s.name.toLowerCase() === lastPoint.name.toLowerCase(); });
    }

    if (matchedStartIdx >= 0 && typeof stopIndex === 'number' && matchedStartIdx < stopIndex) {
      var startObj = stops[matchedStartIdx];
      startName = startObj.name;
      startTrack = startObj.track || startTrack;
      startTimeEpoch = startObj.departureSched || startObj.departureLive || startObj.arrivalSched || startTimeEpoch;

      var seenViaNames = new Set();
      for (var idx = matchedStartIdx + 1; idx < stopIndex; idx++) {
        var viaName = String(stops[idx] && stops[idx].name || '').trim();
        var viaKey = viaName.toLowerCase();
        if (!viaName || seenViaNames.has(viaKey)) continue;
        seenViaNames.add(viaKey);
        tripVias.push(viaName);
      }
    }
  }

  var rawTripNum = currentChainData ? (currentChainData.tripNumber || currentChainData.line || '') : '';
  var cleanTripNum = String(rawTripNum).replace(/^0+(?=\d)/, '');

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
  calendarVias.push({ stopId: stopId, name: name, epoch: epoch, track: track || '' });
  saveCalendarStateToUrl();
  updateCalendarExportButton();
}

function setCalendarDest(stopId, name, epoch, track, stopIndex) {
  recordSubtrip(stopId, name, epoch, track, stopIndex);
  calendarDest = { stopId: stopId, name: name, epoch: epoch, track: track || '' };
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
  var exportBtn = document.getElementById('btn-export-calendar');
  if (!exportBtn) return;

  var isValid = !!(calendarStart && calendarDest);
  exportBtn.style.display = isValid ? 'block' : 'none';
}

function generateICS(startStop, viaStops, destStop, trips) {
  if (!startStop || !destStop) return null;

  var startEpoch = startStop.epoch;
  var destEpoch = destStop.epoch;

  if (!startEpoch || !destEpoch) return null;

  var startDate = new Date(startEpoch * 1000);
  var endDate = new Date(destEpoch * 1000);

  var formatDateTimeUTC = function (date) {
    var year = date.getUTCFullYear();
    var month = String(date.getUTCMonth() + 1).padStart(2, '0');
    var day = String(date.getUTCDate()).padStart(2, '0');
    var hours = String(date.getUTCHours()).padStart(2, '0');
    var mins = String(date.getUTCMinutes()).padStart(2, '0');
    var secs = String(date.getUTCSeconds()).padStart(2, '0');
    return year + month + day + 'T' + hours + mins + secs + 'Z';
  };

  var formatTimeHHMM = function (epoch) {
    if (!epoch) return '--:--';
    var d = new Date(epoch * 1000);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  var dtStart = formatDateTimeUTC(startDate);
  var dtEnd = formatDateTimeUTC(endDate);

  var descriptionLines = [];

  if (trips && trips.length > 0) {
    descriptionLines = trips.map(function (trip) {
      var sTime = formatTimeHHMM(trip.startTimeEpoch);
      var eTime = formatTimeHHMM(trip.endTimeEpoch);
      var startFormatted = formatStationWithTrack(trip.startStation, trip.startTrack);
      var endFormatted = formatStationWithTrack(trip.endStation, trip.endTrack);
      var tripNum = trip.tripNumber ? ' (' + trip.tripNumber + ')' : '';
      var viaText = Array.isArray(trip.vias) && trip.vias.length > 0 ? ' via ' + trip.vias.join(' · ') : '';
      return sTime + ' ' + startFormatted + ' - ' + eTime + ' ' + endFormatted + tripNum + viaText;
    });
  } else {
    var sTime = formatTimeHHMM(startEpoch);
    var eTime = formatTimeHHMM(destEpoch);
    var startFormatted = formatStationWithTrack(startStop.name, startStop.track);
    var endFormatted = formatStationWithTrack(destStop.name, destStop.track);
    descriptionLines.push(sTime + ' ' + startFormatted + ' - ' + eTime + ' ' + endFormatted);
  }

  var description = descriptionLines.join('\n');

  var firstTrip = trips && trips.length > 0 ? trips[0] : null;
  var locStation = firstTrip ? firstTrip.startStation : startStop.name;
  var locTrack = firstTrip ? firstTrip.startTrack : (startStop.track || '');
  var eventLocation = formatStationWithTrack(locStation, locTrack);

  var escapeICS = function (str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')
      .replace(/\n/g, '\\n');
  };

  var eventTitle = 'Fahrt: ' + startStop.name + ' → ' + destStop.name;
  var uid = 'calendar-' + startEpoch + '-' + destEpoch + '-' + Date.now() + '@stellwerksim.ch';

  return 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//NOWE-OMNI//Calendar Export//EN\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\nX-WR-CALNAME:NOWE-OMNI Fahrten\nX-WR-TIMEZONE:Europe/Zurich\nBEGIN:VEVENT\nUID:' + uid + '\nDTSTAMP:' + formatDateTimeUTC(new Date()) + '\nDTSTART:' + dtStart + '\nDTEND:' + dtEnd + '\nSUMMARY:' + escapeICS(eventTitle) + '\nDESCRIPTION:' + escapeICS(description) + '\nLOCATION:' + escapeICS(eventLocation) + '\nSEQUENCE:0\nSTATUS:CONFIRMED\nTRANSP:TRANSPARENT\nEND:VEVENT\nEND:VCALENDAR';
}

function downloadICS(icsContent) {
  var blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'fahrt-' + new Date().getTime() + '.ics';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function exportCalendarJourney() {
  if (!calendarStart || !calendarDest) {
    alert('Start und Ziel müssen gesetzt sein.');
    return;
  }

  var icsContent = generateICS(calendarStart, calendarVias, calendarDest, calendarTrips);
  if (!icsContent) {
    alert('Fehler beim Generieren der ICS-Datei.');
    return;
  }

  downloadICS(icsContent);
  clearCalendarJourney();
}

window.calendarStart = calendarStart;
window.calendarVias = calendarVias;
window.calendarDest = calendarDest;
window.calendarTrips = calendarTrips;
window.currentChainData = currentChainData;
window.loadCalendarStateFromUrl = loadCalendarStateFromUrl;
window.saveCalendarStateToUrl = saveCalendarStateToUrl;
window.setCalendarStart = setCalendarStart;
window.selectCalendarRole = selectCalendarRole;
window.recordSubtrip = recordSubtrip;
window.addCalendarVia = addCalendarVia;
window.setCalendarDest = setCalendarDest;
window.clearCalendarJourney = clearCalendarJourney;
window.updateCalendarExportButton = updateCalendarExportButton;
window.generateICS = generateICS;
window.downloadICS = downloadICS;
window.exportCalendarJourney = exportCalendarJourney;
