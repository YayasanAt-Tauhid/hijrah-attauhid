import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

export const fixtureDir = process.env.SPMB139_FIXTURE_DIR || "/tmp";
export const readFixture = (name) =>
  JSON.parse(fs.readFileSync(fixtureDir + "/" + name, "utf8"));
export const c = readFixture("spmb139-credentials.json");
assert.equal(c.url, "https://flxbrbnyzclcthjwynsh.supabase.co");

let sessions = readFixture("spmb139-sessions.json");
if (Object.values(sessions).some((s) => s.expires_at * 1000 < Date.now() + 120_000)) {
  for (const role of Object.keys(c.ids)) {
    const pw = c.passwords[role];
    const response = await fetch(c.url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: c.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "qa139-" + role + "@example.invalid", password: pw }),
      signal: AbortSignal.timeout(20_000),
    });
    const session = await response.json();
    if (!response.ok) throw new Error("Login " + role + " HTTP " + response.status);
    sessions[role] = session;
  }
  fs.writeFileSync(fixtureDir + "/spmb139-sessions.json", JSON.stringify(sessions), { mode: 0o600 });
}

export const client = (role) => createClient(c.url, c.key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    headers: { Authorization: "Bearer " + sessions[role].access_token },
    fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20_000) }),
  },
});
export const service = client("service");
export const admin = client("admin");
export const parent = client("parent");
export const outsider = client("outsider");
export const cashier = client("cashier");
export const f = readFixture("spmb139-fixture.json");
export const ref = readFixture("spmb139-master-seed.json");
export const ok = async (promise, label) => {
  const result = await promise;
  if (result.error) throw new Error(label + ": " + result.error.message);
  return result.data;
};
export const subject = (name) => f.subjects.find((s) => s.name === name);
export const type = (name) => ref.types.find((t) => t.nama === name);
