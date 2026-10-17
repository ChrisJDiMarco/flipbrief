const { fallbackMoments, cleanText } = require('./youtube');

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (error) {
      return null;
    }
  }
}

function normalizePlan(rawPlan, segments, desired = 5) {
  const plan = typeof rawPlan === 'string' ? extractJson(rawPlan) : rawPlan;
  const fallback = fallbackMoments(segments, desired);
  if (!plan || typeof plan !== 'object') {
    return {
      summary: fallbackSummary(segments),
      moments: fallback,
    };
  }

  const moments = Array.isArray(plan.moments)
    ? plan.moments
        .map((moment, index) => ({
          startSec: Number.isFinite(Number(moment.startSec)) ? Math.max(0, Number(moment.startSec)) : fallback[index]?.startSec || 0,
          heading: cleanText(moment.heading || fallback[index]?.heading || `Key moment ${index + 1}`).slice(0, 80),
          body: cleanText(moment.body || moment.why || fallback[index]?.body || '').slice(0, 320),
        }))
        .filter((moment) => moment.body)
        .slice(0, 8)
    : [];

  return {
    summary: cleanText(plan.summary || fallbackSummary(segments)).slice(0, 900),
    moments: moments.length ? moments : fallback,
  };
}

function fallbackSummary(segments) {
  const text = cleanText((segments || []).map((seg) => seg.text).join(' '));
  if (!text) return 'No usable transcript was available for this video.';
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  return cleanText(sentences.slice(0, 3).join(' ')).slice(0, 600);
}

module.exports = {
  extractJson,
  normalizePlan,
  fallbackSummary,
};
