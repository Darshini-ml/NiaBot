/**
 * Process citations [n] → [n](url) for Discord.
 */
export function processCitations(text: string, sources: Array<{ title: string; url: string }>): string {
  if (!sources.length) {
    return text.replace(/\s*\[\d+\](\[\d+\])*/g, '');
  }
  return text.replace(/\[(\d+)\]/g, (match, num) => {
    const idx = parseInt(num, 10) - 1;
    if (idx >= 0 && idx < sources.length) {
      return `[${num}](${sources[idx].url})`;
    }
    return match;
  });
}

/**
 * Build a compact Sources line: Sources: [apple.com](url) · [flipkart.com](url2)
 * Domain-only, deduped, max 6, citation order.
 */
export function buildSourcesLine(sources: Array<{ title: string; url: string }>): string {
  if (!sources.length) return '';
  const seen = new Set<string>();
  const deduped: Array<{ url: string; domain: string }> = [];
  for (const s of sources) {
    try {
      const domain = new URL(s.url).hostname.replace(/^www\./, '');
      if (seen.has(domain)) continue;
      seen.add(domain);
      deduped.push({ url: s.url, domain });
      if (deduped.length >= 6) break;
    } catch { continue; }
  }
  if (!deduped.length) return '';
  return 'Sources: ' + deduped.map(d => `[${d.domain}](${d.url})`).join(' · ');
}

/**
 * Convert markdown tables to code blocks for Discord (tables render poorly).
 */
export function tablesToCodeBlocks(text: string): string {
  return text.replace(
    /(?:^|\n)(\|.+\|(?:\n\|[-:| ]+\|)?(?:\n\|.+\|)*)/gm,
    (match) => '\n```\n' + match.trim() + '\n```'
  );
}

/**
 * Split a message into chunks that fit Discord's 2000-char limit.
 * Splits at paragraph boundaries.
 */
export function splitMessage(text: string, maxLen = 1950): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx < maxLen * 0.3) splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.3) splitIdx = remaining.lastIndexOf(' ', maxLen);
    if (splitIdx < maxLen * 0.3) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
