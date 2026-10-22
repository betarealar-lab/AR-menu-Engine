// POST /api/upload - one file from the Shopping 3D admin into R2.
//
// The admin's /api/asset rules, cut down to what this admin uploads: models (GLB, USDZ)
// and photos for the 3D Studio. Super admins only - checked by asking the database AS the
// caller (their own access token, RLS answering), so there is no second definition of
// "one of us" here to drift from the policy. Content-addressed keys under the Shopping 3D
// tenant, exactly the restaurant layout (`t/<tenant>/<kind>/<hash>.<ext>`), so the engine,
// the USDZ sweep and the /a/ route treat these files like any other. Nothing is ever
// overwritten or deleted.
import { envFrom, bindingFrom } from "../../lib/env.js";

export const prerender = false;

const RULES = {
  glb:   { ext: "glb",  type: "model/gltf-binary",  max: 95 },
  usdz:  { ext: "usdz", type: "model/vnd.usdz+zip", max: 95 },
  photo: { ext: "jpg",  type: "image/jpeg",         max: 20 },
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function POST({ request, locals }) {
  const env = envFrom(locals);
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const anon = env("SUPABASE_ANON_KEY");
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);

  const asUser = (path) => fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  }).then((r) => (r.ok ? r.json() : []));

  // `limit=1`: a super admin can see every row of super_admins, so this is "any row".
  const isSuper = await asUser("super_admins?select=user_id&limit=1");
  if (!isSuper.length) return json({ error: "Only BetaReal super admins can upload here" }, 403);
  const [tenant] = await asUser("tenants?select=id&slug=eq.shopping3d");
  if (!tenant) return json({ error: "The Shopping 3D account is missing" }, 500);

  const form = await request.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") || "");
  const rule = RULES[kind];
  if (!rule) return json({ error: "Unknown kind of file" }, 400);
  if (!(file instanceof File)) return json({ error: "No file" }, 400);
  if (file.size > rule.max * 1024 * 1024) return json({ error: `That file is over ${rule.max} MB` }, 413);

  const bucket = bindingFrom(locals, "PHOTOS");
  if (!bucket) return json({ error: "Uploads work on the deployed site only" }, 501);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  // A studio photo carries its angle in the name: the engine reads the slot from the
  // `-front.jpg` ending (model_requests._slot_of), and falls back to list order - which
  // is wrong as soon as an angle in the middle is skipped.
  const slot = String(form.get("slot") || "");
  const tail = kind === "photo" && /^(front|right|back|left)$/.test(slot) ? `-${slot}` : "";
  const key = `t/${tenant.id}/${kind}/${hash}${tail}.${rule.ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: rule.type } });
  return json({ key, tenantId: tenant.id });
}
