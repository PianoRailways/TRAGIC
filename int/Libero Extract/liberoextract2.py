import json

# Liest die Datei 'haltestellen.txt'
with open("haltestellen.txt", "r", encoding="utf-8") as f:
    lines = f.readlines()

result = {}

for line in lines:
    line = line.strip()
    if not line or line.startswith("Anhang") or line.startswith("Haltestellen"):
        continue  # Überspringt Überschriften

    # Trennt die Zeile von rechts nach links auf:
    # 1. Trennung: Abkürzung (ganz rechts)
    # 2. Trennung: Nummer (in der Mitte)
    parts = line.rsplit(maxsplit=2)

    if len(parts) == 3:
        name = parts[0].strip()
        code = parts[2].strip()

        result[code] = name

# Ausgabe im Terminal
print(json.dumps(result, ensure_ascii=False, indent=4))

# Speichert das Ergebnis direkt in eine JSON-Datei
with open("haltestellen.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=4)