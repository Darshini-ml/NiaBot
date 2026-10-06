const NIA_BASE = process.env.NIA_APP_URL || process.env.NIA_BASE_URL || 'http://localhost:3000';
const NIA_TOKEN = process.env.NIA_INTERNAL_TOKEN || '';

export interface NiaChatRequest {
  source: 'discord';
  text: string;
  conversation_key: string;
  channel_name?: string;
  user_id: string;
  user_name?: string;
  model?: string;
  web_search?: boolean;
  attachments?: Array<{ id: string; name: string; mimeType: string; extractedText?: string }>;
}

// NiaSSEEvent - same as Slack's
export interface NiaSSEEvent {
  type: 'status' | 'content' | 'sources' | 'done' | 'error' | 'usage' | 'link_cards' | 'file' | 'image' | 'replace_content';
  text?: string;
  items?: Array<{ title: string; url: string; favicon?: string }>;
  finish_reason?: string;
  usage?: { input_tokens: number; output_tokens: number; reasoning_tokens?: number; served_model?: string; requested_model?: string; request_id?: string; };
  error_type?: string;
  url?: string;
  filename?: string;
  mimeType?: string;
  pages?: number;
  size_bytes?: number;
  file_id?: string;
  title?: string;
  revised_prompt?: string;
  id?: string;
  model?: string;
  provider?: string;
}

export async function downloadFromNia(relativeUrl: string): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  // Same as Slack but with [discord] log prefix
  const start = Date.now();
  const dlController = new AbortController();
  const dlTimeout = setTimeout(() => {
    console.log(`[discord] aborted stage=download elapsed=${Date.now() - start}ms url=${relativeUrl}`);
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
      console.error(`[discord] download failed status=${res.status} url=${relativeUrl} elapsed=${Date.now() - start}ms`);
      return null;
    }
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const disposition = res.headers.get('content-disposition') || '';
    const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
    const filename = filenameMatch?.[1] || relativeUrl.split('/').pop() || 'file';
    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`[discord] download ok url=${relativeUrl} size=${buffer.length} elapsed=${Date.now() - start}ms`);
    return { buffer, filename, mimeType: contentType };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error(`[discord] aborted stage=download elapsed=${Date.now() - start}ms url=${relativeUrl}`);
    } else {
      console.error(`[discord] download error url=${relativeUrl}:`, err?.message);
    }
    return null;
  } finally {
    clearTimeout(dlTimeout);
  }
}

export async function sendHeartbeat(status: {
  connected: boolean;
  guild?: string;
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
      body: JSON.stringify({ source: 'discord', ...status }),
    });
  } catch {
    // Silently fail
  }
}

export async function* streamChat(req: NiaChatRequest): AsyncGenerator<NiaSSEEvent> {
  const url = `${NIA_BASE}/api/integrations/chat`;
  const streamStart = Date.now();
  const sseController = new AbortController();
  const sseTimeoutId = setTimeout(() => {
    console.log(`[discord] aborted stage=sse elapsed=${Date.now() - streamStart}ms (120s timeout)`);
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
      // @ts-ignore
      keepalive: true,
    });
  } catch (err: any) {
    clearTimeout(sseTimeoutId);
    if (err?.name === 'AbortError') {
      yield { type: 'error', text: `Request timed out after ${Math.round((Date.now() - streamStart) / 1000)}s.` };
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
          yield JSON.parse(data) as NiaSSEEvent;
        } catch {}
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      yield { type: 'error', text: `SSE stream aborted after ${Math.round((Date.now() - streamStart) / 1000)}s.` };
    } else {
      throw err;
    }
  } finally {
    clearTimeout(sseTimeoutId);
  }
}

export async function uploadToNia(buffer: Buffer, filename: string, mimeType: string): Promise<{ id: string; extractedText?: string; pages?: number } | null> {
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
    return (await res.json()) as { id: string; extractedText?: string; pages?: number };
  } catch {
    return null;
  }
}
