#!/usr/bin/env python3

import requests
import json
import time

# Liste der Bahnhöfe, die wir abfragen wollen
stations = [
    # SCHWEIZ
    'Basel SBB',
    'Zürich HB',
    'Bern',
    'Luzern',
    'Bellinzona',
    'Biel/Bienne',
    'Brig',
    'Olten',
    'Spiez',
    'Winterthur',
    'Zug',
    'Zofingen',
    'Zürich Altstetten',
    'Zürich Flughafen',
    'Zürich Oerlikon',
    'Aarau',
    'Arth-Goldau',
    'Baden',
    'Brugg AG',
    'Buchs SG',
    'Chur',
    'Genève',
    'Genève-Aéroport',
    'Landquart',
    'Lausanne',
    'Neuchâtel',
    'Renens VD',
    'Romanshorn',
    'Sargans',
    'Schaffhausen',
    'St. Gallen',
    'St. Margrethen',
    'Thalwil',
    'Thun',
    'Visp',
    'Weinfelden',
    'Yverdon-les-Bains',
    'Ziegelbrücke',
    'Langenthal',
    
    # DEUTSCHLAND
    'Berlin Hauptbahnhof',
    'Hamburg Hauptbahnhof',
    'Frankfurt (Main) Hauptbahnhof',
    'München Hauptbahnhof',
    'Stuttgart Hauptbahnhof',
    'Basel Badischer Bahnhof',
    'Köln Hauptbahnhof',
    'Düsseldorf Hauptbahnhof',
    'Hannover Hauptbahnhof',
    'Karlsruhe Hauptbahnhof',
    'Dortmund Hauptbahnhof',
    'Nürnberg Hauptbahnhof',
    'Mannheim Hauptbahnhof',
    
    # FRANKREICH
    'Mulhouse-Ville',
    'Strasbourg',
    'Lyon Part-Dieu',
    'Paris Gare de l\'Est',
    'Paris Gare de Lyon',
    
    # ÖSTERREICH
    'Wien Hauptbahnhof',
    'Innsbruck Hauptbahnhof',
    'Linz Hauptbahnhof',
    'Salzburg Hauptbahnhof',
    
    # ITALIEN
    'Milano Centrale',
    'Verona Porta Nuova',
]

def query_transitous(station_name, proxy_url):
    """Abfrage einzelner Station via PHP-Proxy"""
    try:
        params = {'action': 'search', 'query': station_name}
        response = requests.get(proxy_url, params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        
        if data.get('stations') and len(data['stations']) > 0:
            stop = data['stations'][0]
            return {
                'name': station_name,
                'id': stop.get('id'),
                'transitousName': stop.get('name'),
                'lat': stop.get('lat'),
                'lon': stop.get('lon'),
            }
        else:
            error_msg = data.get('error', 'Not found')
            return {
                'name': station_name,
                'id': None,
                'transitousName': None,
                'error': error_msg
            }
    except Exception as e:
        return {
            'name': station_name,
            'id': None,
            'error': str(e)
        }

def main():
    proxy_url = input('PHP-Proxy URL (z.B. http://localhost/tragic/proxy.php): ').strip()
    if not proxy_url:
        print('Fehler: Proxy-URL erforderlich')
        return
    
    print(f'\nFetching via: {proxy_url}\n')
    results = []
    
    for i, station in enumerate(stations, 1):
        result = query_transitous(station, proxy_url)
        results.append(result)
        
        if result.get('id'):
            print(f'✓ [{i}/{len(stations)}] {station} => {result["id"]}')
        else:
            error = result.get('error', 'Not found')
            print(f'✗ [{i}/{len(stations)}] {station} => {error}')
        
        # Rate limiting
        time.sleep(0.1)
    
    print('\n' + '='*80)
    print('Complete Results (copy into TRAGIC):\n')
    print(json.dumps(results, indent=2, ensure_ascii=False))
    
    # Auch in Datei speichern
    with open('transitous_ids.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print('\n\nSaved to: transitous_ids.json')

if __name__ == '__main__':
    main()