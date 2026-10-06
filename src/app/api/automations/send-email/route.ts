import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/automations/send-email
 * Sends an automation run result via email.
 * In production this would use Gmail API with OAuth.
 * For now, simulates sending and returns a provider message id.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { to, subject, body: emailBody, automation_id, run_id } = body;

    if (!to || !subject) {
      return NextResponse.json(
        { error: "Missing required fields: to, subject" },
        { status: 400 }
      );
    }

    // Log the attempt server-side
    console.log(
      `[Email] Sending to=${to} subject="${subject}" automation_id=${automation_id} run_id=${run_id}`
    );

    // TODO: In production, use Gmail API with OAuth token:
    // 1. Check if Gmail OAuth token exists and includes gmail.send scope
    // 2. If token expired, refresh it
    // 3. If refresh fails, return 401 with "Gmail not connected" error
    // 4. Send via users.messages.send

    // Simulate email sending with a short delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Generate a fake provider message id
    const messageId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    console.log(
      `[Email] Sent successfully: messageId=${messageId} to=${to} automation_id=${automation_id} run_id=${run_id}`
    );

    return NextResponse.json({
      id: messageId,
      status: "sent",
      to,
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    console.error(`[Email] Error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
