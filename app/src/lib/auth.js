// auth.js — what is left of it.
//
// This file used to hold the Astro admin's sign-in: cookie sessions, token refresh, the
// page guard. That admin was retired on 2026-09-06 in favour of the Next app in /admin,
// and everything here went with it except the one client the DINER page needs.
//
// `anonClient` is the anon key and nothing else: exactly the privilege a diner has, which
// is permission to call `record_events()` (0009) and no other. It is used by /e and by
// nothing else, and it must never grow a stronger key - /e is the one public route in the
// system, and a public route holding a key that could read every restaurant's data is the
// wrong shape by definition.

import { createClient } from "@supabase/supabase-js";
import { envVar } from "./env.js";

export function anonClient() {
  return createClient(envVar("SUPABASE_URL"), envVar("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
