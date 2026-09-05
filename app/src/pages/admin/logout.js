import { clearSession } from "../../lib/auth.js";

export async function POST({ cookies, redirect }) {
  clearSession(cookies);
  return redirect("/admin/login");
}
