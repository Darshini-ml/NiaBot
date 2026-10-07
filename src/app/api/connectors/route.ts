import { NextRequest } from "next/server";
import { listConnectors } from "@/lib/connectorStore";
import { getUserId } from "@/lib/session";

/** GET /api/connectors — list connectors for current user */
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  const connectors = listConnectors(userId);
  return Response.json({ connectors });
}
