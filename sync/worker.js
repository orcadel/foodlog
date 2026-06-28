/* FoodLog sync Worker — a dumb encrypted-blob store.
   It never sees your data in the clear: the app encrypts before upload and
   decrypts after download. This Worker only stores ciphertext keyed by an
   opaque id (a hash derived from your passphrase). */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const id = new URL(req.url).searchParams.get("id");
    if (!id || id.length < 16 || id.length > 200) return json({ error: "bad id" }, 400);

    if (req.method === "GET") {
      const v = await env.SYNC.get("blob:" + id);
      return new Response(v || "", { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > 4_000_000) return json({ error: "too large" }, 413);
      await env.SYNC.put("blob:" + id, body);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
