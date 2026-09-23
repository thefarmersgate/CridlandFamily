// Ring's Account Link URL. After device selection Ring sends the user here
// with ?nonce=&time=. Ring requires a sign-in before the nonce is used, so
// this page asks for the frame's setup key, then /api/ring/claim matches the
// nonce and completes the link. Only parameter names are logged.
const page = (nonce, time) => `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Link Ring</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    background:#0B0F13;color:#fff;font:500 18px/1.5 "Segoe UI",system-ui,Arial,sans-serif}
  .card{width:min(440px,100%);display:flex;flex-direction:column;gap:14px;text-align:center}
  h1{font-weight:300;letter-spacing:.06em;text-transform:uppercase;margin:0}
  p{color:#8496A4;margin:0}
  input{font:inherit;padding:14px 16px;border-radius:12px;background:#101720;border:2px solid #2C3741;color:#fff}
  button{font:inherit;font-weight:800;letter-spacing:.06em;text-transform:uppercase;min-height:54px;
    border:0;border-radius:12px;background:#F2A54A;color:#170F04;cursor:pointer}
  .err{color:#FF5A50;font-weight:600} .ok{color:#5BD3A0;font-weight:600}
</style></head><body>
<div class="card">
  <h1>Link Ring to the frame</h1>
  <p>Sign in with the frame's setup key to finish.</p>
  <input id="key" type="password" autocomplete="current-password" placeholder="Setup key">
  <button id="go" type="button">Sign in and link</button>
  <p id="msg"></p>
</div>
<script>
(function(){
  var nonce=${JSON.stringify(nonce)}, time=${JSON.stringify(time)};
  var msg=document.getElementById("msg"), key=document.getElementById("key");
  try{ key.value=localStorage.getItem("kiosk_key")||""; }catch(e){}
  if(!nonce||!time){ msg.className="err"; msg.textContent="This page needs the link Ring sends you to. Start again from Ring."; }
  document.getElementById("go").addEventListener("click",function(){
    msg.className=""; msg.textContent="Linking…";
    fetch("/api/ring/claim",{method:"POST",headers:{"Content-Type":"application/json","X-Kiosk-Key":key.value.trim()},
      body:JSON.stringify({nonce:nonce,time:time}),cache:"no-store"})
      .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||("Error "+r.status)); return j; }); })
      .then(function(){ msg.className="ok"; msg.textContent="Ring is linked. You can close this page."; })
      .catch(function(e){ msg.className="err"; msg.textContent=e.message; });
  });
})();
</script></body></html>`;

async function handler(req) {
  const q = new URL(req.url).searchParams;
  console.log("ring start: received", { keys: [...q.keys()] });
  return new Response(page(q.get("nonce") || "", q.get("time") || ""), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
