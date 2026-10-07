// Log missing connector env vars once at startup
const REQUIRED_VARS = [
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "APP_BASE_URL",
  "CONNECTOR_ENCRYPTION_KEY",
] as const;

// Detailed startup log for each var
for (const v of REQUIRED_VARS) {
  const val = process.env[v];
  console.log(`[connectors] ${v}: set=${!!val}, length=${val?.length ?? 0}`);
}
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.log(`[connectors] Missing env vars: ${missing.join(", ")}`);
} else {
  console.log(`[connectors] All env vars present`);
}

/** GET /api/connectors/config — check which providers are configured on this server */
export async function GET() {
  return Response.json({
    slack: !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
    discord: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
    encryption: !!(process.env.CONNECTOR_ENCRYPTION_KEY && process.env.CONNECTOR_ENCRYPTION_KEY.length === 64),
  });
}
