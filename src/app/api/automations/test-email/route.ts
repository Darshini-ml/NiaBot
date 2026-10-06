import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/automations/test-email
 * Sends a test email to verify delivery pipeline.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email address is required" },
        { status: 400 }
      );
    }

    console.log(`[TestEmail] Sending test email to ${email}`);

    // Forward to the send-email endpoint
    const origin = req.nextUrl.origin;
    const res = await fetch(`${origin}/api/automations/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        subject: "[NiaAI] Test Email — Delivery Verification",
        body: "This is a test email from NiaAI to verify your email delivery pipeline is working correctly.\n\nIf you received this email, your automation notifications will be delivered successfully.",
        automation_id: "test",
        run_id: "test",
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json(
        { error: err.error || "Failed to send test email" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      success: true,
      message_id: data.id,
      sent_at: data.sent_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send test email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
