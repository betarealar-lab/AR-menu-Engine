// auth.js — who is allowed into the admin.
//
// Supabase Auth, with the session in an httpOnly cookie. Two rules, both from
// DECISIONS §9 and ARCHITECTURE-DEBT §1:
//
//   **No password is ever stored by us.** The platform has a table of client passwords in
//   cleartext and its own debt file calls it the worst thing in that codebase. It does not
//   come across. Supabase holds the credential; we hold a token.
//
//   **Authorised accounts only, for now.** Temo, 2026-09-05: "Not yet - only our five
//   logins." So there is no signup route at all. An account is created in the Supabase
//   dashboard and that is deliberately the only way in until the product is proven.
//
// The token is httpOnly so page JavaScript cannot read it - an XSS in an admin form
// should not be able to walk off with a session.

import { createClient } from "@supabase/supabase-js";
import { envVar } from "./env.js";

const COOKIE = "br_session";

export function anonClient() {
  return createClient(envVar("SUPABASE_URL"), envVar("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A client acting as the signed-in user, so every query is still subject to RLS.
 *
 *  Deliberately NOT the service key. That key bypasses row-level security entirely, and
 *  reaching for it in a request handler is how one restaurant ends up able to read
 *  another's menu - the exact failure `check_schema.py` exists to prove cannot happen. */
export function userClient(token) {
  return createClient(envVar("SUPABASE_URL"), envVar("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function setSession(cookies, session) {
  cookies.set(COOKIE, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  }), {
    path: "/", httpOnly: true, sameSite: "lax",
    secure: envVar("NODE_ENV") === "production",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSession(cookies) {
  cookies.delete(COOKIE, { path: "/" });
}

/** The signed-in user, or null. Refreshes a token that is about to expire, so somebody
 *  editing a menu for an hour is not thrown out mid-sentence. */
export async function getUser(cookies) {
  const raw = cookies.get(COOKIE)?.value;
  if (!raw) return null;
  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!session?.access_token) return null;

  const nearlyDue = session.expires_at
    && session.expires_at * 1000 - Date.now() < 5 * 60 * 1000;
  if (nearlyDue && session.refresh_token) {
    const { data, error } = await anonClient().auth.refreshSession({
      refresh_token: session.refresh_token,
    });
    if (!error && data?.session) {
      setSession(cookies, data.session);
      session = data.session;
    }
  }

  const { data, error } = await anonClient().auth.getUser(session.access_token);
  if (error || !data?.user) return null;
  return { ...data.user, token: session.access_token };
}

/** Guard for every admin page. Returns a redirect to sign in, or null to continue. */
export async function requireUser(Astro) {
  const user = await getUser(Astro.cookies);
  if (!user) {
    const to = encodeURIComponent(Astro.url.pathname + Astro.url.search);
    return Astro.redirect(`/admin/login?next=${to}`);
  }
  Astro.locals.user = user;
  return null;
}
