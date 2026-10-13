// Raw recognition is immutable. A review is a separate, locally saved draft.
export function createReview(job, saved) {
  if (!Array.isArray(job.reviewSegments) || !job.reviewSegments.length) return null;
  return job.reviewSegments.map((source, i) => {
    if (source.id !== i || !Number.isFinite(source.startMs) || !Number.isFinite(source.endMs) || source.startMs < 0 || source.endMs < source.startMs || typeof source.text !== 'string') throw new Error('校对片段格式无效。');
    const edit = saved?.jobId === job.id && saved.segments?.[i];
    const valid = edit && edit.original === source.text && edit.startMs === source.startMs && edit.endMs === source.endMs && typeof edit.text === 'string';
    return {...source, original: source.text, text: valid ? edit.text : source.text, confirmed: valid && edit.confirmed === true};
  });
}
export function changeText(segment, text) {
  return {...segment, text, confirmed: false};
}
export function timestamp(ms) {
  const value = Math.max(0, Math.round(ms));
  return `${String(Math.floor(value / 3600000)).padStart(2,'0')}:${String(Math.floor(value / 60000) % 60).padStart(2,'0')}:${String(Math.floor(value / 1000) % 60).padStart(2,'0')},${String(value % 1000).padStart(3,'0')}`;
}
export function exportReview(segments) {
  const kept = segments.filter(s => s.text.trim());
  return {
    text: kept.map(s => s.text.trim()).join('\n'),
    srt: kept.map((s, i) => `${i + 1}\n${timestamp(s.startMs)} --> ${timestamp(s.endMs)}\n${s.text.trim()}\n`).join('\n'),
    confirmed: segments.filter(s => s.confirmed).length,
    total: segments.length
  };
}
