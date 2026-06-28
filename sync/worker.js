/* FoodLog Worker
   - Encrypted blob store for cross-device sync (GET/PUT ?id=...). Never sees plaintext.
   - Web Push reminder service (/subscribe, /unsubscribe, /test) + a cron schedule
     that sends meal / hydration / weigh-in / weekly notifications.
   The VAPID public key below is public by design; the private key is an encrypted
   Worker secret (env.VAPID_PRIVATE_JWK) and is never in this file or the repo. */

const VAPID_PUBLIC = "BJOEKlwXmVCrAuxVg2XYApZ_rYFfQOMn3OyRpaP4EDsZBju6b-4UIowvFCwdG4xQ8fK5WeZfGhrQOlXGUsofYV8";
const VAPID_SUBJECT = "mailto:dtgruner@gmail.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const path = url.pathname;

    // --- Web Push endpoints ---
    if (path === "/subscribe" && req.method === "POST") {
      const body = await req.json();
      const idh = await sha256hex(body.subscription.endpoint);
      await env.SYNC.put("sub:" + idh, JSON.stringify({
        subscription: body.subscription, prefs: body.prefs || {}, tz: body.tz || "America/Los_Angeles",
      }));
      return json({ ok: true });
    }
    if (path === "/unsubscribe" && req.method === "POST") {
      const body = await req.json();
      await env.SYNC.delete("sub:" + (await sha256hex(body.endpoint)));
      return json({ ok: true });
    }
    if (path === "/test" && req.method === "POST") {
      const body = await req.json();
      const status = await sendPush(body.subscription, JSON.stringify({ title: "FoodLog ✅", body: "Reminders are working." }), env);
      return json({ ok: status > 0 && status < 300, status });
    }

    // --- Encrypted sync blob store ---
    const id = url.searchParams.get("id");
    if (!id || id.length < 16 || id.length > 200) return json({ error: "bad id" }, 400);
    if (req.method === "GET") {
      const v = await env.SYNC.get("blob:" + id);
      return new Response(v || "", { headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (req.method === "PUT") {
      const b = await req.text();
      if (b.length > 4_000_000) return json({ error: "too large" }, 413);
      await env.SYNC.put("blob:" + id, b);
      return json({ ok: true });
    }
    return json({ error: "method not allowed" }, 405);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
};

/* ---------------- reminders ---------------- */
async function runReminders(env) {
  const list = await env.SYNC.list({ prefix: "sub:" });
  for (const k of list.keys) {
    const rec = await env.SYNC.get(k.name, "json");
    if (!rec) continue;
    const due = dueReminders(rec.prefs || {}, rec.tz || "America/Los_Angeles");
    for (const rem of due) {
      const firedKey = "fired:" + k.name.slice(4) + ":" + rem.key + ":" + rem.localDate;
      if (await env.SYNC.get(firedKey)) continue;
      const status = await sendPush(rec.subscription, JSON.stringify({ title: rem.title, body: rem.body }), env);
      await env.SYNC.put(firedKey, "1", { expirationTtl: 60 * 60 * 36 });
      if (status === 404 || status === 410) await env.SYNC.delete(k.name); // subscription gone
    }
  }
}

function dueReminders(prefs, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  const hh = +p.hour % 24, mm = +p.minute;
  const date = `${p.year}-${p.month}-${p.day}`;
  const at = (h, m) => hh === h && mm === m;
  const out = [];
  if (prefs.weighin && at(6, 45)) out.push({ key: "weighin", title: "Morning weigh-in", body: "Log today's weight in FoodLog.", localDate: date });
  if (prefs.meals && at(12, 30)) out.push({ key: "lunch", title: "Lunch check-in", body: "Don't forget to log your lunch.", localDate: date });
  if (prefs.meals && at(19, 0)) out.push({ key: "dinner", title: "Dinner check-in", body: "Log your dinner in FoodLog.", localDate: date });
  if (prefs.water && at(14, 0)) out.push({ key: "water", title: "Hydration", body: "Time for some water.", localDate: date });
  if (prefs.weekly && p.weekday === "Sun" && at(18, 0)) out.push({ key: "weekly", title: "Weekly recap", body: "See this week's summary in FoodLog.", localDate: date });
  return out;
}

/* ---------------- Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) ---------------- */
async function sendPush(sub, payload, env) {
  try {
    const endpoint = sub.endpoint;
    const jwt = await vapidJwt(new URL(endpoint).origin, env);
    const body = await encryptPayload(payload, sub.keys.p256dh, sub.keys.auth);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "TTL": "86400",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Authorization": `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
      },
      body,
    });
    return res.status;
  } catch (e) {
    return -1;
  }
}

async function vapidJwt(aud, env) {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "ES256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: now + 12 * 3600, sub: VAPID_SUBJECT })));
  const signingInput = header + "." + claims;
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput));
  return signingInput + "." + b64url(new Uint8Array(sig));
}

async function encryptPayload(payload, p256dhB64, authB64) {
  const te = new TextEncoder();
  const clientPub = b64urlDecode(p256dhB64);   // 65 bytes
  const authSecret = b64urlDecode(authB64);     // 16 bytes
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey)); // 65 bytes
  const clientKey = await crypto.subtle.importKey("raw", clientPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, asKeys.privateKey, 256));

  const keyInfo = concat(te.encode("WebPush: info\0"), clientPub, asPub);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);

  const plaintext = concat(te.encode(payload), new Uint8Array([2])); // 0x02 = last-record delimiter
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false); // record size
  header[20] = 65;                                        // key id length
  header.set(asPub, 21);
  return concat(header, ct);
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

/* ---------------- helpers ---------------- */
function concat(...arrs) {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint8Array(n); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function b64url(buf) {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}
async function sha256hex(str) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
