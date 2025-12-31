/* global L, EMBEDDED_SOURCES */

const DEFAULT_VIEW = { lat: 48.8566, lng: 2.3522, zoom: 13 };

const map = L.map("map").setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const userMarker = L.circleMarker(map.getCenter(), {
  radius: 8,
  color: "#0ea5e9",
  weight: 2,
  fillColor: "#0ea5e9",
  fillOpacity: 0.35,
}).addTo(map);

const legend = L.control({ position: "topright" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = `
    <div class="legend-header">
      <h4>Audio sources</h4>
      <button id="legendToggle" class="legend-toggle" type="button" aria-expanded="true" title="Hide/Show legend">Hide</button>
    </div>
    <div id="legend-items"></div>
    <div class="footer">
      <b>Tip:</b> click on the map to simulate your position.<br/>
      Circles: <b>black outline</b> + coloured transparent fill (stronger when closer).
    </div>
  `;
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);
  return div;
};
legend.addTo(map);

function setLegendCollapsed(isCollapsed) {
  const el = document.querySelector(".legend");
  const btn = document.getElementById("legendToggle");
  if (!el || !btn) return;
  el.classList.toggle("collapsed", isCollapsed);
  btn.textContent = isCollapsed ? "Show" : "Hide";
  btn.setAttribute("aria-expanded", String(!isCollapsed));
}

function wireLegendToggle() {
  const btn = document.getElementById("legendToggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const el = document.querySelector(".legend");
    const collapsed = el && el.classList.contains("collapsed");
    setLegendCollapsed(!collapsed);
  });
}

wireLegendToggle();

function renderLegend(rowsHtml) {
  const el = document.getElementById("legend-items");
  if (el) el.innerHTML = rowsHtml;
}

function makeIcon(emoji) {
  const html = `<div class="icon-badge"><span>${emoji}</span></div>`;
  return L.divIcon({
    className: "",
    html,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

let audioCtx = null;
let usingGPS = false;

function safeNumber(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function safeVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}


function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

/**
 * 0..1 attenuation curve.
 * volume=1 within minD, volume=0 from maxD onwards.
 */
function attenuation(d, minD, maxD, exponent = 1.8) {
  d = safeNumber(d, Infinity);
  minD = safeNumber(minD, 0);
  maxD = safeNumber(maxD, 0);
  exponent = safeNumber(exponent, 1.8);

  if (!Number.isFinite(d)) return 0;
  if (maxD <= minD) return 0;

  if (d <= minD) return 1;
  if (d >= maxD) return 0;

  const t = (d - minD) / (maxD - minD);
  return safeVolume(Math.pow(1 - t, exponent));
}

function smoothGain(gainNode, target) {
  const now = audioCtx.currentTime;
  const t = safeVolume(target);

  gainNode.gain.cancelScheduledValues(now);

  // Snap to 0 to avoid "ghost audio" if something went wrong upstream.
  if (t <= 0.001) {
    gainNode.gain.setValueAtTime(0, now);
    return;
  }

  // Smooth ramp (no clicks)
  gainNode.gain.setTargetAtTime(t, now, 0.12);
}

function updateCircleStyle(source, vol) {
  // Circle outline MUST be black; fill stays per-source color.
  // Always transparent, but intensity increases as you get closer.
  const fill = 0.04 + vol * 0.30;   // 0.04..0.34
  const stroke = 0.45 + vol * 0.45; // 0.45..0.90

  source.circle.setStyle({
    color: "#000000",
    opacity: Math.min(0.90, stroke),
    fillOpacity: Math.min(0.35, fill),
  });
}

function initScene(sources) {
  // Create Leaflet layers + keep audioUri in memory
  for (const s of sources) {
    s.latlng = L.latLng(s.lat, s.lng);

    s.marker = L.marker(s.latlng, { icon: makeIcon(s.icon) })
      .addTo(map)
      .bindPopup(`${s.icon} ${s.label}`);

    s.circle = L.circle(s.latlng, {
      radius: s.maxD,
      color: "#000000",
      weight: 3,
      opacity: 0.55,
      fillColor: s.fillColor,
      fillOpacity: 0.05,
    }).addTo(map);
  }

  renderLegend(
    sources
      .map(
        (s) => `
        <div class="item">
          <div class="swatch" style="background:${s.fillColor}; opacity: 0.35;"></div>
          <div class="meta">
            <b>${s.icon} ${s.label}</b>
            <small>max=${s.maxD}m · min=${s.minD}m</small>
          </div>
        </div>
      `
      )
      .join("")
  );

  function updateForUserPos(userPos, label = "SIM") {
    userMarker.setLatLng(userPos);

    const statusLines = [];
    let audibleCount = 0;
    let legendRows = "";

    for (const s of sources) {
      const d = safeNumber(userPos.distanceTo(s.latlng), Infinity);
      const vol = attenuation(d, s.minD, s.maxD, s.exponent);

      if (vol > 0.02) audibleCount++;

      if (audioCtx && s.gainNode) smoothGain(s.gainNode, vol);

      updateCircleStyle(s, vol);

      statusLines.push(`${s.icon} ${s.label}: d=${d.toFixed(0)}m vol=${vol.toFixed(2)}`);

      legendRows += `
        <div class="item">
          <div class="swatch" style="background:${s.fillColor}; opacity: 0.35;"></div>
          <div class="meta">
            <b>${s.icon} ${s.label}</b>
            <small>d=${d.toFixed(0)}m · vol=${vol.toFixed(2)} · max=${s.maxD}m</small>
          </div>
        </div>
      `;
    }

    renderLegend(legendRows);

    statusLines.push("");
    statusLines.push(
      audibleCount >= 2
        ? "✅ OVERLAP AREA: you are hearing multiple sources at once"
        : audibleCount === 1
          ? "ℹ️ You are hearing 1 source"
          : "🔇 No source audible here"
    );

    setStatus(`[${label}]\n` + statusLines.join("\n"));
  }

  async function startAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // On mobile (especially iOS), ensure the context is running inside the click gesture.
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    setStatus("Loading audio… (first time only)");

    // iOS Safari can block starting multiple <audio>.play() calls in one gesture.
    // To be mobile-safe, we decode each embedded data: URI into an AudioBuffer and use BufferSourceNodes.
    for (const s of sources) {
      // Gain per source (for distance-based volume)
      s.gainNode = audioCtx.createGain();
      s.gainNode.gain.value = 0;
      s.gainNode.connect(audioCtx.destination);

      const resp = await fetch(s.audioUri);
      const arrayBuf = await resp.arrayBuffer();

      // decodeAudioData API differs slightly across browsers (promise vs callback)
      const audioBuf = await new Promise((resolve, reject) => {
        const p = audioCtx.decodeAudioData(arrayBuf, resolve, reject);
        if (p && typeof p.then === "function") p.then(resolve).catch(reject);
      });

      s.buffer = audioBuf;

      const src = audioCtx.createBufferSource();
      src.buffer = audioBuf;
      src.loop = true;
      src.connect(s.gainNode);
      src.start(0);

      s.sourceNode = src;
    }

    // GPS support: works on https/localhost; file:// often blocks it.
    const canTryGPS = window.isSecureContext && navigator.geolocation;

    if (canTryGPS) {
      usingGPS = true;
      setStatus("Audio started. GPS enabled: waiting for position…");
      navigator.geolocation.watchPosition(
        (pos) => {
          const userPos = L.latLng(pos.coords.latitude, pos.coords.longitude);
          updateForUserPos(userPos, "GPS");
        },
        (err) => {
          usingGPS = false;
          setStatus(
            "GPS not available / permission denied. Click on the map to simulate position. (" +
              (err && err.message ? err.message : err) +
              ")"
          );
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      );
    } else {
      usingGPS = false;
      setStatus("GPS is usually blocked in file://. Click on the map to simulate position.");
    }

    document.getElementById("startAudio").disabled = true;
  }

  document.getElementById("startAudio").addEventListener("click", () => {
    startAudio().catch((e) => setStatus("Start audio failed: " + e));
  });

  map.on("click", (e) => {
    updateForUserPos(e.latlng, usingGPS ? "SIM (override)" : "SIM");
  });

  setStatus("Ready. Click “Start audio”, then click on the map to simulate your position.");
}

(function main() {
  const sources = (window.EMBEDDED_SOURCES || []).map((s) => ({ ...s }));
  if (!sources.length) {
    setStatus("No embedded data found (EMBEDDED_SOURCES is empty).");
    return;
  }
  initScene(sources);
})();
