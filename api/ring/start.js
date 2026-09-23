// Ring's Account Link URL. Ring sends the user here during linking. There are
// no accounts on this side to sign in to, so if Ring passed a return address,
// send the user straight back with its state; otherwise show the done page.
// Only query-parameter NAMES are logged, never values.
async function handler(req) {
  const url = new URL(req.url);
  const q = url.searchParams;
  console.log("ring start: received", { keys: [...q.keys()] });

  const back = q.get("redirect_uri") || q.get("redirect_url") || q.get("return_url") || q.get("callback");
  if (back) {
    let target;
    try { target = new URL(back); } catch { target = null; }
    // Only bounce to Ring or Amazon, never to an arbitrary site.
    if (target && target.protocol === "https:" && /(^|\.)(ring\.com|amazon\.com|amazonvision\.com)$/.test(target.hostname)) {
      for (const k of ["state", "code"]) if (q.get(k) && !target.searchParams.has(k)) target.searchParams.set(k, q.get(k));
      return Response.redirect(target.toString(), 302);
    }
    console.warn("ring start: ignored return address on", target?.hostname);
  }
  return Response.redirect(new URL("/shirldashboard/ring-done", url).toString(), 302);
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
