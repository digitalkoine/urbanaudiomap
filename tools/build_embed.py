#!/usr/bin/env python3
import os, json, base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, "data", "sources.json")
OUT_JS = os.path.join(ROOT, "js", "embedded_data.js")

def audio_to_data_uri(path: str) -> str:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return "data:audio/wav;base64," + b64

def main():
    with open(DATA_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    sources = data["sources"]

    embedded = []
    for s in sources:
        s2 = dict(s)
        audio_rel = s2.pop("audio")
        audio_abs = os.path.join(ROOT, audio_rel.replace("/", os.sep))
        if not os.path.exists(audio_abs):
            raise FileNotFoundError(f"Audio not found: {audio_rel} (expected {audio_abs})")
        s2["audioUri"] = audio_to_data_uri(audio_abs)
        embedded.append(s2)

    js = "window.EMBEDDED_SOURCES = " + json.dumps(embedded, ensure_ascii=False) + ";"
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(js)

    print("OK: regenerated", OUT_JS)

if __name__ == "__main__":
    main()
