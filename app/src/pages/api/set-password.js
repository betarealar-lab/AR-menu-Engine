// Turn a one-time token into an account with a password on it.
//
// Deliberately NOT Supabase's own `action_link`. That link redirects to whatever Site URL
// the dashboard happens to hold - it shipped pointing at `localhost:3000`, which is
// somebody else's project - and it puts the session in a URL fragment, which means the
// page has to hold a live token in JavaScript to do anything with it.
//
// So the token comes to us instead and is exchanged HERE, server-side, for a session we
// put straight into the httpOnly cookie. No dashboard setting decides whether it works, no
// token is ever readable by page script, and the person is signed in when it finishes
// rather than sent back to a login form to type what they just chose.
import { setSession } from "../../lib/auth.js";
import { jsonError } from "../../lib/api.js";
import { envVar } from "../../lib/env.js";

// Supabase's own floor. Stated in the UI rather than discovered on submit.
const MIN = 8;

export async function POST({ request, cookies }) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Bad JSON", 400); }

  const { token, email, password } = body;
  if (!token || !email) return jsonError("That link is not valid any more", 400);
  if (typeof password !== "string" || password.length < MIN) {
    return jsonError(`Use at least ${MIN} characters`, 400);
  }

  // The one-time recovery token, exchanged for a session. A used token is refused, which
  // is the property that makes it safe to hand somebody over any channel at all.
  const res = await fetch(`${envVar("SUPABASE_URL")}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: envVar("SUPABASE_ANON_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "recovery", token, email }),
  });

  if (!res.ok) {
    return jsonError("That link has expired or has already been used. "
                     + "Ask for a new one.", 400);
  }
  const session = await res.json();
  if (!session?.access_token) return jsonError("That link is not valid any more", 400);

  // Now, as that user, set the password. The bearer token is the session we just got, not
  // the service key: the same rule as everywhere else here, and it means this endpoint
  // cannot change anyone's password but the one whose token it was handed.
  //
  // Called directly rather than through `supabase-js`. Its `auth.updateUser` reads the
  // session the CLIENT is holding, and this client is deliberately holding none - passing
  // a header would be silently ignored and the call would fail with "Auth session
  // missing", which says nothing about the real cause.
  const set = await fetch(`${envVar("SUPABASE_URL")}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: envVar("SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  if (!set.ok) {
    const detail = await set.json().catch(() => ({}));
    return jsonError(detail.msg || detail.message || "That password was not accepted", 400);
  }

  setSession(cookies, session);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
