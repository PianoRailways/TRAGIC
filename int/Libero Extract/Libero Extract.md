Libero Extract

Hier ist die Schritt-für-Schritt-Anleitung, um die Daten aus deiner PDF-Datei sauber in das gewünschte Format zu konvertieren.

Schritt 1: Text aus dem PDF kopieren
Öffne dein PDF-Dokument auf dem Mac in der Vorschau-App (oder in deinem bevorzugten PDF-Reader).

Drücke Cmd + A, um den gesamten Text zu markieren.

Drücke Cmd + C, um den Text zu kopieren.

Schritt 2: Textdatei auf dem Mac anlegen
Öffne das Terminal (über Spotlight: Cmd + Leertaste -> Terminal eingeben).

Navigiere in den Ordner, in dem du arbeiten möchtest (z. B. den Schreibtisch):

Bash
cd ~/Desktop
Erstelle die Datei haltestellen.txt direkt aus deiner Zwischenablage mit diesem Befehl:

Bash
pbpaste > haltestellen.txt
Schritt 3: Python-Skript erstellen
Erstelle im selben Ordner eine Datei namens parse.py mit folgendem Inhalt:

Python
import json

# Liest die Rohdaten aus der kopierten Textdatei
with open("haltestellen.txt", "r", encoding="utf-8") as f:
    lines = f.readlines()

result = {}

for line in lines:
    line = line.strip()

    # Überspringt leere Zeilen und Kopfzeilen
    if (
        not line
        or line.startswith("Anhang")
        or line.startswith("Haltestellen")
    ):
        continue

    # Trennt die Zeile von rechts nach links auf:
    # 1. Element von rechts: Abkürzung (z. B. 310AAZE)
    # 2. Element von rechts: Linien/Zonen-Nummer (z. B. 310)
    # Rest links: Name der Haltestelle (z. B. Aarberg, Aarezelg)
    parts = line.rsplit(maxsplit=2)

    if len(parts) == 3:
        name = parts[0].strip()
        code = parts[2].strip()

        result[code] = name

# Speichert das Ergebnis als formatierte JSON-Datei
with open("haltestellen.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=4)

print(f"Fertig! Es wurden {len(result)} Haltestellen verarbeitet.")
Schritt 4: Skript ausführen
Führe das Skript im Terminal aus:

Bash
python3 parse.py
Danach findest du im selben Ordner die Datei haltestellen.json mit der fertigen Zuordnung von Abkürzung zu Haltestellenname.