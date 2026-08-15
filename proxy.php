<?php
/**
 * Transitous-Proxy für NOWE-Weltweit
 * -----------------------------------
 * Aktionen:
 *   ?action=search&query=Zuerich
 *   ?action=departures&stopId=XYZ&n=12&time=2026-07-04T14:23:00Z
 *   ?action=trip&tripId=XYZ
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

const BASE_URL   = 'https://api.transitous.org';
const USER_AGENT = 'NOWE-TRAGIC/0.2 (+https://tragic.stellwerksim.ch; piano@stellwerksim.ch)';

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

function extractPair($place, string $type): array {
    if (!is_array($place)) return [null, null];

    if (isset($place[$type]) && is_array($place[$type])) {
        $obj = $place[$type];
        $sched = $obj['scheduledTime'] ?? $obj['scheduled'] ?? null;
        $live  = $obj['time'] ?? $obj['estimated']['time'] ?? $obj['actualTime'] ?? $sched;
        return [toEpoch($sched !== null ? (string)$sched : null), toEpoch($live !== null ? (string)$live : null)];
    }

    $prefix = $type;
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

// ------------------------------------------------------------ departures / arrivals --
if ($action === 'departures' || $action === 'arrivals') {
    $stopId   = trim($_GET['stopId'] ?? '');
    $n        = (int)($_GET['n'] ?? 25);
    $time     = trim($_GET['time'] ?? '');
    $arrivals = filter_var($_GET['arrivals'] ?? false, FILTER_VALIDATE_BOOLEAN);

    if ($stopId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Parameter "stopId" fehlt']);
        exit;
    }

    if (preg_match('/^(node|way|relation)\//i', $stopId)) {
        echo json_encode([
            'stopId'     => $stopId,
            'departures' => [],
            '_raw_count' => 0,
            'note'       => 'OSM-Elemente besitzen keine Fahrplandaten'
        ]);
        exit;
    }

    // Zeitstempel verarbeiten & Toleranzfenster bei Ankünften anwenden
    $formattedTime = '';
    if ($time !== '') {
        $refEpoch = strtotime($time);
        if ($refEpoch !== false) {
            if ($arrivals) {
                $refEpoch -= 360;
            }
            $formattedTime = date('c', $refEpoch);
        }
    } else if ($arrivals) {
        $formattedTime = date('c', time() - 420);
    }

    $params = [
        'stopId'    => $stopId,
        'n'         => max(1, min($n, 50)),
        'arriveBy'  => $arrivals ? 'true' : 'false',
        'direction' => 'LATER', // Zwingt MOTIS, vorwärts ab dem Zeitpunkt zu suchen
    ];

    if ($formattedTime !== '') {
        $params['time'] = $formattedTime;
    }

    $result = callTransitous('/api/v1/stoptimes', $params);

    if (isset($result['error'])) {
        echo json_encode($result);
        exit;
    }

    $rawEntries = $result['stopTimes'] ?? $result['results'] ?? (is_array($result) ? $result : []);

    $departures = [];
    $typeKey = $arrivals ? 'arrival' : 'departure';

    foreach ($rawEntries as $entry) {
        if (!is_array($entry)) continue;

        $place = $entry['place'] ?? $entry;

        [$schedEpoch, $liveEpoch] = extractPair($place, $typeKey);

        if ($schedEpoch === null) {
            $schedCandidates = $arrivals 
                ? ['scheduledTime', 'scheduledArrival'] 
                : ['scheduledTime', 'scheduledDeparture'];
            $liveCandidates  = $arrivals 
                ? ['time', 'realTimeArrival'] 
                : ['time', 'realTimeDeparture'];

            $sched = extractTime($place, $schedCandidates);
            $live  = extractTime($place, $liveCandidates);
            $schedEpoch = toEpoch($sched);
            $liveEpoch  = toEpoch($live) ?? $schedEpoch;
        }

        $delaySec = delaySeconds($schedEpoch, $liveEpoch);

        // Herkunft / Ziel je nach Modus bestimmen
        $destination = $arrivals 
            ? ($entry['tripFrom'] ?? $entry['origin'] ?? $entry['headsign'] ?? '')
            : ($entry['headsign'] ?? $entry['tripTo'] ?? '');

        $departures[] = [
            'tripId'      => $entry['tripId'] ?? null,
            'line'        => $entry['routeShortName'] ?? '?',
            'tripNumber'  => $entry['tripShortName'] ?? $entry['displayName'] ?? null,
            'destination' => $destination,
            'scheduled'   => $schedEpoch,
            'live'        => $liveEpoch,
            'delayMin'    => $delaySec !== null ? (int)round($delaySec / 60) : null,
            'delaySec'    => $delaySec,
            'track'       => $place['track'] ?? $place['scheduledTrack'] ?? null,
            'cancelled'   => (bool)($entry['cancelled'] ?? false),
            'realTime'    => (bool)($entry['realTime'] ?? false),
            'mode'        => $entry['mode'] ?? null,
            'agencyId'    => $entry['agencyId'] ?? null,
            'agencyName'  => $entry['agencyName'] ?? null,
            'agencyUrl'   => $entry['agencyUrl'] ?? null,
            'routeId'     => $entry['routeId'] ?? null,
        ];
    }

    echo json_encode([
        'stopId'     => $stopId,
        'arrivals'   => $arrivals,
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

    $stops = [];
    
    foreach ($legs as $legIdx => $leg) {
        if (!is_array($leg)) continue;

        $placesRaw = [];
        if (isset($leg['from'])) $placesRaw[] = $leg['from'];
        foreach (($leg['intermediateStops'] ?? []) as $stop) $placesRaw[] = $stop;
        if (isset($leg['to'])) $placesRaw[] = $leg['to'];

        foreach ($placesRaw as $placeIdx => $place) {
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
                'pickupType'        => $place['pickupType'] ?? 'NORMAL',
                'dropoffType'       => $place['dropoffType'] ?? 'NORMAL',
                'legIndex'          => $legIdx,
            ];
        }
    }

    $legInfos = [];
    foreach ($legs as $idx => $leg) {
        if (!is_array($leg)) continue;
        $legInfos[$idx] = [
            'line'        => $leg['routeShortName'] ?? '?',
            'tripNumber'  => $leg['tripShortName'] ?? $leg['displayName'] ?? null,
            'destination' => $leg['headsign'] ?? null,
            'routeType'   => $leg['routeType'] ?? null,
        ];
    }

    $leg = $legs[0] ?? [];

    echo json_encode([
        'tripId'      => $decodedTripId,
        'line'        => $leg['routeShortName'] ?? '?',
        'tripNumber'  => $leg['tripShortName'] ?? $leg['displayName'] ?? null,
        'destination' => $leg['headsign'] ?? null,
        'routeType'            => $leg['routeType'] ?? null,
        'bikesAllowed'         => $leg['bikesAllowed'] ?? null,
        'wheelchairAccessible' => $leg['wheelchairAccessible'] ?? null,
        'agency'      => [
            'id'   => $leg['agencyId'] ?? null,
            'name' => $leg['agencyName'] ?? null,
            'url'  => $leg['agencyUrl'] ?? null,
        ],
        'stops'       => $stops,
        'legInfos'    => $legInfos,
        'legCount'    => count($legs),
        '_raw_leg_count' => count($legs),
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Unbekannte oder fehlende "action". Nutze "search", "departures" oder "trip".']);