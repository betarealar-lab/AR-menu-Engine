// Shared guard and error shape for the admin's write endpoints.
import { getUser, userClient } from "./auth.js";

export function jsonError(message, status = 400) {
  return new Response(message, { status });
}

/** Every write endpoint starts here. Returns a client acting AS the signed-in user, so
 *  row-level security still applies to whatever it does next. */
export async function requireApiUser(cookies) {
  const user = await getUser(cookies);
  if (!user) return { error: jsonError("Not signed in", 401) };
  return { user, supa: userClient(user.token) };
}
