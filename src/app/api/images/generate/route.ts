import { NextRequest } from "next/server";
import { recordUsage } from "@/lib/recordUsage";
import { writeFile, mkdir } from "fs/promises";
import { randomUUID, createHash } from "crypto";
import path from "path";

import { NIA_GATEWAY_URL, NIA_API_KEY } from "@/lib/config";
const ENHANCE_MODEL = process.env.ENHANCE_MODEL || "google/gemini-2.5-flash";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "openai/gpt-image-1";

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Extract what should be depicted from the user's full message.
 * Returns a vivid image prompt (≤80 words) — never adds people unless requested.
 */
async function rewriteImagePrompt(userMessage: string): Promise<string> {
  try {
    const res = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: ENHANCE_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Extract what should be depicted from the user's message. The user may have mixed instructions and image requests in one sentence (e.g. 'explain how to make tea create image of it'). Focus on the visual subject. Return a single vivid description (≤80 words) of the scene, subject, style, and lighting. Never add people unless the user explicitly requested them. Output ONLY the image prompt, nothing else.",
          },
          { role: "user", content: userMessage },
        ],
        max_tokens: 150,
        temperature: 0.4,
        stream: false,
      }),
    });
    if (!res.ok) {
      console.error(`[image-rewrite] LLM returned ${res.status}`);
      return "";
    }
    const data = await res.json();
    const rewritten = data.choices?.[0]?.message?.content?.trim();
    console.log(`[image-rewrite] input=${JSON.stringify(userMessage)} → output=${JSON.stringify(rewritten)}`);
    return rewritten || "";
  } catch (err) {
    console.error("[image-rewrite] error:", err);
    return "";
  }
}

async function saveImageLocally(
  imageData: string,
  isBase64: boolean
): Promise<{ id: string; filePath: string; sha256: string }> {
  const id = randomUUID();
  const uploadsDir = path.join(process.cwd(), "uploads", "images");
  await mkdir(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, `${id}.png`);

  let buffer: Buffer;
  if (isBase64) {
    buffer = Buffer.from(imageData, "base64");
  } else {
    const res = await fetch(imageData);
    if (!res.ok) throw new Error("Failed to download image from provider");
    buffer = Buffer.from(await res.arrayBuffer());
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  await writeFile(filePath, buffer);

  return { id, filePath, sha256 };
}

export async function POST(req: NextRequest) {
  const { prompt, size, enhance, chat_id, message_id } = await req.json();

  if (!prompt || typeof prompt !== "string") {
    return new Response(
      JSON.stringify({ type: "error", code: "invalid_input", message: "Prompt is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const imageSize = size || "1024x1024";
  const shouldEnhance = enhance !== false;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Stage 1: Rewrite user message into an image-specific prompt
        let imagePrompt = prompt;
        if (shouldEnhance) {
          controller.enqueue(
            encoder.encode(sseEvent({ type: "image_status", stage: "enhancing" }))
          );
          imagePrompt = await rewriteImagePrompt(prompt);

          // Record image prompt rewrite usage
          recordUsage({
            chat_id: chat_id || "",
            message_id: message_id || "",
            kind: "enhance",
            provider: "niaai",
            model: ENHANCE_MODEL,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0,
            latency_ms: 0,
          });
        }

        // Assert non-empty (≥5 chars) — fail loudly if rewrite produced nothing
        if (!imagePrompt || imagePrompt.length < 5) {
          console.error(`[image-gen] Empty or too-short image prompt: ${JSON.stringify(imagePrompt)}`);
          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "error",
                code: "empty_prompt",
                message: "Could not extract an image description from your message. Please describe what you want to see.",
              })
            )
          );
          controller.close();
          return;
        }

        // Stage 2: Generate image
        controller.enqueue(
          encoder.encode(sseEvent({ type: "image_status", stage: "generating" }))
        );

        const requestBody = {
          model: IMAGE_MODEL,
          prompt: imagePrompt,
          n: 1,
          size: imageSize,
        };
        console.log(`[image-gen] request body:`, JSON.stringify(requestBody));

        const genRes = await fetch(`${NIA_GATEWAY_URL}/images/generations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${NIA_API_KEY}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!genRes.ok) {
          const errText = await genRes.text();
          let errorMessage = "Image generation failed";
          try {
            const errJson = JSON.parse(errText);
            errorMessage =
              errJson.error?.message ||
              errJson.error ||
              errJson.message ||
              errorMessage;
          } catch {
            if (errText.includes("content_policy")) {
              errorMessage = "Content policy violation — please try a different prompt";
            } else if (errText.includes("quota") || errText.includes("rate")) {
              errorMessage = "Rate limit or quota exceeded — try again in a moment";
            }
          }
          controller.enqueue(
            encoder.encode(
              sseEvent({ type: "error", code: "generation_failed", message: errorMessage })
            )
          );
          controller.close();
          return;
        }

        const genData = await genRes.json();
        const responseId = genData.id || genData.data?.[0]?.id || null;
        const imageItem = genData.data?.[0];
        if (!imageItem) {
          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "error",
                code: "no_image",
                message: "No image returned from provider",
              })
            )
          );
          controller.close();
          return;
        }

        // Stage 3: Save locally
        controller.enqueue(
          encoder.encode(sseEvent({ type: "image_status", stage: "uploading" }))
        );

        const isBase64 = !!imageItem.b64_json;
        const rawImage = imageItem.b64_json || imageItem.url;
        if (!rawImage) {
          controller.enqueue(
            encoder.encode(
              sseEvent({ type: "error", code: "no_image_data", message: "Provider returned empty image data" })
            )
          );
          controller.close();
          return;
        }
        const { id, sha256 } = await saveImageLocally(rawImage, isBase64);

        const localUrl = `/api/images/${id}`;
        // Use provider's revised_prompt if available, otherwise use our rewritten prompt
        const revisedPrompt = imageItem.revised_prompt || imagePrompt;

        // Structured log for traceability
        const provider = IMAGE_MODEL.split("/")[0] || "unknown";
        console.log(
          `[image] provider=${provider} model=${IMAGE_MODEL} prompt="${imagePrompt.slice(0, 120)}" response_id=${responseId} file=${id}.png sha256=${sha256}`
        );

        // Record image generation usage
        recordUsage({
          chat_id: chat_id || "",
          message_id: message_id || "",
          kind: "tool_image",
          provider,
          model: IMAGE_MODEL,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0.04, // approximate per-image cost
          latency_ms: 0,
        });

        // Final success event
        controller.enqueue(
          encoder.encode(
            sseEvent({
              type: "image_result",
              url: localUrl,
              prompt: prompt,
              revised_prompt: revisedPrompt,
              size: imageSize,
              model: IMAGE_MODEL,
              provider,
              response_id: responseId,
              sha256,
              id,
            })
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[image-gen] internal error:", message);
        recordUsage({
          chat_id: chat_id || "",
          message_id: message_id || "",
          kind: "tool_image",
          provider: IMAGE_MODEL.split("/")[0] || "unknown",
          model: IMAGE_MODEL,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          latency_ms: 0,
          status: "error",
          error_message: message,
        });
        controller.enqueue(
          encoder.encode(
            sseEvent({ type: "error", code: "internal", message })
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
