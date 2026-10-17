import { describe, expect, it } from 'vitest';
import youtube from '../src/shared/youtube.js';
import aiPlan from '../src/shared/ai-plan.js';

const {
  extractVideoId,
  extractPlaylistId,
  coerceLatestCount,
  parseCaptionXml,
  parseCaptionJson3,
  validateTimestamp,
  fallbackMoments,
} = youtube;
const { normalizePlan } = aiPlan;

describe('youtube helpers', () => {
  it('extracts video IDs from common YouTube URLs', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=4')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts playlist IDs and clamps latest counts', () => {
    expect(extractPlaylistId('https://www.youtube.com/playlist?list=PLabc_123456789')).toBe('PLabc_123456789');
    expect(coerceLatestCount(999)).toBe(50);
    expect(coerceLatestCount(0)).toBe(1);
    expect(coerceLatestCount('nope')).toBe(20);
  });

  it('parses XML and json3 captions', () => {
    expect(parseCaptionXml('<text start="1.5" dur="2">Hello &amp; welcome</text>')).toEqual([
      { start: 1.5, end: 3.5, text: 'Hello & welcome' },
    ]);
    const parsed = parseCaptionJson3({ events: [{ tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'A' }, { utf8: ' point' }] }] });
    expect(parsed[0]).toEqual({ start: 2, end: 3, text: 'A point' });
  });

  it('validates timestamps and creates deterministic fallback moments', () => {
    const segments = Array.from({ length: 6 }, (_, i) => ({ start: i * 10, end: i * 10 + 4, text: `Segment ${i}` }));
    expect(validateTimestamp(-10, 20)).toBe(0);
    expect(validateTimestamp(50, 20)).toBe(20);
    expect(fallbackMoments(segments, 3)).toHaveLength(3);
  });

  it('normalizes malformed AI output with a fallback plan', () => {
    const segments = [{ start: 0, end: 5, text: 'This is the actual transcript.' }];
    const plan = normalizePlan('not json', segments, 1);
    expect(plan.summary).toContain('actual transcript');
    expect(plan.moments).toHaveLength(1);
  });
});
