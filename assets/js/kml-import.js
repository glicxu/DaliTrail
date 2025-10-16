// /assets/js/kml-import.js
import {
  parseIsoTime,
  parseKmlCoordinateList as parseCoordinateList,
  sampleLineVertices,
  round6,
} from "/assets/js/utils.js";

export function attachKmlImport({ input, getSaved, mergeAndSave, onStatus }) {
  if (!input) return;

  input.addEventListener("change", async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    try {
      onStatus?.("Importing KML...");
      const kmlText = await file.text();
      const parsed = parseKmlToEntries(kmlText);
      if (!parsed.length) {
        onStatus?.("No importable coordinates found in KML.");
        return;
      }
      const { added, total } = mergeAndSave(parsed);
      onStatus?.(`Imported ${parsed.length} from KML (${added} new).`);
      alert(`Parsed ${parsed.length} points. Added ${added} new locations. Total: ${total}.`);
    } catch (err) {
      console.error(err);
      const msg = err && typeof err === "object" && "message" in err ? err.message : String(err);
      onStatus?.(`Failed to import KML: ${msg}`);
      alert(`Failed to import KML: ${msg}`);
    } finally {
      e.target.value = ""; // allow re-importing same file
    }
  });
}

function parseKmlToEntries(kmlText) {
  const dom = new DOMParser().parseFromString(kmlText, "application/xml");
  if (dom.querySelector("parsererror")) throw new Error("Invalid KML format.");

  const q = (sel, root = dom) => root.querySelector(sel);
  const qa = (sel, root = dom) => Array.from(root.querySelectorAll(sel));
  const txt = (root, selectors) => {
    for (const s of selectors) {
      const el = q(s, root);
      if (el && el.textContent) return el.textContent.trim();
    }
    return undefined;
  };

  const entries = [];

  qa("Placemark").forEach((pm) => {
    const name = txt(pm, ["name"]);
    const desc = txt(pm, ["description"]);
    const when = txt(pm, ["TimeStamp > when", "TimeSpan > begin"]);
    const timestamp = parseIsoTime(when) ?? Date.now();

    // Point
    const coordRaw = txt(pm, ["Point > coordinates"]);
    if (coordRaw) {
      const [lng, lat, alt] = coordRaw.split(",").map((s) => Number(s.trim()));
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        entries.push(mkEntry({ lat, lng, alt, name, desc, timestamp, source: "Point" }));
      }
    }

    // LineString
    const lineRaw = txt(pm, ["LineString > coordinates"]);
    if (lineRaw) {
      const linePts = parseCoordinateList(lineRaw);
      const picks = sampleLineVertices(linePts);
      picks.forEach((p, i) => {
        entries.push(mkEntry({
          lat: p.lat, lng: p.lng, alt: p.alt,
          name: name ? `${name} [${i + 1}/${picks.length}]` : "Line vertex",
          desc, timestamp, source: "LineString"
        }));
      });
    }

    // gx:Track
    const track = q("gx\\:Track, Track", pm);
    if (track) {
      const whens = qa("when", track).map((w) => w.textContent.trim());
      const coords = qa("gx\\:coord, coord", track).map((c) => c.textContent.trim().split(/\s+/).map(Number)); // lon lat alt
      const n = Math.min(whens.length, coords.length);
      for (let i = 0; i < n; i++) {
        const [lng, lat, alt] = coords[i];
        const t = parseIsoTime(whens[i]) ?? timestamp;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          entries.push(mkEntry({
            lat, lng, alt, name: name ? `${name} (${i + 1}/${n})` : "Track point",
            desc, timestamp: t, source: "gx:Track"
          }));
        }
      }
    }
  });

  // de-dup by rounded lat/lng + ts second
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const k = `${round6(e.lat)},${round6(e.lng)}@${Math.floor(e.timestamp / 1000)}`;
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  return out;
}

function mkEntry({ lat, lng, alt, name, desc, timestamp, source }) {
  const altitude = Number.isFinite(alt) ? alt : null;
  const baseNote = [name, desc].filter(Boolean).join(" — ").trim();
  const note = baseNote || (source ? `Imported (${source})` : "Imported");
  const id = `${timestamp}-${round6(lat)}-${round6(lng)}-${Math.random().toString(16).slice(2, 6)}`;
  return { id, lat, lng, accuracy: null, altitude, note, timestamp };
}
