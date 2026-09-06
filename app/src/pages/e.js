// Where a diner's page sends what happened.
//
// Deliberately tiny and deliberately on the MENU app, not the admin: it is the one server
// route a diner ever touches, and it has to survive the admin being down, being deployed,
// or not existing yet in a region.
//
// The page reaches this with `navigator.sendBeacon`, which means:
//   - it fires during `visibilitychange`, so a diner closing the tab still counts;
//   - it cannot read the response, so there is nothing useful to return;
//   - it is a POST with no custom headers, so this must not require any.
//
// Everything that decides what is stored lives in `record_events` (0009), not here. This
// route cannot write to `events` at all - it can only ask the function to, and the function
// validates the tenant, bounds the batch and whitelists the name. A bug in this file is a
// dropped count, not a poisoned table.
import { anonClient } from "../lib/auth.js";

export const prerender = false;

// A beacon body over this is not a menu page reporting a funnel.
const MAX_BODY = 8 * 1024;

export async function POST({ request }) {
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return ok();
    body = JSON.parse(text);
  } catch {
    return ok();
  }

  const { tenant, session, events } = body || {};
  if (!tenant || !session || !Array.isArray(events) || !events.length) return ok();

  try {
    // The anon key, on purpose. This is exactly the privilege a diner has: permission to
    // call one function and nothing else. Using anything stronger here would mean the one
    // public route in the system held a key that could read every restaurant's data.
    await anonClient().rpc("record_events", {
      p_tenant: tenant,
      p_session: String(session).slice(0, 64),
      p_events: events.slice(0, 50),
    });
  } catch {
    // Swallowed, always. A diner must never see an analytics failure, and a menu that
    // 500s because a count could not be written is a menu that is down for the reason
    // that matters least.
  }
  return ok();
}

/** 204 with no body: sendBeacon ignores it, and there is nothing to say. */
function ok() {
  return new Response(null, { status: 204 });
}
