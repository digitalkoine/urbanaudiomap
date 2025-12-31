README — Hybrid no-server version (embedded runtime + editable data folder)

You asked for:
- No server to run the map
- Still keep a data folder with audio + JSON

How it works:
- The map uses js/embedded_data.js at runtime (JSON + audio are embedded as data: URIs).
- The editable files are in data/ (data/sources.json + data/audio/*.wav).
- When you edit data/sources.json or replace audio files, run tools/build_embed.py to rebuild the embedded file.

Run (no server):
1) Unzip
2) Double-click index.html
3) Click "Start audio"
4) Click on the map to simulate your position

Rebuild embedded data after edits:
- Windows:  py tools\build_embed.py
- macOS/Linux:  python3 tools/build_embed.py

Notes:
- GPS is usually blocked in file:// contexts; click simulation always works.
- Leaflet and tiles are loaded from the internet (CDN + OSM tiles).
