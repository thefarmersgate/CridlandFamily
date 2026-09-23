#!/usr/bin/env node
/**
 * Glengowerie spike. Answers the questions the docs don't, before anything
 * gets built on top of the answers.
 *
 *   node spike.js <access-token>
 *
 * Get the token from the Ring Developer Playground - it lasts ~30 minutes and
 * needs no app registration, which is exactly what a spike wants.
 *
 * It prints, in order:
 *   1. every device, with the CAM_* env line to paste into Vercel
 *   2. each device's real aspect ratio           -> BELL_ASPECT
 *   3. battery level and online state            -> is solar keeping up
 *   4. whether image/download READS or CAPTURES  <- the load-bearing question
 *   5. the rate-limit headroom the design assumes
 *
 * It never opens a live stream. Nothing here costs battery.
 */

const BASE = "https://api.amazonvision.com";
const token = process.argv[2];
if (!token) { console.error("usage: node spike.js <access-token>"); process.exit(1); }

const H = { Authorization: `Bearer ${token}` };
const hr = (t) => console.log(`\n${"=".repeat(64)}\n${t}\n${"=".repeat(64)}`);
const sha = async (buf) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))]
    .slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");

async function main() {
  hr("1. DEVICES");
  const r = await fetch(`${BASE}/v1/devices?include=status,capabilities,location`, { headers: H });
  if (!r.ok) { console.error(`devices: ${r.status} ${await r.text()}`); process.exit(1); }
  console.log(`rate limit remaining: ${r.headers.get("x-ratelimit-remaining") ?? "n/a"} of ${r.headers.get("x-ratelimit-limit") ?? "n/a"}`);

  const body = await r.json();
  const devices = body.devices || body.items || body.data || (Array.isArray(body) ? body : []);
  if (!devices.length) { console.log("no devices returned. raw:"); console.dir(body, { depth: 4 }); return; }

  const SUGGEST = [
    [/front\s*door|doorbell/i, "CAM_BELL"], [/drive/i, "CAM_DRIVE"],
    [/front/i, "CAM_FRONT"], [/back|verand|patio/i, "CAM_BACK"], [/shed|garage/i, "CAM_SHED"],
  ];
  const envLines = [];

  for (const d of devices) {
    const id = d.id || d.device_id;
    const name = d.name || d.description || "(unnamed)";
    const kind = d.kind || d.device_type || d.type || "?";
    const w = d.capabilities?.video?.width ?? d.video?.width ?? null;
    const h = d.capabilities?.video?.height ?? d.video?.height ?? null;
    const aspect = w && h ? (Math.abs(w / h - 1) < 0.02 ? "1/1" : `${w}/${h} (~${(w / h).toFixed(2)}:1)`) : "not reported";
    const batt = d.status?.battery_level ?? d.battery_level ?? d.status?.battery ?? null;
    const online = d.status?.online ?? (d.status?.status !== "offline");

    console.log(`\n  ${name}`);
    console.log(`    id       ${id}`);
    console.log(`    kind     ${kind}`);
    console.log(`    video    ${w && h ? `${w}x${h}` : "?"}   aspect ${aspect}`);
    console.log(`    battery  ${batt ?? "n/a"}${batt !== null ? "%" : ""}   online ${online}`);
    if (batt !== null && batt < 40) console.log(`    NOTE     under 40% - watch whether solar keeps up`);

    const m = SUGGEST.find(([re]) => re.test(name));
    if (m) envLines.push(`${m[1]}=${id}`);
    if (/doorbell/i.test(kind) || /doorbell/i.test(name)) {
      envLines.push(`BELL_ASPECT=${w && h && Math.abs(w / h - 1) < 0.02 ? "1/1" : "16/9"}`);
    }
  }

  hr("2. PASTE INTO VERCEL");
  console.log(envLines.length ? [...new Set(envLines)].join("\n") : "  name matching failed - map the ids above by hand");

  hr("3. DOES image/download READ OR CAPTURE?");
  console.log("The whole snapshot model assumes it READS what Ring already holds.");
  console.log("Same bytes twice in a row = a read. Different = it triggered a capture,");
  console.log("which wakes a solar-battery camera every time and must not be used.\n");

  const cam = devices.find((d) => !/doorbell/i.test(d.kind || d.name || "")) || devices[0];
  const camId = cam.id || cam.device_id;
  const shot = async () => {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/v1/devices/${camId}/media/image/download`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ format: "jpeg" }),
    });
    const ct = res.headers.get("content-type") || "";
    let buf, note = "";
    if (ct.includes("json")) {
      const j = await res.json();
      const url = j.url || j.download_url || j.media_url;
      note = " (returned a signed url, not bytes)";
      buf = url ? await (await fetch(url)).arrayBuffer() : new ArrayBuffer(0);
    } else {
      buf = await res.arrayBuffer();
    }
    return { status: res.status, ms: Date.now() - t0, bytes: buf.byteLength, digest: await sha(buf), note };
  };

  console.log(`  camera: ${cam.name || camId}`);
  const a = await shot();
  console.log(`  read 1: ${a.status}  ${a.bytes} bytes  ${a.ms}ms  sha ${a.digest}${a.note}`);
  await new Promise((s) => setTimeout(s, 4000));
  const b = await shot();
  console.log(`  read 2: ${b.status}  ${b.bytes} bytes  ${b.ms}ms  sha ${b.digest}`);

  console.log("");
  if (a.digest === b.digest && a.bytes > 0) {
    console.log("  -> SAME image. It is a READ. The design holds; carry on.");
  } else if (a.bytes === 0 || b.bytes === 0) {
    console.log("  -> No image came back. Check the Ring Protect plan and that");
    console.log("     Snapshot Capture is switched on for this camera.");
  } else {
    console.log("  -> DIFFERENT images four seconds apart. Either a capture was");
    console.log("     triggered, or the interval is far shorter than 30 min.");
    console.log("     STOP and find the read-only path before building on this.");
  }

  hr("4. SNAPSHOT AGE");
  console.log("Leave this running ~35 min and watch when the hash changes -");
  console.log("that gap is the real capture interval, and it sets both");
  console.log("CAPTURE_INTERVAL_MIN and the staleness threshold.");
  console.log(`\n  watch: node spike.js ${token.slice(0, 8)}... --watch`);

  if (process.argv.includes("--watch")) {
    let last = b.digest;
    setInterval(async () => {
      const s = await shot();
      const t = new Date().toLocaleTimeString("en-AU");
      if (s.digest !== last) { console.log(`  ${t}  NEW IMAGE  sha ${s.digest}  (${s.bytes} bytes)`); last = s.digest; }
      else { console.log(`  ${t}  unchanged`); }
    }, 60000);
  }
}
main().catch((e) => { console.error("\nspike failed:", e.message); process.exit(1); });
