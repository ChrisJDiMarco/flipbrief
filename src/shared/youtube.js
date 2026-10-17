const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (VIDEO_ID_RE.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    if (!host.endsWith('youtube.com')) return null;
    const fromQuery = url.searchParams.get('v');
    if (fromQuery && VIDEO_ID_RE.test(fromQuery)) return fromQuery;
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = ['embed', 'shorts', 'live'].find((part) => parts.includes(part));
    if (marker) {
      const id = parts[parts.indexOf(marker) + 1];
      return VIDEO_ID_RE.test(id) ? id : null;
    }
  } catch (_) {
    return null;
  }
  return null;
}

function extractPlaylistId(input) {
  if (!input) return null;
  const raw = String(input).trim();
  try {
    const url = new URL(raw);
    return url.searchParams.get('list') || null;
  } catch (_) {
    return /^[a-zA-Z0-9_-]{12,}$/.test(raw) ? raw : null;
  }
}

function coerceLatestCount(value, fallback = 20) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(50, parsed));
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanText(text) {
  return decodeEntities(String(text || '').replace(/\s+/g, ' ').trim());
}

function parseCaptionXml(xml) {
  const out = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = re.exec(String(xml || '')))) {
    const attrs = match[1] || '';
    const start = Number((attrs.match(/\bstart="([^"]+)"/) || [])[1]);
    const dur = Number((attrs.match(/\bdur="([^"]+)"/) || [])[1] || 0);
    const text = cleanText(match[2]);
    if (Number.isFinite(start) && text) out.push({ start, end: start + Math.max(0.1, dur), text });
  }
  return out;
}

function parseCaptionJson3(json) {
  const payload = typeof json === 'string' ? JSON.parse(json) : json;
  const events = Array.isArray(payload.events) ? payload.events : [];
  return events
    .map((event) => {
      const text = (event.segs || []).map((seg) => seg.utf8 || '').join('');
      const start = Number(event.tStartMs || 0) / 1000;
      const end = start + Number(event.dDurationMs || 0) / 1000;
      return { start, end: end > start ? end : start + 3, text: cleanText(text) };
    })
    .filter((seg) => Number.isFinite(seg.start) && seg.text);
}

function validateTimestamp(seconds, duration = Infinity) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, duration));
}

function compactTranscript(segments, maxChars = 10000) {
  const text = (segments || [])
    .map((seg) => `[${Math.round(seg.start)}s] ${seg.text}`)
    .join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[...]` : text;
}

function fallbackMoments(segments, desired = 5) {
  const usable = (segments || []).filter((seg) => seg.text && Number.isFinite(seg.start));
  if (!usable.length) return [];
  const count = Math.max(1, Math.min(8, desired, usable.length));
  const stride = usable.length / count;
  return Array.from({ length: count }, (_, index) => {
    const chunk = usable.slice(Math.floor(index * stride), Math.max(Math.floor((index + 1) * stride), Math.floor(index * stride) + 1));
    const picked = chunk[Math.floor(chunk.length / 2)] || usable[Math.floor(index * stride)];
    const text = cleanText(chunk.map((seg) => seg.text).join(' ')).slice(0, 240);
    return {
      startSec: validateTimestamp(picked.start),
      heading: index === 0 ? 'Opening idea' : `Key moment ${index + 1}`,
      body: text,
    };
  });
}

module.exports = {
  extractVideoId,
  extractPlaylistId,
  coerceLatestCount,
  parseCaptionXml,
  parseCaptionJson3,
  validateTimestamp,
  compactTranscript,
  fallbackMoments,
  cleanText,
};
