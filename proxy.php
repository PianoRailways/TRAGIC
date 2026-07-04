<?php
/**
 * Transitous-Proxy für NOWE-Weltweit
 * -----------------------------------
 * Zwei Aktionen:
 *   ?action=search&query=Zuerich          -> Stationssuche (Geocoding)
 *   ?action=departures&stopId=XYZ&n=12     -> Abfahrtstabelle
 *
 * WICHTIG: Trage unten Kontaktinfos ein (User-Agent-Pflicht laut Transitous Usage Policy).
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *'); // bei Bedarf auf deine Domain einschränken

const BASE_URL   = 'https://api.transitous.org';
const USER_AGENT = 'NOWE-Transitous/0.1 (+https://DEINE-DOMAIN.tld; DEINE-EMAIL@example.com)';

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
 * Extrahiert robust einen Zeitwert aus einer Place-Struktur, egal ob als
 * ISO-String oder als Unix-Timestamp geliefert, und egal unter welchem
 * Feldnamen (verschiedene MOTIS-Versionen benennen das leicht unterschiedlich).
 */
function extractTime(array $place, array $candidates): ?string {
    foreach ($candidates as $key) {
        if (isset($place[$key])) {
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

$action = $_GET['action'] ?? '';

if ($action === 'search') {
    $query = trim($_GET['query'] ?? '');
    if ($query === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Parameter "query" fehlt']);
        exit;
    }

    $result = callTransitous('/api/v1/geocode', ['text' => $query]);

    // Antwort ist typischerweise ein Array von Locations mit "name", "id"/"stopId", "lat", "lon"
    $stations = [];
    $list = is_array($result) ? $result : [];
    foreach ($list as $entry) {
        if (!is_array($entry)) continue;
        $stations[] = [
            'id'   => $entry['id'] ?? $entry['stopId'] ?? null,
            'name' => $entry['name'] ?? '(unbenannt)',
            'lat'  => $entry['lat'] ?? null,
            'lon'  => $entry['lon'] ?? null,
        ];
    }

    echo json_encode(['stations' => $stations, '_raw_count' => count($list)]);
    exit;
}

if ($action === 'departures') {
    $stopId = trim($_GET['stopId'] ?? '');
    $n      = (int)($_GET['n'] ?? 12);

    if ($stopId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Parameter "stopId" fehlt']);
        exit;
    }

    $result = callTransitous('/api/v1/stoptimes', [
        'stopId' => $stopId,
        'n'      => max(1, min($n, 50)),
    ]);

    if (isset($result['error'])) {
        echo json_encode($result);
        exit;
    }

    $rawEntries = $result['stopTimes'] ?? $result['results'] ?? (is_array($result) ? $result : []);

    $departures = [];
    foreach ($rawEntries as $entry) {
        if (!is_array($entry)) continue;

        $place = $entry['place'] ?? $entry;

        $scheduled = extractTime($place, ['scheduledTime', 'scheduledDeparture', 'departureScheduled']);
        $live      = extractTime($place, ['time', 'departure', 'realTimeDeparture']);

        $schedEpoch = toEpoch($scheduled);
        $liveEpoch  = toEpoch($live) ?? $schedEpoch;

        $delayMin = null;
        if ($schedEpoch !== null && $liveEpoch !== null) {
            $delayMin = (int)round(($liveEpoch - $schedEpoch) / 60);
        }

        $departures[] = [
            'line'        => $entry['routeShortName'] ?? $entry['tripShortName'] ?? '?',
            'destination' => $entry['headsign'] ?? $entry['tripTo'] ?? '',
            'scheduled'   => $schedEpoch,
            'live'        => $liveEpoch,
            'delayMin'    => $delayMin,
            'track'       => $place['track'] ?? $place['scheduledTrack'] ?? null,
            'cancelled'   => (bool)($entry['cancelled'] ?? false),
            'realTime'    => (bool)($entry['realTime'] ?? false),
        ];
    }

    echo json_encode([
        'stopId'     => $stopId,
        'departures' => $departures,
        '_raw_count' => count($rawEntries),
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Unbekannte oder fehlende "action". Nutze "search" oder "departures".']);