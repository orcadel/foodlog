/* FoodLog service worker — network-first for fresh updates, cache fallback for offline. */
const CACHE = "foodlog-v47";
const ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./icon-180.png", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png"
];

/* Last-resort page. Only ever shown when a navigation misses the network AND the cache is
   empty. Before build 47 that combination resolved to `undefined`, and respondWith(undefined)
   is a failed navigation — a permanent white screen with no JS left running to self-heal.
   Anything is better than nothing here. */
const RECOVERY_HTML = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>FoodLog</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:14vh 24px;text-align:center;color:#1c2127;background:#f5f6f8}
h1{font-size:19px;margin:0 0 10px}p{color:#7b8694;font-size:14px;margin:0 0 22px}
button{font:inherit;font-weight:600;background:#2f8f5b;color:#fff;border:0;border-radius:12px;padding:13px 26px}
@media(prefers-color-scheme:dark){body{background:#0f1216;color:#e8ebef}}</style>
<h1>Couldn't reach the network</h1>
<p>Your logged data is safe on this device — this screen just means the app files couldn't load.
Reconnect and tap Retry.</p>
<button onclick="location.reload()">Retry</button>
<script>setTimeout(function(){location.reload()},4000)<\/script>`;

self.addEventListener("install", e => {
  // Per-asset adds: one 404 must not fail the whole install and strand the old worker.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => {}))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                       // never intercept PUT/POST (sync writes)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // let the sync Worker + Anthropic API pass straight through

  // Network-first: always try for the latest app, fall back to cache when offline.
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    } catch (_) {
      const hit = (await caches.match(req)) || (await caches.match("./index.html")) || (await caches.match("./"));
      if (hit) return hit;
      // NEVER resolve to undefined — see RECOVERY_HTML above.
      if (req.mode === "navigate") {
        return new Response(RECOVERY_HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return Response.error();
    }
  })());
});

// Web Push: show the reminder notification.
self.addEventListener("push", e => {
  let d = { title: "FoodLog", body: "" };
  try { if (e.data) d = e.data.json(); } catch (_) { if (e.data) d.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.title || "FoodLog", {
    body: d.body || "", icon: "./icon-192.png", badge: "./icon-192.png", tag: d.title, data: d.data || null
  }));
});

// Tapping a notification opens/focuses the app (and routes the end-of-day log check).
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = data.type === "logcheck" ? ("./?logcheck=" + encodeURIComponent(data.date || "today")) : "./";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(cl => {
    for (const c of cl) {
      if ("focus" in c) { if (data.type) { try { c.postMessage({ kind: "notif", ...data }); } catch (_) {} } return c.focus(); }
    }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});
