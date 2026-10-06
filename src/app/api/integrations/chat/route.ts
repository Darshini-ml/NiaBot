// Re-export from the original route — /api/integrations/chat is the canonical endpoint.
// /api/slack/chat remains as an alias for backward compatibility.
export { POST } from "@/app/api/slack/chat/route";
export const runtime = "nodejs";
