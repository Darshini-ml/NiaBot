import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { audio, language = "en" } = body;

    // In production, this would forward to:
    // - OpenAI Whisper API
    // - Deepgram
    // - Google Cloud Speech-to-Text
    // For now, the browser's SpeechRecognition API handles STT client-side

    return NextResponse.json({
      transcript: "",
      is_final: true,
      confidence: 0,
      message: "STT is handled client-side via SpeechRecognition API"
    });
  } catch (error) {
    return NextResponse.json(
      { error: "STT processing failed" },
      { status: 500 }
    );
  }
}
