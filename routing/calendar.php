<?php
/**
 * Kalender-Export für Mobilgeräte
 *
 * Ablauf (zwei Schritte, weil iOS die URL nach dem Öffnen einer .ics erneut per GET abruft
 * und ein POST-Ergebnis dabei leer wäre):
 *   1. POST calendar.php?action=store   (Feld "ics")  ->  {"id": "..."}
 *   2. GET  calendar.php?id=...&filename=...           ->  .ics-Datei
 *
 * Direktaufruf mit ics per POST/GET bleibt als Fallback erhalten.
 */
ini_set('display_errors', '0');

const ICS_MAX_BYTES = 100000;
const ICS_TTL       = 3600;
const ICS_PREFIX    = 'tragic-ics-';

function sanitizeFilename(string $name): string {
    $clean = preg_replace('/[^A-Za-z0-9._-]+/', '-', basename($name));
    return $clean ?: 'TRAGIC-Verbindung.ics';
}

function icsError(?string $ics): ?string {
    if ($ics === null || $ics === '') return 'Kalenderdaten fehlen (leer).';
    if (strlen($ics) > ICS_MAX_BYTES)  return 'Kalenderdatei ist zu gross.';
    if (strpos($ics, 'BEGIN:VCALENDAR') !== 0) return 'Ungültige Kalenderdatei.';
    return null;
}

function sendIcs(string $ics, string $filename): void {
    header('Content-Type: text/calendar; method=PUBLISH; charset=utf-8');
    header('Content-Disposition: inline; filename="' . $filename . '"');
    header('Cache-Control: no-store');
    echo $ics;
    exit;
}

function failText(int $code, string $message): void {
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

function failJson(int $code, string $message): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message]);
    exit;
}

function cleanupOld(string $dir): void {
    foreach (glob($dir . '/' . ICS_PREFIX . '*.ics') ?: [] as $file) {
        if (@filemtime($file) < time() - ICS_TTL) @unlink($file);
    }
}

$action   = $_GET['action'] ?? '';
$filename = sanitizeFilename($_POST['filename'] ?? $_GET['filename'] ?? 'TRAGIC-Verbindung.ics');
$dir      = sys_get_temp_dir();

// ---- Schritt 1: speichern ------------------------------------------------
if ($action === 'store') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') failJson(405, 'Nur POST erlaubt.');

    $ics = $_POST['ics'] ?? '';
    $error = icsError($ics);
    if ($error) failJson(400, $error);

    cleanupOld($dir);

    $id = bin2hex(random_bytes(16));
    if (@file_put_contents($dir . '/' . ICS_PREFIX . $id . '.ics', $ics) === false) {
        failJson(500, 'Kalenderdatei konnte nicht zwischengespeichert werden.');
    }

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['id' => $id]);
    exit;
}

// ---- Schritt 2: abrufen --------------------------------------------------
$id = $_GET['id'] ?? '';
if ($id !== '') {
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) failText(400, 'Ungültige Kalender-ID.');

    $path = $dir . '/' . ICS_PREFIX . $id . '.ics';
    if (!is_file($path) || filemtime($path) < time() - ICS_TTL) {
        failText(404, 'Kalenderdatei abgelaufen. Bitte erneut exportieren.');
    }

    $ics = (string)file_get_contents($path);
    $error = icsError($ics);
    if ($error) failText(400, $error);

    sendIcs($ics, $filename);
}

// ---- Fallback: ics direkt mitgeschickt -------------------------------------
$ics = $_POST['ics'] ?? $_GET['ics'] ?? '';
$error = icsError($ics);
if ($error) failText(400, $error);

sendIcs($ics, $filename);