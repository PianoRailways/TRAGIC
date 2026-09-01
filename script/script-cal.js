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