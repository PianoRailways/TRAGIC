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