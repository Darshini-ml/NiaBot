/**
 * Client for calling the local NiaAI backend (http://localhost:3000).
 * Streams SSE responses and parses events.
 *
 * Abort handling:
 * - SSE stream fetch has its own AbortController (120s total timeout)
 * - File downloads have their own AbortController (60s per download)
 * - The SSE timeout is cleared only after the stream fully closes
 * - Downloads are never aborted by the SSE controller
 */

const NIA_BASE = process.env.NIA_APP_URL || process.env.NIA_BASE_URL || 'http://localhost:3000';
const NIA_TOKEN = process.env.NIA_INTERNAL_TOKEN || '';

export interface NiaMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{ id: string; name: string; mimeType: string; extractedText?: string }>;
}

export interface NiaChatRequest {
  text: string;
  channel_id: string;
  thread_ts: string;
  slack_user_id: string;
  slack_user_name?: string;
  channel_name?: string;
  model?: string;
  web_search?: boolean;
  attachments?: Array<{ id: string; name: string; mimeType: string; extractedText?: string }>;
}

export interface NiaSSEEvent {
  type: 'status' | 'content' | 'sources' | 'done' | 'error' | 'usage' | 'link_cards' | 'file' | 'image' | 'replace_content';
  text?: string;
  items?: Array<{ title: string; url: string; favicon?: string }>;
  finish_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
    served_model?: string;
    requested_model?: string;
    request_id?: string;
  };
  error_type?: string;
  // File events (PDF/document produced by NiaAI)
  url?: string;
  filename?: string;
  mimeType?: string;
  pages?: number;
  size_bytes?: number;
  file_id?: string;
  title?: string;
  // Image events
  revised_prompt?: string;
  id?: string;
  model?: string;
  provider?: string;
}

/**
 * Download a file from NiaAI by its relative URL (e.g. /api/files/uuid).
 * Has its own 60s AbortController — never shares with the SSE stream.
 * Returns { buffer, filename, mimeType } or null on failure.
 */
export async function downloadFromNia(
  relativeUrl: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  const start = Date.now();
  const dlController = new AbortController();
  const dlTimeout = setTimeout(() => {
    console.log(`[slack] aborted stage=download elapsed=${Date.now() - start}ms url=${relativeUrl}`);
    dlController.abort();
  }, 60_000);

  try {
    const separator = relativeUrl.includes('?') ? '&' : '?';
    const url = `${NIA_BASE}${relativeUrl}${separator}download=1`;
    const res = await fetch(url, {
      headers: NIA_TOKEN ? { Authorization: `Bearer ${NIA_TOKEN}` } : {},
      signal: dlController.signal,
    });
    if (!res.ok) {
      console.error(`[slack] download failed status=${res.status} url=${relativeUrl} elapsed=${Date.now() - start}ms`);
      return null;
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const disposition = res.headers.get('content-disposition') || '';
    const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
    const filename = filenameMatch?.[1] || relativeUrl.split('/').pop() || 'file';
    const buffer = Buffer.from(await res.arrayBuffer());

    console.log(`[slack] download ok url=${relativeUrl} size=${buffer.length} elapsed=${Date.now() - start}ms`);
    return { buffer, filename, mimeType: contentType };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error(`[slack] aborted stage=download elapsed=${Date.now() - start}ms url=${relativeUrl}`);
    } else {
      console.error(`[slack] download error url=${relativeUrl}:`, err?.message);
    }
    return null;
  } finally {
    clearTimeout(dlTimeout);
  }
}

/**
 * Send a heartbeat to the NiaAI status endpoint.
 */
export async function sendHeartbeat(status: {
  connected: boolean;
  workspace?: string;
  botUser?: string;
  lastEventTime?: string;
}): Promise<void> {
  try {
    await fetch(`${NIA_BASE}/api/integrations/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(NIA_TOKEN ? { Authorization: `Bearer ${NIA_TOKEN}` } : {}),
      },
      body: JSON.stringify({ source: 'slack', ...status }),
    });
  } catch {
    // Silently fail — NiaAI may not be running
  }
}

/**
 * Call NiaAI /api/slack/chat and yield SSE events as they arrive.
 *
 * The SSE fetch has its own AbortController with a 120s timeout.
 * This timeout is created ONCE per request and cleared in `finally`.
 * The `for await` loop does NOT return early on status events — every
 * event is yielded to the consumer.
 */
export async function* streamChat(req: NiaChatRequest): AsyncGenerator<NiaSSEEvent> {
  const url = `${NIA_BASE}/api/slack/chat`;
  const streamStart = Date.now();

  // SSE-only controller — 120s timeout (generous for image gen + PDF render)
  const sseController = new AbortController();
  const sseTimeoutId = setTimeout(() => {
    const elapsed = Date.now() - streamStart;
    console.log(`[slack] aborted stage=sse elapsed=${elapsed}ms (120s timeout)`);
    sseController.abort();
  }, 120_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(NIA_TOKEN ? { Authorization: `Bearer ${NIA_TOKEN}` } : {}),
      },
      body: JSON.stringify(req),
      signal: sseController.signal,
      // @ts-ignore — Node 18+ undici options to prevent idle body kill
      keepalive: true,
    });
  } catch (err: any) {
    clearTimeout(sseTimeoutId);
    if (err?.name === 'AbortError') {
      const elapsed = Date.now() - streamStart;
      yield { type: 'error', text: `Request timed out after ${Math.round(elapsed / 1000)}s. The server may be overloaded.` };
      return;
    }
    throw err;
  }

  if (!res.ok) {
    clearTimeout(sseTimeoutId);
    const text = await res.text().catch(() => '');
    yield { type: 'error', text: `NiaAI returned ${res.status}: ${text}` };
    return;
  }

  if (!res.body) {
    clearTimeout(sseTimeoutId);
    yield { type: 'error', text: 'No response body from NiaAI' };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const event: NiaSSEEvent = JSON.parse(data);
          yield event;
        } catch {
          // Skip malformed events
        }
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      const elapsed = Date.now() - streamStart;
      yield { type: 'error', text: `SSE stream aborted after ${Math.round(elapsed / 1000)}s.` };
    } else {
      throw err;
    }
  } finally {
    clearTimeout(sseTimeoutId);
  }
}

/**
 * Upload a file buffer to NiaAI /api/uploads.
 */
export async function uploadToNia(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{ id: string; extractedText?: string; pages?: number; entries?: number } | null> {
  try {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append('file', blob, filename);

    const res = await fetch(`${NIA_BASE}/api/uploads`, {
      method: 'POST',
      headers: NIA_TOKEN ? { Authorization: `Bearer ${NIA_TOKEN}` } : {},
      body: formData,
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    return {
      id: data.id,
      extractedText: data.extractedText,
      pages: data.pages,
      entries: data.extractionMeta?.entries,
    };
  } catch {
    return null;
  }
}
