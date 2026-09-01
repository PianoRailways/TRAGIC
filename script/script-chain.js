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