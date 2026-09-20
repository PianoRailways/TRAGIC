<?php
$dataFile = __DIR__ . '/data.json';

// API ENDPUNKTE FÜR PHP
if (isset($_GET['api'])) {
    header('Content-Type: application/json');
    
    if ($_GET['api'] === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = file_get_contents('php://input');
        if ($input && json_decode($input) !== null) {
            file_put_contents($dataFile, $input);
            echo json_encode(['status' => 'success', 'message' => 'Daten erfolgreich auf dem Server gespeichert.']);
        } else {
            http_response_code(400);
            echo json_encode(['status' => 'error', 'message' => 'Ungültiges JSON-Format.']);
        }
        exit;
    }
    
    if ($_GET['api'] === 'load' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        if (file_exists($dataFile)) {
            echo file_get_contents($dataFile);
        } else {
            echo json_encode(['stations' => []]);
        }
        exit;
    }
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>öV Trip & Station Studio (PHP)</title>
  
  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  
  <!-- React & ReactDOM CDN -->
  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
  
  <!-- Babel Standalone -->
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body class="bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden">

  <div id="root"></div>

  <script type="text/babel">
    const { useState, useEffect, useMemo } = React;

    // --- ICONS ---
    const IconTrain = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16M12 3v8M8 19l-3 3M16 19l3 3"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></svg>;
    const IconBus = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M8 6v6M16 6v6M2 12h20"/><rect x="4" y="3" width="16" height="15" rx="2"/><path d="M6 18l-2 3M18 18l2 3"/><circle cx="7" cy="15" r="1"/><circle cx="17" cy="15" r="1"/></svg>;
    const IconPlus = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
    const IconTrash = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>;
    const IconSave = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
    const IconMapPin = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
    const IconBuilding = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/></svg>;
    const IconCode = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
    const IconDashboard = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>;
    const IconChevronRight = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>;

    // INITIALE STAMMDATEN
    const DEFAULT_STATIONS = [
      { id: "custom_pinu_s_OFWFS", name: "Otelfingen FWF Süd" },
      { id: "custom_pinu_s_OFWF", name: "Otelfingen FEF" },
      { id: "custom_p_z", name: "Otelfingen Zentrum" },
      { id: "custom_s_baden", name: "Baden" },
      { id: "custom_s_zhb", name: "Zürich HB" }
    ];

    const DEFAULT_TRIPS = [
      {
        tripId: "custom_pinu_t_1",
        line: "FEXT",
        tripNumber: "1",
        mode: "RAIL",
        agency: { id: "sbb", name: "Schweizerische Bundesbahnen SBB" },
        stops: [
          { stopId: "custom_pinu_s_OFWFS", name: "Otelfingen FWF Süd", scheduled: "2026-08-30T12:00:00+02:00", track: "A", legIndex: null },
          { stopId: "custom_pinu_s_OFWF", name: "Otelfingen FEF", scheduled: "2026-08-30T12:05:00+02:00", track: "F", legIndex: 0 },
          { stopId: "custom_p_z", name: "Otelfingen Zentrum", scheduled: "2026-08-30T12:12:00+02:00", track: "1", legIndex: 1 }
        ]
      }
    ];

    function App() {
      const [stations, setStations] = useState(DEFAULT_STATIONS);
      const [trips, setTrips] = useState(DEFAULT_TRIPS);
      
      const [activeStationId, setActiveStationId] = useState("custom_pinu_s_OFWF");
      const [viewTab, setViewTab] = useState("split"); // "split", "trips", "stations", "json"
      
      const [saveStatus, setSaveStatus] = useState({ type: "", message: "" });
      const [isSaving, setIsSaving] = useState(false);

      // NEUE STATION MODAL / FORM
      const [newStationId, setNewStationId] = useState("");
      const [newStationName, setNewStationName] = useState("");
      const [showStationModal, setShowStationModal] = useState(false);

      // BEIM START VOM SERVER LADEN
      useEffect(() => {
        fetch("own-editor.php?api=load")
          .then(res => res.json())
          .then(data => {
            if (data && data.stations && data.stations.length > 0) {
              // Rekonstruiere Stamm-Stationen und Trips aus Server-JSON
              const extractedStationsMap = {};
              const extractedTripsMap = {};

              data.stations.forEach(st => {
                extractedStationsMap[st.id] = { id: st.id, name: st.name };
                if (st.departures) {
                  st.departures.forEach(dep => {
                    if (dep.tripId && !extractedTripsMap[dep.tripId]) {
                      extractedTripsMap[dep.tripId] = {
                        tripId: dep.tripId,
                        line: dep.line,
                        tripNumber: dep.tripNumber || "",
                        mode: dep.mode || "RAIL",
                        agency: dep.trip?.agency || { id: dep.agency?.toLowerCase() || "sbb", name: dep.agency || "SBB" },
                        stops: dep.trip?.stops?.map(s => ({
                          stopId: s.stopId,
                          name: s.name,
                          scheduled: s.departureLive || dep.scheduled || "",
                          track: s.track || "",
                          legIndex: s.legIndex
                        })) || []
                      };
                    }
                  });
                }
              });

              if (Object.keys(extractedStationsMap).length > 0) {
                setStations(Object.values(extractedStationsMap));
              }
              if (Object.keys(extractedTripsMap).length > 0) {
                setTrips(Object.values(extractedTripsMap));
              }
            }
          })
          .catch(err => console.log("Standard-Fahrplan wird genutzt:", err));
      }, []);

      // AUTOMATISCHE GENERIERUNG DES SLLEN JSON-FORMATS
      const generatedFullJSON = useMemo(() => {
        const stationsMap = {};

        // Alle Stationen initialisieren
        stations.forEach(st => {
          stationsMap[st.id] = {
            id: st.id,
            name: st.name,
            departures: []
          };
        });

        // Fahrten auf die Stationen verteilen
        trips.forEach(trip => {
          const stops = trip.stops || [];
          if (stops.length === 0) return;

          const destStop = stops[stops.length - 1];
          const destinationName = destStop ? destStop.name : "Unbekannt";

          const formattedStops = stops.map((s, idx) => ({
            stopId: s.stopId,
            name: s.name,
            departureLive: s.scheduled || null,
            track: s.track || "",
            legIndex: s.legIndex !== undefined ? s.legIndex : (idx === 0 ? null : idx - 1)
          }));

          stops.forEach((stop, idx) => {
            // Am Zielort gibt es keine Abfahrt mehr
            if (idx === stops.length - 1) return;

            const stId = stop.stopId;
            if (!stId) return;

            if (!stationsMap[stId]) {
              stationsMap[stId] = { id: stId, name: stop.name || stId, departures: [] };
            }

            const agencyObj = typeof trip.agency === 'object' ? trip.agency : { id: 'sbb', name: trip.agency || 'SBB' };

            stationsMap[stId].departures.push({
              tripId: trip.tripId,
              line: trip.line,
              tripNumber: trip.tripNumber || "",
              agency: agencyObj.id?.toUpperCase() || agencyObj.name || "SBB",
              destination: destinationName,
              scheduled: stop.scheduled || new Date().toISOString(),
              track: stop.track || "",
              mode: trip.mode || "RAIL",
              trip: {
                agency: agencyObj,
                stops: formattedStops
              }
            });
          });
        });

        return {
          stations: Object.values(stationsMap)
        };
      }, [stations, trips]);

      // AUF DEN SERVER SPEICHERN
      const saveToServer = async () => {
        setIsSaving(true);
        setSaveStatus({ type: "", message: "" });

        try {
          const res = await fetch("own-editor.php?api=save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(generatedFullJSON, null, 2)
          });
          const result = await res.json();
          if (res.ok) {
            setSaveStatus({ type: "success", message: "Gespeichert!" });
          } else {
            setSaveStatus({ type: "error", message: result.message || "Fehler beim Speichern" });
          }
        } catch (err) {
          setSaveStatus({ type: "error", message: "Server nicht erreichbar." });
        } finally {
          setIsSaving(false);
          setTimeout(() => setSaveStatus({ type: "", message: "" }), 4000);
        }
      };

      // NEUE STATION HINZUFÜGEN
      const handleAddStation = (e) => {
        e.preventDefault();
        if (!newStationId || !newStationName) return;
        setStations([...stations, { id: newStationId, name: newStationName }]);
        setNewStationId("");
        setNewStationName("");
        setShowStationModal(false);
      };

      // NEUEN TRIP HINZUFÜGEN
      const handleAddTrip = () => {
        const newId = `custom_pinu_t_${Date.now().toString().slice(-4)}`;
        const st1 = stations[0] || { id: "custom_s_1", name: "Station A" };
        const st2 = stations[1] || { id: "custom_s_2", name: "Station B" };

        const newTrip = {
          tripId: newId,
          line: "S" + Math.floor(Math.random() * 10 + 1),
          tripNumber: Math.floor(Math.random() * 9000 + 1000).toString(),
          mode: "RAIL",
          agency: { id: "sbb", name: "Schweizerische Bundesbahnen SBB" },
          stops: [
            { stopId: st1.id, name: st1.name, scheduled: new Date().toISOString(), track: "1", legIndex: null },
            { stopId: st2.id, name: st2.name, scheduled: new Date(Date.now() + 600000).toISOString(), track: "2", legIndex: 0 }
          ]
        };
        setTrips([...trips, newTrip]);
      };

      // TRIP FELD AKTUALISIEREN
      const updateTripField = (tripIdx, field, value) => {
        const updated = [...trips];
        if (field.startsWith("agency.")) {
          const subField = field.split(".")[1];
          updated[tripIdx].agency = { ...updated[tripIdx].agency, [subField]: value };
        } else {
          updated[tripIdx][field] = value;
        }
        setTrips(updated);
      };

      // TRIP HALT AKTUALISIEREN
      const updateTripStop = (tripIdx, stopIdx, field, value) => {
        const updated = [...trips];
        const stop = updated[tripIdx].stops[stopIdx];

        if (field === "stopId") {
          const st = stations.find(s => s.id === value);
          stop.stopId = value;
          if (st) stop.name = st.name;
        } else {
          stop[field] = value;
        }
        setTrips(updated);
      };

      // HALT ZU TRIP HINZUFÜGEN
      const addStopToTrip = (tripIdx) => {
        const updated = [...trips];
        const lastStop = updated[tripIdx].stops[updated[tripIdx].stops.length - 1];
        const nextSt = stations.find(s => s.id !== lastStop?.stopId) || stations[0];

        updated[tripIdx].stops.push({
          stopId: nextSt ? nextSt.id : "custom_new_st",
          name: nextSt ? nextSt.name : "Neue Station",
          scheduled: new Date().toISOString(),
          track: "1",
          legIndex: updated[tripIdx].stops.length - 1
        });
        setTrips(updated);
      };

      // HALT VON TRIP ENTFERNEN
      const removeStopFromTrip = (tripIdx, stopIdx) => {
        const updated = [...trips];
        updated[tripIdx].stops.splice(stopIdx, 1);
        setTrips(updated);
      };

      // ENTFERNE TRIP
      const removeTrip = (tripIdx) => {
        setTrips(trips.filter((_, i) => i !== tripIdx));
      };

      // GEFUNDER BAHNHOF FÜR MONITOR
      const activeStationData = useMemo(() => {
        return generatedFullJSON.stations.find(s => s.id === activeStationId) || generatedFullJSON.stations[0];
      }, [generatedFullJSON, activeStationId]);

      return (
        <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden">
          
          {/* HEADER */}
          <header className="h-16 border-b border-slate-800 bg-slate-900/90 px-6 flex items-center justify-between flex-shrink-0 z-10">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
                <IconTrain />
              </div>
              <div>
                <h1 className="font-semibold text-sm text-slate-100">öV Trip & Station Studio</h1>
                <p className="text-[11px] text-slate-400">Direktes PHP File-Saving & Derivation</p>
              </div>
            </div>

            {/* BAHNHOF SELEKTOR */}
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 border border-slate-800 rounded-lg">
              <IconMapPin />
              <span className="text-xs text-slate-400">Monitor-Bahnhof:</span>
              <select 
                value={activeStationId} 
                onChange={(e) => setActiveStationId(e.target.value)}
                className="bg-transparent text-xs font-semibold text-blue-400 focus:outline-none cursor-pointer"
              >
                {stations.map(st => (
                  <option key={st.id} value={st.id} className="bg-slate-900 text-slate-100">{st.name}</option>
                ))}
              </select>
            </div>

            {/* BUTTONS & TAB SWITCHER */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-slate-950 p-1 border border-slate-800 rounded-lg">
                <button 
                  onClick={() => setViewTab("split")}
                  className={`px-3 py-1 rounded text-xs transition ${viewTab === "split" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Split View
                </button>
                <button 
                  onClick={() => setViewTab("trips")}
                  className={`px-3 py-1 rounded text-xs transition ${viewTab === "trips" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Fahrten ({trips.length})
                </button>
                <button 
                  onClick={() => setViewTab("stations")}
                  className={`px-3 py-1 rounded text-xs transition ${viewTab === "stations" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Stationen ({stations.length})
                </button>
                <button 
                  onClick={() => setViewTab("json")}
                  className={`px-3 py-1 rounded text-xs transition ${viewTab === "json" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  JSON Output
                </button>
              </div>

              {/* SAVE TO PHP SERVER BUTTON */}
              <button 
                onClick={saveToServer}
                disabled={isSaving}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-md transition disabled:opacity-50"
              >
                <IconSave /> {isSaving ? "Speichert..." : "Auf Server speichern"}
              </button>

              {saveStatus.message && (
                <span className={`text-xs px-2 py-1 rounded ${saveStatus.type === "success" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                  {saveStatus.message}
                </span>
              )}
            </div>
          </header>

          {/* MAIN CONTENT AREA */}
          <div className="flex-1 flex overflow-hidden">
            
            {/* LINKES PANEL: FAHRTEN EDITOR */}
            {(viewTab === "split" || viewTab === "trips") && (
              <div className={`${viewTab === "split" ? "w-1/2" : "w-full"} border-r border-slate-800 flex flex-col bg-slate-900/40 overflow-y-auto p-4 space-y-4`}>
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Fahrten-Editor (Trips)</h2>
                    <p className="text-xs text-slate-400">Erstelle Züge & Busse von A nach B. Abfahrten werden automatisch abgeleitet.</p>
                  </div>
                  <button 
                    onClick={handleAddTrip}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg flex items-center gap-1 shadow-sm"
                  >
                    <IconPlus /> Neue Fahrt
                  </button>
                </div>

                <div className="space-y-4">
                  {trips.map((trip, tripIdx) => (
                    <div key={trip.tripId} className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3 relative group">
                      <button 
                        onClick={() => removeTrip(tripIdx)}
                        className="absolute top-3 right-3 text-slate-500 hover:text-red-400 transition"
                        title="Fahrt löschen"
                      >
                        <IconTrash />
                      </button>

                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">Linie</label>
                          <input 
                            type="text" 
                            value={trip.line} 
                            onChange={(e) => updateTripField(tripIdx, "line", e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100 font-semibold"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">Fahrtnummer</label>
                          <input 
                            type="text" 
                            value={trip.tripNumber} 
                            onChange={(e) => updateTripField(tripIdx, "tripNumber", e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100 font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">Agency ID</label>
                          <input 
                            type="text" 
                            value={trip.agency?.id || "sbb"} 
                            onChange={(e) => updateTripField(tripIdx, "agency.id", e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">Agency Name</label>
                          <input 
                            type="text" 
                            value={trip.agency?.name || "SBB"} 
                            onChange={(e) => updateTripField(tripIdx, "agency.name", e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100"
                          />
                        </div>
                      </div>

                      {/* ZUGLAUF / HALTE */}
                      <div className="space-y-2 pt-2 border-t border-slate-800/80">
                        <div className="flex justify-between items-center text-[11px] font-semibold text-slate-400">
                          <span>Haltestellen-Reihenfolge ({trip.stops.length})</span>
                          <button 
                            onClick={() => addStopToTrip(tripIdx)}
                            className="text-blue-400 hover:underline flex items-center gap-0.5 text-[10px]"
                          >
                            <IconPlus /> Halt anfügen
                          </button>
                        </div>

                        {trip.stops.map((st, stopIdx) => (
                          <div key={stopIdx} className="p-2 bg-slate-950 border border-slate-800 rounded-lg flex items-center gap-2 text-xs">
                            <span className="font-mono text-slate-600 text-[10px] w-4">{stopIdx + 1}.</span>
                            
                            {/* STATION DROPDOWN */}
                            <select 
                              value={st.stopId}
                              onChange={(e) => updateTripStop(tripIdx, stopIdx, "stopId", e.target.value)}
                              className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-slate-200 text-xs"
                            >
                              {stations.map(s => (
                                <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                              ))}
                            </select>

                            <input 
                              type="text" 
                              placeholder="ISO Zeit" 
                              value={st.scheduled} 
                              onChange={(e) => updateTripStop(tripIdx, stopIdx, "scheduled", e.target.value)}
                              className="w-40 bg-slate-900 border border-slate-800 rounded p-1 font-mono text-[11px] text-slate-300"
                            />

                            <input 
                              type="text" 
                              placeholder="Gleis" 
                              value={st.track} 
                              onChange={(e) => updateTripStop(tripIdx, stopIdx, "track", e.target.value)}
                              className="w-12 bg-slate-900 border border-slate-800 rounded p-1 text-center font-mono text-xs"
                            />

                            {trip.stops.length > 2 && (
                              <button 
                                onClick={() => removeStopFromTrip(tripIdx, stopIdx)}
                                className="text-slate-600 hover:text-red-400 p-1"
                              >
                                <IconTrash />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RECHTES PANEL: LIVE STATIONBOARD & INSPECTOR */}
            {(viewTab === "split" || viewTab === "json") && (
              <div className={`${viewTab === "split" ? "w-1/2" : "w-full"} flex flex-col bg-slate-950 overflow-y-auto`}>
                
                {viewTab === "split" ? (
                  <div className="p-6 space-y-6">
                    <div>
                      <div className="flex justify-between items-end mb-3">
                        <div>
                          <h2 className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                            Abfahrtsmonitor (Generiert)
                          </h2>
                          <p className="text-lg font-bold text-slate-100 flex items-center gap-2">
                            <IconMapPin /> {activeStationData?.name || "Keine Station"}
                          </p>
                        </div>
                        <span className="text-xs font-mono text-slate-500">
                          {activeStationData?.departures?.length || 0} Abfahrten
                        </span>
                      </div>

                      {/* ABFAHRTS-LISTE */}
                      <div className="grid gap-2.5">
                        {!activeStationData?.departures || activeStationData.departures.length === 0 ? (
                          <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
                            Keine Abfahrten für diese Station vorhanden.
                          </div>
                        ) : (
                          activeStationData.departures.map((dep, idx) => (
                            <div key={idx} className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl flex items-center justify-between">
                              <div className="flex items-center gap-3.5">
                                <div className="w-12 h-10 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 font-bold text-xs flex flex-col items-center justify-center">
                                  <span>{dep.line}</span>
                                  <span className="text-[9px] font-normal opacity-75">{dep.tripNumber}</span>
                                </div>
                                <div>
                                  <div className="font-semibold text-sm text-slate-100">{dep.destination}</div>
                                  <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-300 border border-slate-700/50">
                                      {dep.agency}
                                    </span>
                                    {dep.track && <span>Gleis <strong>{dep.track}</strong></span>}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-sm font-mono font-bold text-slate-100">
                                  {dep.scheduled ? new Date(dep.scheduled).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                </div>
                                <div className="text-[10px] text-emerald-400 font-mono">pünktlich</div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* RAW JSON OUTPUT TAB */
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="mb-2 text-xs text-slate-400 flex justify-between items-center">
                      <span>Live Server JSON Output:</span>
                      <button 
                        onClick={() => navigator.clipboard.writeText(JSON.stringify(generatedFullJSON, null, 2))}
                        className="text-blue-400 hover:underline"
                      >
                        JSON Kopieren
                      </button>
                    </div>
                    <textarea 
                      readOnly 
                      value={JSON.stringify(generatedFullJSON, null, 2)}
                      className="w-full flex-1 bg-slate-950 p-4 border border-slate-800 rounded-xl font-mono text-xs text-emerald-400 resize-none focus:outline-none"
                    />
                  </div>
                )}

              </div>
            )}

            {/* STATIONS TAB */}
            {viewTab === "stations" && (
              <div className="w-full p-6 space-y-4 overflow-y-auto">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Stationen-Stammverzeichnis</h2>
                    <p className="text-xs text-slate-400">Verwalte alle verfügbaren Bahnhöfe & Haltestellen.</p>
                  </div>
                  <button 
                    onClick={() => setShowStationModal(true)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg flex items-center gap-1 shadow-sm"
                  >
                    <IconPlus /> Neue Station
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {stations.map((st, idx) => (
                    <div key={st.id} className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-slate-200">{st.name}</div>
                        <div className="text-[10px] font-mono text-slate-500">{st.id}</div>
                      </div>
                      <button 
                        onClick={() => setStations(stations.filter((_, i) => i !== idx))}
                        className="text-slate-600 hover:text-red-400"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* MODAL: NEUE STATION */}
          {showStationModal && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <form onSubmit={handleAddStation} className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-md space-y-4">
                <h3 className="text-sm font-semibold text-slate-100">Neue Station hinzufügen</h3>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Station ID</label>
                    <input 
                      type="text" 
                      placeholder="z.B. custom_pinu_s_OFWF"
                      value={newStationId}
                      onChange={(e) => setNewStationId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Station Name</label>
                    <input 
                      type="text" 
                      placeholder="z.B. Otelfingen FEF"
                      value={newStationName}
                      onChange={(e) => setNewStationName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100"
                      required
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button 
                    type="button" 
                    onClick={() => setShowStationModal(false)}
                    className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs rounded-lg"
                  >
                    Abbrechen
                  </button>
                  <button 
                    type="submit" 
                    className="px-4 py-1.5 bg-blue-600 text-white text-xs rounded-lg font-medium"
                  >
                    Hinzufügen
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>