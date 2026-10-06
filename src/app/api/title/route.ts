import { NextRequest, NextResponse } from "next/server";
import { recordUsage } from "@/lib/recordUsage";

import { NIA_GATEWAY_URL, NIA_API_KEY } from "@/lib/config";

export async function POST(req: NextRequest) {
  try {
    const { userMessage, assistantMessage, chatId, isUrl } = await req.json();

    // For URL-only messages, title is handled client-side using link card data
    if (isUrl) {
      return NextResponse.json({ title: null });
    }

    const startTime = Date.now();
    const res = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "Generate a concise chat title in 6 words or fewer. Return ONLY the title text, no quotes, no punctuation at the end. The title should capture the main topic of the conversation."
          },
          { role: "user", content: (userMessage || "").slice(0, 500) },
          { role: "assistant", content: (assistantMessage || "").slice(0, 500) },
          { role: "user", content: "Generate a ≤6-word title for this conversation." }
        ],
        max_tokens: 30,
        temperature: 0.3,
        stream: false,
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ title: null, error: "API error" }, { status: 500 });
    }

    const data = await res.json();
    const title = (data.choices?.[0]?.message?.content || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\.+$/, "");
    const latency = Date.now() - startTime;

    // Record usage
    const usage = data.usage;
    recordUsage({
      chat_id: chatId || "",
      kind: "title",
      provider: "niaai",
      model: "google/gemini-2.5-flash",
      input_tokens: usage?.prompt_tokens || 0,
      output_tokens: usage?.completion_tokens || 0,
      cost_usd: 0,
      latency_ms: latency,
      status: "ok",
    });

    return NextResponse.json({ title: title || null });
  } catch (err) {
    console.error("[title] Error:", err);
    return NextResponse.json({ title: null, error: String(err) }, { status: 500 });
  }
}
