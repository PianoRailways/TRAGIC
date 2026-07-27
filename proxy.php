<?php
/**
 * Transitous-Proxy für NOWE-Weltweit
 * -----------------------------------
 * Aktionen:
 *   ?action=search&query=Zuerich
 *   ?action=departures&stopId=XYZ&n=12&time=2026-07-04T14:23:00Z
 *   ?action=trip&tripId=XYZ
 *
 * WICHTIG: Trage unten Kontaktinfos ein (User-Agent-Pflicht laut Transitous Usage Policy).
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *'); // bei Bedarf auf deine Domain einschränken

const BASE_URL   = 'https://api.transitous.org';
const USER_AGENT = 'NOWE-TRAGIC/0.1 (+https://tragic.stellwerksim.ch; piano@stellwerksim.ch)';

function callTransitous(string $path, array $params): array {
    $url = BASE_URL . $path . '?' . http_build_query($params);

    $ctx = stream_context_create([
        'http' => [
            'method'  => 'GET',
            'header'  => "User-Agent: " . USER_AGENT . "\r\n",
            'timeout' => 8,
        ],
    ]);

    $raw = @file_get_contents($url, false, $ctx);

    if ($raw === false) {
        http_response_code(502);
        return ['error' => 'Transitous nicht erreichbar', 'url' => $url];
    }

    $data = json_decode($raw, true);
    if ($data === null) {
        http_response_code(502);
        return ['error' => 'Ungültige Antwort von Transitous', 'raw' => substr($raw, 0, 500)];
    }

    return $data;
}

/**
 * Holt robust einen Zeitwert aus einer Place-Struktur. Verschiedene MOTIS-
 * Versionen/Endpoints benennen das leicht unterschiedlich, und manche
 * verschachteln arrival/departure als eigenes Objekt mit scheduledTime/time.
 * Wir probieren mehrere Varianten durch, bis eine passt.
 */
function extractTime($place, array $candidates): ?string {
    if (!is_array($place)) return null;
    foreach ($candidates as $key) {
        if (isset($place[$key]) && !is_array($place[$key])) {
            return (string)$place[$key];
        }
    }
    return null;
}

function toEpoch(?string $value): ?int {
    if ($value === null || $value === '') return null;
    if (is_numeric($value)) return (int)$value;
    $ts = strtotime($value);
    return $ts === false ? null : $ts;
}

/**
 * Liefert [scheduledEpoch, liveEpoch] für arrival ODER departure an einer
 * Place-Struktur, egal ob flach (place.arrival = "...") oder verschachtelt
 * (place.arrival = {scheduledTime, time}) geliefert wird.
 */
function extractPair($place, string $type): array {
    if (!is_array($place)) return [null, null];

    // Variante A: verschachteltes Objekt, z.B. place['arrival']['scheduledTime']
    if (isset($place[$type]) && is_array($place[$type])) {
        $obj = $place[$type];
        $sched = $obj['scheduledTime'] ?? $obj['scheduled'] ?? null;
        $live  = $obj['time'] ?? $obj['estimated']['time'] ?? $obj['actualTime'] ?? $sched;
        return [toEpoch($sched !== null ? (string)$sched : null), toEpoch($live !== null ? (string)$live : null)];
    }

    // Variante B: flache Felder, z.B. place['scheduledArrival'], place['arrival']
    $prefix = $type; // 'arrival' oder 'departure'
    $sched = extractTime($place, [
        $prefix . 'Scheduled', 'scheduled' . ucfirst($prefix), $prefix . 'ScheduledTime',
    ]);
    $live = extractTime($place, [$prefix, $prefix . 'Time', 'real' . ucfirst($prefix)]);

    return [toEpoch($sched), toEpoch($live) ?? toEpoch($sched)];
}

function delaySeconds(?int $sched, ?int $live): ?int {
    if ($sched === null || $live === null) return null;
    return $live - $sched;
}

$action = $_GET['action'] ?? '';

// ---------------------------------------------------------------- search --
if ($action === 'search') {
    $query = trim($_GET['query'] ?? '');
    if ($query === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Parameter "query" fehlt']);
        exit;
    }

    $result = callTransitous('/api/v1/geocode', ['text' => $query]);

    $stations = [];
    $list = is_array($result) ? $result : [];
    foreach ($list as $entry) {
        if (!is_array($entry)) continue;

        $id = $entry['id'] ?? $entry['stopId'] ?? null;
        if (!$id) continue;

        // Einträge verwürfen, die mit node/, way/ oder relation/ beginnen
        if (preg_match('/^(node|way|relation)\//i', $id)) {
            continue;
        }

        $stations[] = [
            'id'   => $id,
            'name' => $entry['name'] ?? '(unbenannt)',
            'lat'  => $entry['lat'] ?? null,
            'lon'  => $entry['lon'] ?? null,
        ];
    }

    echo json_encode(['stations' => $stations, '_raw_count' => count($list)]);
    exit;
}

// ------------------------------------------------------------ departures --
if ($action === 'departures') {
    $stopId = trim($_GET['stopId'] ?? '');
    $n      = (int)($_GET['n'] ?? 25);
    $time   = trim($_GET['time'] ?? ''); // optional: ISO-Zeit als Referenzpunkt

    if ($stopId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Parameter "stopId" fehlt']);
        exit;
    }

    // Reine OSM-Elemente (node/..., way/..., relation/...) besitzen keine Fahrpläne.
    // Sie würden bei Transitous zu einem HTTP-Fehler führen und HTML zurückgeben.
    if (preg_match('/^(node|way|relation)\//i', $stopId)) {
        echo json_encode([
            'stopId'     => $stopId,
            'departures' => [],
            '_raw_count' => 0,
            'note'       => 'OSM-Elemente besitzen keine Fahrplandaten'
        ]);
        exit;
    }

    $params = [
        'stopId' => $stopId,
        'n'      => max(1, min($n, 50)),
    ];
    if ($time !== '') {
        $params['time'] = $time;
        $params['arriveBy'] = 'false'; // wir wollen Abfahrten NACH diesem Zeitpunkt
    }

    $result = callTransitous('/api/v1/stoptimes', $params);

    if (isset($result['error'])) {
        echo json_encode($result);
        exit;
    }

    $rawEntries = $result['stopTimes'] ?? $result['results'] ?? (is_array($result) ? $result : []);

    $departures = [];
    foreach ($rawEntries as $entry) {
        if (!is_array($entry)) continue;

        $place = $entry['place'] ?? $entry;

        [$schedEpoch, $liveEpoch] = extractPair($place, 'departure');
        // Fallback: manche Stoptimes-Antworten liefern die Zeit direkt am Place
        // ohne "departure"-Verschachtelung (siehe extractTime-Kandidaten).
        if ($schedEpoch === null) {
            $sched = extractTime($place, ['scheduledTime', 'scheduledDeparture']);
            $live  = extractTime($place, ['time', 'realTimeDeparture']);
            $schedEpoch = toEpoch($sched);
            $liveEpoch  = toEpoch($live) ?? $schedEpoch;
        }

        $delaySec = delaySeconds($schedEpoch, $liveEpoch);

        $departures[] = [
            'tripId'      => $entry['tripId'] ?? null,
            'line'        => $entry['routeShortName'] ?? '?',
            'tripNumber'  => $entry['tripShortName'] ?? $entry['displayName'] ?? null,
            'destination' => $entry['headsign'] ?? $entry['tripTo'] ?? '',
            'scheduled'   => $schedEpoch,
            'live'        => $liveEpoch,
            'delayMin'    => $delaySec !== null ? (int)round($delaySec / 60) : null,
            'delaySec'    => $delaySec,
            'track'       => $place['track'] ?? $place['scheduledTrack'] ?? null,
            'cancelled'   => (bool)($entry['cancelled'] ?? false),
            'realTime'    => (bool)($entry['realTime'] ?? false),
            'mode'        => $entry['mode'] ?? null,
        ];
    }

    echo json_encode([
        'stopId'     => $stopId,
        'departures' => $departures,
        '_raw_count' => count($rawEntries),
    ]);
    exit;
}

// ------------------------------------------------------------------ trip --
if ($action === 'trip') {
    $tripId = trim($_GET['tripId'] ?? '');
    if ($tripId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Parameter "tripId" fehlt']);
        exit;
    }

    $decodedTripId = urldecode($tripId);

    $params = [
        'tripId'             => $decodedTripId,
        'joinInterlinedLegs' => 'false',
        'language'           => 'de',
    ];

    $result = callTransitous('/api/v1/trip', $params);

    if (isset($result['error'])) {
        echo json_encode($result);
        exit;
    }

    $legs = $result['legs'] ?? [$result];
    $leg  = $legs[0] ?? [];

    $placesRaw = [];
    if (isset($leg['from'])) $placesRaw[] = $leg['from'];
    foreach (($leg['intermediateStops'] ?? []) as $stop) $placesRaw[] = $stop;
    if (isset($leg['to'])) $placesRaw[] = $leg['to'];

    $stops = [];
    foreach ($placesRaw as $place) {
        if (!is_array($place)) continue;

        [$arrSched, $arrLive] = extractPair($place, 'arrival');
        [$depSched, $depLive] = extractPair($place, 'departure');

        $isAdditional = (bool)($place['additional'] ?? false) ||
                        (($place['scheduleRelationship'] ?? '') === 'ADDED') ||
                        ($arrSched === null && $depSched === null && ($arrLive !== null || $depLive !== null));

        $arrSchedDisplay = $arrSched ?? $arrLive;
        $depSchedDisplay = $depSched ?? $depLive;

        $stops[] = [
            'stopId'            => $place['stopId'] ?? $place['id'] ?? null,
            'name'              => $place['name'] ?? '(unbenannt)',
            'arrivalSched'      => $arrSchedDisplay,
            'arrivalLive'       => $arrLive,
            'arrivalDelaySec'   => $arrSched !== null ? delaySeconds($arrSched, $arrLive) : 0,
            'departureSched'    => $depSchedDisplay,
            'departureLive'     => $depLive,
            'departureDelaySec' => $depSched !== null ? delaySeconds($depSched, $depLive) : 0,
            'track'             => $place['track'] ?? $place['scheduledTrack'] ?? null,
            'cancelled'         => (bool)($place['cancelled'] ?? false),
            'additional'        => $isAdditional,
            // Neu aus dem API-Antwortobjekt ausgelesen:
            'pickupType'        => $place['pickupType'] ?? 'NORMAL',
            'dropoffType'       => $place['dropoffType'] ?? 'NORMAL',
        ];
    }

    echo json_encode([
        'tripId'      => $decodedTripId,
        'line'        => $leg['routeShortName'] ?? '?',
        'tripNumber'  => $leg['tripShortName'] ?? $leg['displayName'] ?? null,
        'destination' => $leg['headsign'] ?? null,
        'routeType'            => $leg['routeType'] ?? null,
        'bikesAllowed'         => $leg['bikesAllowed'] ?? null,
        'wheelchairAccessible' => $leg['wheelchairAccessible'] ?? null,
        // Neu extrahierte Betreiberdaten:
        'agency'      => [
            'id'   => $leg['agencyId'] ?? null,
            'name' => $leg['agencyName'] ?? null,
            'url'  => $leg['agencyUrl'] ?? null,
        ],
        'stops'       => $stops,
        '_raw_leg_count' => count($legs),
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Unbekannte oder fehlende "action". Nutze "search", "departures" oder "trip".']);