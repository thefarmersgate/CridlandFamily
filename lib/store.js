// Two stores, chosen for what each is good at.
//
//   Edge Config - the Ring refresh token. It ROTATES, and env vars are immutable
//                 at runtime, so it cannot live in one. Reads happen inside the
//                 function with no network round trip. Writes go via the REST API.
//   Blob        - the doorbell/motion pulse and the warmed state. The kiosk polls
//                 the pulse URL directly from the CDN, so it never costs a
//                 function invocation.

const EC = process.env.EDGE_CONFIG;
const EC_ID = process.env.EDGE_CONFIG_ID;
const VT = process.env.VERCEL_API_TOKEN;
const BLOB = process.env.BLOB_READ_WRITE_TOKEN;

/* ---------------- Edge Config ---------------- */

export async function cfgGet(key) {
  if (!EC) return null;
  const url = EC.replace(/\/?$/, "") + `/item/${encodeURIComponent(key)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`edge-config read ${key}: ${r.status}`);
  return r.json();
}

export async function cfgSet(key, value) {
  if (!EC_ID || !VT) throw new Error("EDGE_CONFIG_ID and VERCEL_API_TOKEN are required to write");
  const r = await fetch(`https://api.vercel.com/v1/edge-config/${EC_ID}/items`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ operation: "upsert", key, value }] }),
  });
  if (!r.ok) throw new Error(`edge-config write ${key}: ${r.status} ${await r.text()}`);
}

/* ---------------- Blob ---------------- */

export async function blobPut(pathname, body, contentType = "application/json") {
  if (!BLOB) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  const r = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${BLOB}`,
      "x-api-version": "7",
      "x-content-type": contentType,
      "x-add-random-suffix": "0",
      "x-cache-control-max-age": "0",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`blob put ${pathname}: ${r.status} ${await r.text()}`);
  return r.json(); // { url, pathname, ... }
}

/* ---------------- in-memory, per warm instance ---------------- */
const mem = new Map();
export function memGet(k, maxAgeMs) {
  const v = mem.get(k);
  if (!v) return null;
  if (Date.now() - v.t > maxAgeMs) return null;
  return v.v;
}
export function memSet(k, v) { mem.set(k, { t: Date.now(), v }); }
