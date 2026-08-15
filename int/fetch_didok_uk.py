import urllib.request
import re
import json
from html.parser import HTMLParser

class StationParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_tr = False
        self.in_td = False
        self.current_row = []
        self.current_cell = ""
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.in_tr = True
            self.current_row = []
        elif tag in ("td", "th") and self.in_tr:
            self.in_td = True
            self.current_cell = ""

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.in_td:
            self.in_td = False
            self.current_row.append(self.current_cell.strip())
        elif tag == "tr" and self.in_tr:
            self.in_tr = False
            if self.current_row:
                self.rows.append(self.current_row)

    def handle_data(self, data):
        if self.in_td:
            self.current_cell += data

def scrape_uk_stations():
    stations = {}
    alphabet = [chr(i) for i in range(ord('A'), ord('Z') + 1)]

    print("Starte Abruf A–Z von Wikipedia...")
    for letter in alphabet:
        url = f"https://en.wikipedia.org/wiki/UK_railway_stations_%E2%80%93_{letter}"
        req = urllib.request.Request(
            url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        try:
            with urllib.request.urlopen(req) as response:
                html = response.read().decode('utf-8')
                parser = StationParser()
                parser.feed(html)
                
                for row in parser.rows:
                    if len(row) >= 3:
                        name = row[0]
                        # Suche nach dem dreistelligen CRS-Code
                        code = None
                        for cell in row[1:]:
                            cell_clean = cell.strip()
                            if len(cell_clean) == 3 and cell_clean.isupper() and cell_clean.isalpha():
                                code = cell_clean
                                break
                        
                        if code and name and name != "Station name":
                            name_clean = re.sub(r'\[.*?\]', '', name).strip()
                            stations[code] = name_clean
            print(f"  [+] Buchstabe {letter} verarbeitet")
        except Exception as e:
            print(f"  [-] Fehler bei Buchstabe {letter}: {e}")

    with open("uk_stations.json", "w", encoding="utf-8") as f:
        json.dump(stations, f, ensure_ascii=False, indent=2)

    print(f"\nFertig! {len(stations)} Bahnhöfe wurden in 'uk_stations.json' gespeichert.")

if __name__ == "__main__":
    scrape_uk_stations()