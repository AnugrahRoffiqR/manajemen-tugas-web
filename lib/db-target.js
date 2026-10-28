// Guard for scripts that WRITE to the database (migrate, test suite): they only run when
// DB_TARGET_CONFIRM names the exact Neon endpoint in DATABASE_URL, so a production URL left in
// .env or a CI secret can never be hit by accident. The endpoint ID is not a credential.
function endpointOf(databaseUrl) {
  let host;
  try { host = new URL(databaseUrl).hostname; } catch { return null; }
  return host.split('.')[0].replace(/-pooler$/, '') || null;
}

function checkTarget(databaseUrl, confirm) {
  const endpoint = endpointOf(databaseUrl);
  if (!endpoint) return { ok: false, endpoint, reason: 'DATABASE_URL kosong atau tidak valid.' };
  if (confirm !== endpoint) {
    return {
      ok: false,
      endpoint,
      reason: `Target DB adalah endpoint "${endpoint}". Set DB_TARGET_CONFIRM=${endpoint} untuk mengonfirmasi target ini.`,
    };
  }
  return { ok: true, endpoint };
}

function assertTarget(label) {
  const r = checkTarget(process.env.DATABASE_URL, process.env.DB_TARGET_CONFIRM);
  if (!r.ok) {
    console.error(`[${label}] Dibatalkan. ${r.reason}`);
    process.exit(2);
  }
  console.log(`[${label}] Target DB: ${r.endpoint}`);
  return r.endpoint;
}

module.exports = { endpointOf, checkTarget, assertTarget };
