# Urbana Audio Map (Leaflet) — Proximity Soundscape

A small experimental web map that mixes multiple **looped sound sources** (siren, traffic, protest, concerts, roadworks…) and lets the user “walk” through them: the **closer you are to a source, the louder it becomes**, and where circles overlap you can **hear multiple sounds at once**.

The visual layer mirrors the audio logic: each source is represented by a **transparent coloured circle** (fill colour differs by source), with a **black outline**. The circle’s opacity increases as you get closer, while remaining transparent to preserve map readability.

## Live demo
You can view the map here:  
https://digitalkoine.github.io/urbanaudiomap/

## Features
- **Leaflet-based map** with OpenStreetMap tiles
- **Multiple simultaneous audio sources** mixed in real time (Web Audio API)
- **Distance-based attenuation** (configurable `minD`, `maxD`, `exponent`)
- **Overlap zones**: when two or more sources are audible, you hear them together
- **Accessible symbols** for sources (icon badges)
- **Legend (top-right)** with per-source info (max range, distance, volume)
- **No-server runtime** option: opens via double click (file://) using embedded audio + JSON

## How it works
Each audio source has:
- a geographic point (lat/lng)
- an audible range (min/max distance)
- an attenuation curve exponent
- a colour and symbol
- an audio loop

On each position update, the app:
1. computes distance between user position and each source
2. converts distance into a volume value (0..1)
3. updates each source gain node (smooth ramp to avoid clicks)
4. updates circle opacity to reflect proximity

## Data model (`data/sources.json`)
Sources are defined in `data/sources.json`:

```json
{
  "sources": [
    {
      "id": "siren",
      "label": "Siren",
      "lat": 48.8572,
      "lng": 2.3515,
      "minD": 20,
      "maxD": 300,
      "exponent": 2.0,
      "fillColor": "#e11d48",
      "icon": "🚨",
      "audio": "data/audio/siren.wav"
    }
  ]
}

Project structure
/
├─ index.html
├─ css/
│  └─ style.css
├─ js/
│  ├─ app.js
│  └─ embedded_data.js
├─ data/
│  ├─ sources.json
│  └─ audio/
│     ├─ siren.wav
│     ├─ traffic.wav
│     └─ ...
└─ tools/
   └─ build_embed.py
