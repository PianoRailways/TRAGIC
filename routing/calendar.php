<?php
ini_set('display_errors', '0');

$ics = $_POST['ics'] ?? $_GET['ics'] ?? '';
$filename = $_POST['filename'] ?? $_GET['filename'] ?? 'TRAGIC-Verbindung.ics';
$filename = preg_replace('/[^A-Za-z0-9._-]+/', '-', basename($filename)) ?: 'TRAGIC-Verbindung.ics';

if ($ics === '' || strlen($ics) > 100000 || strpos($ics, 'BEGIN:VCALENDAR') !== 0) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Ungültige Kalenderdatei.';
    exit;
}

header('Content-Type: text/calendar; charset=utf-8');
header('Content-Disposition: inline; filename="' . $filename . '"');
header('Cache-Control: no-store');
echo $ics;
