/* global L, EMBEDDED_LIGHT_SOURCES */

const DEFAULT_VIEW = { lat: 48.8566, lng: 2.3522, zoom: 13 };

(function ensureTrailingSlashOnHttps(){
  try{
    if (!/^https?:$/.test(location.protocol)) return;
    const last = location.pathname.split("/").pop();
    const looksLikeFile = last.includes(".");
    if (!looksLikeFile && !location.pathname.endsWith("/")) {
      location.replace(location.pathname + "/" + location.search + location.hash);
    }
  }catch(e){}
})();

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

// Legend (toggle)
const legend = L.control({ position: "topright" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = `
    <div class="legend-header">
      <h4>Audio sources</h4>
      <button id="legendToggle" class="legend-toggle" type="button" aria-expanded="true">Hide</button>
    </div>
    <div id="legend-items"></div>
    <div class="footer">
      <b>Tip:</b> tap/click the map to simulate your position.<br/>
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
(function wireLegendToggle(){
  const btn = document.getElementById("legendToggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const el = document.querySelector(".legend");
    const collapsed = el && el.classList.contains("collapsed");
    setLegendCollapsed(!collapsed);
  });
})();

function renderLegend(rowsHtml) {
  const el = document.getElementById("legend-items");
  if (el) el.innerHTML = rowsHtml;
}

function makeIcon(emoji) {
  const html = `<div class="icon-badge"><span>${emoji}</span></div>`;
  return L.divIcon({ className: "", html, iconSize: [28, 28], iconAnchor: [14, 14] });
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function safeNumber(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function safeVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

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

let audioCtx = null;
let usingGPS = false;

function smoothGain(gainNode, target) {
  const now = audioCtx.currentTime;
  const t = safeVolume(target);

  gainNode.gain.cancelScheduledValues(now);
  if (t <= 0.001) {
    gainNode.gain.setValueAtTime(0, now);
    return;
  }
  gainNode.gain.setTargetAtTime(t, now, 0.12);
}

function updateCircleStyle(source, vol) {
  const fill = 0.04 + vol * 0.30;   // 0.04..0.34
  const stroke = 0.45 + vol * 0.45; // 0.45..0.90
  source.circle.setStyle({
    color: "#000000",
    opacity: Math.min(0.90, stroke),
    fillOpacity: Math.min(0.35, fill),
  });
}

// data:audio/... base64 → ArrayBuffer (mobile-safe, no fetch(data:))
function dataUriToArrayBuffer(dataUri) {
  const comma = dataUri.indexOf(",");
  if (comma === -1) throw new Error("Invalid data URI (no comma).");
  const meta = dataUri.slice(0, comma);
  const data = dataUri.slice(comma + 1);
  const isBase64 = /;base64/i.test(meta);
  if (!isBase64) throw new Error("Expected base64 data URI.");
  const bin = atob(data);
  const buf = new ArrayBuffer(bin.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return buf;
}

async function decodeAudioDataSafari(ctx, arrayBuf) {
  return await new Promise((resolve, reject) => {
    ctx.decodeAudioData(arrayBuf, resolve, reject);
  });
}

async function loadSourcesDual() {
  // If file:// → use embedded light sources (no fetch)
  if (location.protocol === "file:") {
    return { mode: "embedded", sources: (window.EMBEDDED_LIGHT_SOURCES || []).map(s => ({...s})) };
  }

  // On https/http try fetching sources.json; if it fails, fall back to embedded.
  const url = new URL("data/sources.json", window.location.href).toString();
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { mode: "fetch", sources: (data.sources || []).map(s => ({...s})) };
  } catch (e) {
    return { mode: "embedded", sources: (window.EMBEDDED_LIGHT_SOURCES || []).map(s => ({...s})) };
  }
}

function initScene(mode, sources) {
  // Create layers
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
      fillOpacity: 0.08,
    }).addTo(map);
  }

  renderLegend(
    sources.map(s => `
      <div class="item">
        <div class="swatch" style="background:${s.fillColor}; opacity: 0.35;"></div>
        <div class="meta">
          <b>${s.icon} ${s.label}</b>
          <small>max=${s.maxD}m · min=${s.minD}m</small>
        </div>
      </div>
    `).join("")
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

    setStatus(`[${label}] (mode=${mode})\n` + statusLines.join("\n"));
  }

  async function startAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    document.getElementById("startAudio").disabled = true;
    setStatus("Loading audio… (first time only)");

    for (const s of sources) {
      s.gainNode = audioCtx.createGain();
      s.gainNode.gain.value = 0;
      s.gainNode.connect(audioCtx.destination);

      let arrayBuf;
      if (mode === "fetch") {
        // Use external audio file
        const audioUrl = new URL(s.audio, window.location.href).toString();
        const resp = await fetch(audioUrl, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Audio fetch failed for ${s.label} (${resp.status})`);
        arrayBuf = await resp.arrayBuffer();
      } else {
        // Embedded LIGHT audio (data URI)
        arrayBuf = dataUriToArrayBuffer(s.audioUri);
      }

      const audioBuf = await decodeAudioDataSafari(audioCtx, arrayBuf);

      const src = audioCtx.createBufferSource();
      src.buffer = audioBuf;
      src.loop = true;
      src.connect(s.gainNode);
      src.start(0);

      s.sourceNode = src;
    }

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
          setStatus("GPS not available / permission denied. Tap/click map to simulate position. (" +
            (err && err.message ? err.message : err) + ")");
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      );
    } else {
      usingGPS = false;
      setStatus("Tap/click the map to simulate your position.");
    }
  }

  document.getElementById("startAudio").addEventListener("click", () => {
    startAudio().catch((e) => {
      setStatus("Start audio failed:\n" + e);
      document.getElementById("startAudio").disabled = false;
    });
  });

  map.on("click", (e) => {
    updateForUserPos(e.latlng, usingGPS ? "SIM (override)" : "SIM");
  });

  setStatus("Ready. Press “Start audio”, then tap/click the map.");
}

(async function main(){
  const { mode, sources } = await loadSourcesDual();
  if (!sources || !sources.length) {
    setStatus("No sources found (both fetch and embedded failed).");
    return;
  }
  initScene(mode, sources);
})();
