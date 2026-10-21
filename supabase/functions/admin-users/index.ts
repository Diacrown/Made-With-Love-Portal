// Admin user management (create, deactivate, reactivate). Needs the service-role key, so it runs here
// on the server and never in the browser. Only callers with a GLOBAL admin.manage grant may use it.
//
// POST { action: "create", email, full_name, role_code, office_codes: string[] }  -> { user_id, temp_password }
// POST { action: "set_active", user_id, active: boolean }                          -> { ok: true }
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function tempPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "x");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Not signed in" });

  // 1. Who is calling? Checked with the caller's own token, so RLS applies.
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json(401, { error: "Session expired. Sign in again." });
  const { data: access, error: accErr } = await caller.rpc("my_access");
  if (accErr) return json(500, { error: "Could not check permissions" });
  const isAdmin = (access ?? []).some((r: any) => r.permission_code === "admin.manage" && r.office_id === null);
  if (!isAdmin) return json(403, { error: "Only administrators can manage users" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (body.action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const roleCode = String(body.role_code ?? "");
    const officeCodes: string[] = Array.isArray(body.office_codes) ? body.office_codes.map(String) : [];
    if (!EMAIL.test(email)) return json(400, { error: "Enter a valid email address" });
    if (!fullName) return json(400, { error: "Enter the person's name" });

    const { data: role } = await admin.from("roles").select("id").eq("code", roleCode).maybeSingle();
    if (!role) return json(400, { error: `Unknown role "${roleCode}"` });
    let officeIds: (number | null)[] = [null];
    if (officeCodes.length) {
      const { data: offices } = await admin.from("offices").select("id, code").in("code", officeCodes);
      if ((offices ?? []).length !== officeCodes.length) return json(400, { error: "One or more office codes are unknown" });
      officeIds = offices!.map((o: any) => o.id);
    }

    const password = tempPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (createErr) {
      const exists = /already/i.test(createErr.message);
      return json(exists ? 409 : 500, { error: exists ? "A user with this email already exists" : createErr.message });
    }
    const userId = created.user!.id;
    const { error: grantErr } = await admin.from("user_office_roles")
      .insert(officeIds.map((office_id) => ({ user_id: userId, office_id, role_id: role.id })));
    if (grantErr) return json(500, { error: `User created but role not assigned: ${grantErr.message}` });
    return json(200, { user_id: userId, temp_password: password });
  }

  if (body.action === "set_active") {
    const userId = String(body.user_id ?? "");
    const active = Boolean(body.active);
    if (userId === userData.user.id && !active) return json(400, { error: "You cannot deactivate yourself" });
    // Ban blocks sign-in; is_active=false removes every permission even for an existing session.
    const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
    if (banErr) return json(500, { error: banErr.message });
    const { error: profErr } = await admin.from("profiles").update({ is_active: active }).eq("id", userId);
    if (profErr) return json(500, { error: profErr.message });
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action" });
});
