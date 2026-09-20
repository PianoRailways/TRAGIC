<?php
$dataFile = __DIR__ . '/cache/data.json';

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

    // --- ZEITKONVERTIERUNG ---
    const toUnixTimestamp = (dateTimeLocalStr) => {
      if (!dateTimeLocalStr) return null;
      const d = new Date(dateTimeLocalStr);
      return Math.floor(d.getTime() / 1000);
    };

    const fromUnixTimestamp = (unixSec) => {
      if (!unixSec) return "";
      const d = new Date(unixSec * 1000);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const mins = String(d.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${mins}`;
    };

    // --- ICONS ---
    const IconTrain = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16M12 3v8M8 19l-3 3M16 19l3 3"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></svg>;
    const IconPlus = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
    const IconTrash = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>;
    const IconSave = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
    const IconMapPin = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
    const IconAlertTriangle = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;

    // INITIALE STAMMDATEN (mit UNIX-Timestamps)
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
          { stopId: "custom_pinu_s_OFWFS", name: "Otelfingen FWF Süd", scheduled: 1725015600, track: "A", legIndex: null },
          { stopId: "custom_pinu_s_OFWF", name: "Otelfingen FEF", scheduled: 1725015900, track: "F", legIndex: 0 },
          { stopId: "custom_p_z", name: "Otelfingen Zentrum", scheduled: 1725016320, track: "1", legIndex: 1 }
        ]
      }
    ];

    function App() {
      const [stations, setStations] = useState(DEFAULT_STATIONS);
      const [trips, setTrips] = useState(DEFAULT_TRIPS);
      
      const [activeStationId, setActiveStationId] = useState("custom_pinu_s_OFWF");
      const [viewTab, setViewTab] = useState("split");
      
      const [saveStatus, setSaveStatus] = useState({ type: "", message: "" });
      const [isSaving, setIsSaving] = useState(false);
      const [validationErrors, setValidationErrors] = useState({});

      const [newStationId, setNewStationId] = useState("");
      const [newStationName, setNewStationName] = useState("");
      const [showStationModal, setShowStationModal] = useState(false);

      // BEIM START VOM SERVER LADEN
      useEffect(() => {
        fetch("own-editor.php?api=load")
          .then(res => res.json())
          .then(data => {
            if (data && data.stations && data.stations.length > 0) {
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
                          scheduled: s.departureLive || s.departureSched || 0,
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

      // VALIDIERUNG: Chronologische Ordnung pro Trip
      const validateTrips = (tripsToCheck) => {
        const errors = {};
        tripsToCheck.forEach((trip, tripIdx) => {
          const stops = trip.stops || [];
          for (let i = 0; i < stops.length - 1; i++) {
            const curr = stops[i].scheduled || 0;
            const next = stops[i + 1].scheduled || 0;
            if (next <= curr) {
              errors[`trip_${tripIdx}`] = `Halt ${i + 2} muss nach Halt ${i + 1} sein`;
              break;
            }
          }
        });
        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
      };

      // legIndex AUTOMATISCH BERECHNEN
      const calculateLegIndices = (stops) => {
        return stops.map((stop, idx) => ({
          ...stop,
          legIndex: idx === 0 ? null : idx - 1
        }));
      };

      // JSON-GENERIERUNG mit legIndex-Berechnung
      const generatedFullJSON = useMemo(() => {
        const stationsMap = {};

        stations.forEach(st => {
          stationsMap[st.id] = {
            id: st.id,
            name: st.name,
            departures: []
          };
        });

        trips.forEach(trip => {
          const stops = trip.stops || [];
          if (stops.length === 0) return;

          const destStop = stops[stops.length - 1];
          const destinationName = destStop ? destStop.name : "Unbekannt";

          const stopsWithLegIndex = calculateLegIndices(stops);
          const formattedStops = stopsWithLegIndex.map(s => ({
            stopId: s.stopId,
            name: s.name,
            departureLive: s.legIndex === null ? null : s.scheduled,
            departureSched: s.legIndex === null ? null : s.scheduled,
            arrivalSched: s.legIndex === null ? s.scheduled : s.scheduled,
            arrivalLive: s.legIndex === null ? s.scheduled : s.scheduled,
            track: s.track || "",
            legIndex: s.legIndex
          }));

          stops.forEach((stop, idx) => {
            // Letzter Halt: kein Departure
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
              scheduled: stop.scheduled || 0,
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

      // SPEICHERN MIT VALIDIERUNG
      const saveToServer = async () => {
        if (!validateTrips(trips)) {
          setSaveStatus({ type: "error", message: "Validierungsfehler: Überprüfe Haltesreihenfolge" });
          setTimeout(() => setSaveStatus({ type: "", message: "" }), 4000);
          return;
        }

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

      const handleAddStation = (e) => {
        e.preventDefault();
        if (!newStationId || !newStationName) return;
        setStations([...stations, { id: newStationId, name: newStationName }]);
        setNewStationId("");
        setNewStationName("");
        setShowStationModal(false);
      };

      const handleAddTrip = () => {
        const newId = `custom_pinu_t_${Date.now().toString().slice(-4)}`;
        const st1 = stations[0] || { id: "custom_s_1", name: "Station A" };
        const st2 = stations[1] || { id: "custom_s_2", name: "Station B" };
        const now = Math.floor(Date.now() / 1000);

        const newTrip = {
          tripId: newId,
          line: "S" + Math.floor(Math.random() * 10 + 1),
          tripNumber: Math.floor(Math.random() * 9000 + 1000).toString(),
          mode: "RAIL",
          agency: { id: "sbb", name: "Schweizerische Bundesbahnen SBB" },
          stops: [
            { stopId: st1.id, name: st1.name, scheduled: now, track: "1", legIndex: null },
            { stopId: st2.id, name: st2.name, scheduled: now + 600, track: "2", legIndex: 0 }
          ]
        };
        setTrips([...trips, newTrip]);
      };

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

      // DATETIME PICKER STATE
      const [activeTimePicker, setActiveTimePicker] = useState(null);
      const [pickerDate, setPickerDate] = useState("");
      const [pickerHour, setPickerHour] = useState(0);
      const [pickerMinute, setPickerMinute] = useState(0);

      const updateTripStop = (tripIdx, stopIdx, field, value) => {
        const updated = [...trips];
        const stop = updated[tripIdx].stops[stopIdx];

        if (field === "stopId") {
          const st = stations.find(s => s.id === value);
          stop.stopId = value;
          if (st) stop.name = st.name;
        } else if (field === "scheduled_input") {
          stop.scheduled = toUnixTimestamp(value);
        } else {
          stop[field] = value;
        }
        setTrips(updated);
      };

      const openTimePicker = (tripIdx, stopIdx, currentValue) => {
        const d = new Date(currentValue * 1000);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hour = d.getHours();
        const minute = d.getMinutes();
        
        setActiveTimePicker({ tripIdx, stopIdx });
        setPickerDate(`${year}-${month}-${day}`);
        setPickerHour(hour);
        setPickerMinute(minute);
      };

      const confirmTimePicker = () => {
        if (activeTimePicker && pickerDate) {
          const { tripIdx, stopIdx } = activeTimePicker;
          const dateTimeStr = `${pickerDate}T${String(pickerHour).padStart(2, "0")}:${String(pickerMinute).padStart(2, "0")}`;
          updateTripStop(tripIdx, stopIdx, "scheduled_input", dateTimeStr);
          setActiveTimePicker(null);
        }
      };

      const adjustTime = (field, delta) => {
        if (field === "hour") {
          setPickerHour(prev => (prev + delta + 24) % 24);
        } else if (field === "minute") {
          setPickerMinute(prev => (prev + delta + 60) % 60);
        }
      };

      const addStopToTrip = (tripIdx) => {
        const updated = [...trips];
        const lastStop = updated[tripIdx].stops[updated[tripIdx].stops.length - 1];
        const nextSt = stations.find(s => s.id !== lastStop?.stopId) || stations[0];
        const newTime = (lastStop?.scheduled || 0) + 300;

        updated[tripIdx].stops.push({
          stopId: nextSt ? nextSt.id : "custom_new_st",
          name: nextSt ? nextSt.name : "Neue Station",
          scheduled: newTime,
          track: "1",
          legIndex: updated[tripIdx].stops.length
        });
        setTrips(updated);
      };

      const removeStopFromTrip = (tripIdx, stopIdx) => {
        const updated = [...trips];
        updated[tripIdx].stops.splice(stopIdx, 1);
        setTrips(updated);
      };

      const removeTrip = (tripIdx) => {
        setTrips(trips.filter((_, i) => i !== tripIdx));
      };

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
                <p className="text-[11px] text-slate-400">UNIX-Timestamps, datetime-local UI</p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 border border-slate-800 rounded-lg">
              <IconMapPin />
              <span className="text-xs text-slate-400">Monitor:</span>
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

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-slate-950 p-1 border border-slate-800 rounded-lg">
                <button 
                  onClick={() => setViewTab("split")}
                  className={`px-3 py-1 rounded text-xs transition ${viewTab === "split" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Split
                </button>
                <button 
                  onClick={() => setViewTab("trips")}
                  className={`px-3 py-1 rounded text-xs transition ${viewTab === "trips" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Trips ({trips.length})
                </button>
                <button 
                  onClick={() => setViewTab("stations")}
                  className={`px-3 py-1 rounded text-xs transition ${viewTab === "stations" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Stationen
                </button>
                <button 
                  onClick={() => setViewTab("json")}
                  className={`px-3 py-1 rounded text-xs transition ${viewTab === "json" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  JSON
                </button>
              </div>

              <button 
                onClick={saveToServer}
                disabled={isSaving}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-md transition disabled:opacity-50"
              >
                <IconSave /> {isSaving ? "Speichert..." : "Speichern"}
              </button>

              {saveStatus.message && (
                <span className={`text-xs px-2 py-1 rounded ${saveStatus.type === "success" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                  {saveStatus.message}
                </span>
              )}
            </div>
          </header>

          {/* MAIN CONTENT */}
          <div className="flex-1 flex overflow-hidden">
            
            {(viewTab === "split" || viewTab === "trips") && (
              <div className={`${viewTab === "split" ? "w-1/2" : "w-full"} border-r border-slate-800 flex flex-col bg-slate-900/40 overflow-y-auto p-4 space-y-4`}>
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Fahrten-Editor</h2>
                    <p className="text-xs text-slate-400">Zeitangaben: Datum + Uhrzeit (wird zu UNIX-Timestamp)</p>
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
                    <div key={trip.tripId} className={`p-4 bg-slate-900 border rounded-xl space-y-3 relative group ${validationErrors[`trip_${tripIdx}`] ? "border-red-500/50" : "border-slate-800"}`}>
                      {validationErrors[`trip_${tripIdx}`] && (
                        <div className="text-xs bg-red-500/20 border border-red-500/50 text-red-400 p-2 rounded flex items-start gap-2">
                          <IconAlertTriangle />
                          {validationErrors[`trip_${tripIdx}`]}
                        </div>
                      )}

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
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100"
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

                      <div className="space-y-2 pt-2 border-t border-slate-800/80">
                        <div className="flex justify-between items-center text-[11px] font-semibold text-slate-400">
                          <span>Haltestellen ({trip.stops.length})</span>
                          <button 
                            onClick={() => addStopToTrip(tripIdx)}
                            className="text-blue-400 hover:underline flex items-center gap-0.5 text-[10px]"
                          >
                            <IconPlus /> Anfügen
                          </button>
                        </div>

                        {trip.stops.map((st, stopIdx) => (
                          <div key={stopIdx} className="p-2 bg-slate-950 border border-slate-800 rounded-lg flex items-center gap-2 text-xs flex-wrap">
                            <span className="font-mono text-slate-600 text-[10px] w-4">{stopIdx + 1}.</span>
                            
                            <select 
                              value={st.stopId}
                              onChange={(e) => updateTripStop(tripIdx, stopIdx, "stopId", e.target.value)}
                              className="flex-1 min-w-[200px] bg-slate-900 border border-slate-800 rounded p-1 text-slate-200 text-xs"
                            >
                              {stations.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>

                            <button 
                              onClick={() => openTimePicker(tripIdx, stopIdx, st.scheduled)}
                              className="px-2 py-1 bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded hover:bg-blue-600/40 transition text-xs font-mono"
                              title="Zeit wählen"
                            >
                              {fromUnixTimestamp(st.scheduled).split('T')[1] || "--:--"}
                            </button>

                            <input 
                              type="text" 
                              placeholder="Gleis" 
                              value={st.track} 
                              onChange={(e) => updateTripStop(tripIdx, stopIdx, "track", e.target.value)}
                              className="w-12 bg-slate-900 border border-slate-800 rounded p-1 text-center text-xs"
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
                                  {dep.scheduled ? new Date(dep.scheduled * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
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
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="mb-2 text-xs text-slate-400 flex justify-between items-center">
                      <span>JSON Output (UNIX-Timestamps):</span>
                      <button 
                        onClick={() => navigator.clipboard.writeText(JSON.stringify(generatedFullJSON, null, 2))}
                        className="text-blue-400 hover:underline"
                      >
                        Kopieren
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

            {viewTab === "stations" && (
              <div className="w-full p-6 space-y-4 overflow-y-auto">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Stationen</h2>
                    <p className="text-xs text-slate-400">Bahnhöfe & Haltestellen</p>
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

          {/* TIME PICKER MODAL WITH SPINNERS */}
          {activeTimePicker && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm space-y-5">
                <h3 className="text-sm font-semibold text-slate-100">Zeit & Datum</h3>
                
                {/* DATUM INPUT */}
                <div>
                  <label className="text-slate-400 text-xs block mb-2">Datum</label>
                  <input 
                    type="date" 
                    value={pickerDate}
                    onChange={(e) => setPickerDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* UHRZEIT SPINNER */}
                <div>
                  <label className="text-slate-400 text-xs block mb-3">Uhrzeit</label>
                  <div className="flex items-center justify-center gap-4 bg-slate-950 p-6 rounded-lg border border-slate-800">
                    
                    {/* STUNDEN SPINNER */}
                    <div className="flex flex-col items-center">
                      <button 
                        onClick={() => adjustTime("hour", 1)}
                        className="text-slate-400 hover:text-slate-200 mb-2 p-1"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
                      </button>
                      <div className="text-3xl font-bold text-blue-400 font-mono w-12 text-center py-2 bg-slate-900 rounded-lg border border-slate-700">
                        {String(pickerHour).padStart(2, "0")}
                      </div>
                      <button 
                        onClick={() => adjustTime("hour", -1)}
                        className="text-slate-400 hover:text-slate-200 mt-2 p-1"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      <div className="text-[10px] text-slate-500 mt-3">Stunden</div>
                    </div>

                    {/* TRENNZEICHEN */}
                    <div className="text-2xl font-bold text-slate-500">:</div>

                    {/* MINUTEN SPINNER */}
                    <div className="flex flex-col items-center">
                      <button 
                        onClick={() => adjustTime("minute", 1)}
                        className="text-slate-400 hover:text-slate-200 mb-2 p-1"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
                      </button>
                      <div className="text-3xl font-bold text-emerald-400 font-mono w-12 text-center py-2 bg-slate-900 rounded-lg border border-slate-700">
                        {String(pickerMinute).padStart(2, "0")}
                      </div>
                      <button 
                        onClick={() => adjustTime("minute", -1)}
                        className="text-slate-400 hover:text-slate-200 mt-2 p-1"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      <div className="text-[10px] text-slate-500 mt-3">Minuten</div>
                    </div>
                  </div>
                </div>

                {/* PREVIEW */}
                <div className="text-xs bg-slate-950 p-3 rounded border border-slate-800 text-slate-400">
                  <span>Zeitstempel: </span>
                  <span className="font-mono text-emerald-400">
                    {toUnixTimestamp(`${pickerDate}T${String(pickerHour).padStart(2, "0")}:${String(pickerMinute).padStart(2, "0")}`) || "—"}
                  </span>
                </div>

                {/* BUTTONS */}
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button 
                    onClick={() => setActiveTimePicker(null)}
                    className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs rounded-lg hover:bg-slate-700 transition"
                  >
                    Abbrechen
                  </button>
                  <button 
                    onClick={confirmTimePicker}
                    className="px-4 py-1.5 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-500 transition"
                  >
                    Speichern
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STATION MODAL */}
          {showStationModal && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <form onSubmit={handleAddStation} className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-md space-y-4">
                <h3 className="text-sm font-semibold text-slate-100">Neue Station</h3>
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