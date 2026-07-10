/* FoodLog service worker — network-first for fresh updates, cache fallback for offline. */
const CACHE = "foodlog-v30";
const ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./icon-180.png", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                       // never intercept PUT/POST (sync writes)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // let the sync Worker + Anthropic API pass straight through

  // Network-first: always try for the latest app, fall back to cache when offline.
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
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
