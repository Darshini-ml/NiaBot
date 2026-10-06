/**
 * Convert standard Markdown to Slack mrkdwn format.
 */

export function markdownToSlack(md: string): string {
  let text = md;

  // Headings → bold lines
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Bold: **text** or __text__ → *text*
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  text = text.replace(/__(.+?)__/g, '*$1*');

  // Italic: *text* or _text_ (single) → _text_
  // After bold conversion, remaining single * pairs are italic
  // Slack uses _ for italic already, so convert *single* → _single_
  // But we just converted ** to *, so we need to be careful
  // Actually in Slack: *bold* _italic_ ~strike~ `code`
  // Our bold conversion already uses * for bold, which is correct for Slack

  // Strikethrough: ~~text~~ → ~text~
  text = text.replace(/~~(.+?)~~/g, '~$1~');

  // Links: [text](url) → <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Images: ![alt](url) → <url|alt> (Slack can't inline images, just link)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>');

  // Inline code stays as `code`
  // Code blocks stay as ```code```

  // Unordered lists: - item or * item → • item
  text = text.replace(/^[\s]*[-*]\s+/gm, '• ');

  // Ordered lists: 1. item → 1. item (Slack handles these fine)

  // Horizontal rules: --- or *** → ───
  text = text.replace(/^[-*_]{3,}$/gm, '───────────────────');

  // Blockquotes: > text → > text (Slack supports this natively)

  // Clean up excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Split a message into chunks that fit Slack's 4000-char limit.
 * Tries to split at paragraph boundaries.
 */
export function splitMessage(text: string, maxLen = 3900): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try to split at a double newline
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx < maxLen * 0.3) {
      // Try single newline
      splitIdx = remaining.lastIndexOf('\n', maxLen);
    }
    if (splitIdx < maxLen * 0.3) {
      // Try space
      splitIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIdx < maxLen * 0.3) {
      // Hard split
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Convert citation markers [1], [2] etc. to Slack links if sources exist,
 * or strip them entirely if no sources were returned.
 */
export function processCitations(
  text: string,
  sources: Array<{ title: string; url: string }>,
): string {
  if (!sources.length) {
    // Strip all citation markers like [1], [2], [1][2], etc.
    return text.replace(/\s*\[\d+\](\[\d+\])*/g, '');
  }

  // Replace [n] with Slack link <url|[n]>
  return text.replace(/\[(\d+)\]/g, (match, num) => {
    const idx = parseInt(num, 10) - 1;
    if (idx >= 0 && idx < sources.length) {
      return `<${sources[idx].url}|[${num}]>`;
    }
    return match;
  });
}

/**
 * Build a single compact Slack context block for source links.
 * Format: Sources: <url1|domain1> · <url2|domain2> — domain-only, deduped, max 6, citation order.
 */
export function buildSourceBlocks(sources: Array<{ title: string; url: string; favicon?: string }>): any[] {
  if (!sources.length) return [];

  const seen = new Set<string>();
  const deduped: Array<{ url: string; domain: string }> = [];

  for (const s of sources) {
    try {
      const domain = new URL(s.url).hostname.replace(/^www\./, '');
      if (seen.has(domain)) continue;
      seen.add(domain);
      deduped.push({ url: s.url, domain });
      if (deduped.length >= 6) break;
    } catch {
      continue;
    }
  }

  if (!deduped.length) return [];

  const line = 'Sources: ' + deduped.map(d => `<${d.url}|${d.domain}>`).join(' · ');

  return [{
    type: 'context',
    elements: [{ type: 'mrkdwn', text: line }],
  }];
}
