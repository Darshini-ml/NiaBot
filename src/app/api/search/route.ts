import { NextRequest } from "next/server";

import { NIA_GATEWAY_URL, NIA_API_KEY } from "@/lib/config";

export async function POST(req: NextRequest) {
  const { query, maxResults } = await req.json();

  const response = await fetch(`${NIA_GATEWAY_URL}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NIA_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      maxResults: maxResults || 8,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return new Response(JSON.stringify({ error }), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await response.json();
  return Response.json(data);
}
