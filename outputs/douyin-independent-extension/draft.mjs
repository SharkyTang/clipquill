import {timestamp} from './review.mjs';

// A draft owns text; source intervals remain immutable. Edits spanning several
// blocks merge their existing intervals instead of inventing alignment times.
function signature(sources) {
  return JSON.stringify(sources.map(s => [s.startMs, s.endMs, s.original]));
}
function join(blocks) { return blocks.map(b => b.text).join('\n'); }
function validSources(sources, durationMs) {
  // SRT timestamps have millisecond precision, as does timestamp(). Keep the
  // source endpoints intact and compare against the same rounded media bound.
  const mediaEndMs = Math.round(durationMs);
  return sources.length > 0 && sources.every((s, i) =>
    Number.isFinite(s.startMs) && Number.isFinite(s.endMs) &&
    s.startMs >= 0 && s.endMs > s.startMs &&
    (!i || s.startMs >= sources[i - 1].endMs) &&
    (!Number.isFinite(durationMs) || s.endMs <= mediaEndMs));
}
export function createDraft(job, review, saved) {
  const sources = (review || []).map(s => ({...s}));
  const blocks = sources.length
    ? sources.map((s, i) => ({sourceIds:[i], text:s.text, confirmed:s.confirmed === true}))
    : [{sourceIds:[], text:job.text, confirmed:false}];
  const draft = {version:1, jobId:job.id, sourceSignature:signature(sources), sources, blocks,
    durationMs:job.durationSeconds * 1000, edited:false};
  const rejected = () => ({...draft,restoreWarning:saved ? '已保存的当前稿与原文或时间不匹配，未加载该稿。旧稿仍保留，请检查当前内容后再导出。' : ''});
  if (saved?.version !== 1 || saved.jobId !== job.id || saved.sourceSignature !== draft.sourceSignature) return rejected();
  if (!Array.isArray(saved.blocks) || !saved.blocks.length) return rejected();
  const ids = saved.blocks.flatMap(b => Array.isArray(b.sourceIds) ? b.sourceIds : [-1]);
  const valid = ids.every((id,i) => Number.isInteger(id) && id >= 0 && id < sources.length && (!i || id > ids[i-1])) &&
    saved.blocks.every(b => typeof b.text === 'string' && Array.isArray(b.sourceIds) &&
      (sources.length ? b.sourceIds.length > 0 : saved.blocks.length === 1));
  if (valid) {
    draft.blocks = saved.blocks.map(b => ({sourceIds:[...b.sourceIds], text:b.text, confirmed:b.confirmed === true}));
    draft.edited = saved.edited === true;
  } else return rejected();
  return draft;
}
export function saveableDraft(draft) {
  return {version:1, jobId:draft.jobId, sourceSignature:draft.sourceSignature, blocks:draft.blocks, edited:draft.edited};
}
export function draftText(draft) { return join(draft.blocks); }
export function editFullText(draft, text, range) {
  const old = draftText(draft);
  if (old === text) return draft;
  let from = 0, to, inserted;
  // beforeinput gives exact selection even when identical sentences repeat.
  if (range && Number.isInteger(range.start) && Number.isInteger(range.end) &&
      range.start >= 0 && range.end >= range.start && range.end <= old.length &&
      text.startsWith(old.slice(0, range.start)) && text.endsWith(old.slice(range.end)) &&
      text.length >= range.start + old.length - range.end) {
    from = range.start; to = range.end;
    inserted = text.slice(from, text.length - (old.length - to));
  } else {
    while (from < old.length && from < text.length && old[from] === text[from]) from++;
    let suffix = 0;
    while (suffix < old.length - from && suffix < text.length - from && old[old.length-1-suffix] === text[text.length-1-suffix]) suffix++;
    to = old.length - suffix; inserted = text.slice(from, text.length - suffix);
  }
  const spans = []; let cursor = 0;
  for (const b of draft.blocks) { spans.push({start:cursor,end:cursor+b.text.length}); cursor += b.text.length + 1; }
  const first = Math.max(0, spans.findIndex(s => s.end >= from));
  let last = first;
  while (last < spans.length-1 && to > spans[last].end) last++;
  // Deleting complete lines removes their cues. Remaining lines retain their
  // own times; deleting a separator alone intentionally merges the intervals.
  if (!inserted && first < last) {
    let blocks;
    if (from === spans[first].start && to === spans[last].start)
      blocks = [...draft.blocks.slice(0,first),...draft.blocks.slice(last)];
    else if (from === spans[first].end && to === spans[last].end)
      blocks = [...draft.blocks.slice(0,first+1),...draft.blocks.slice(last+1)];
    if (blocks && join(blocks) === text) return {...draft,blocks,edited:true};
  }
  const affected = draft.blocks.slice(first,last+1);
  const merged = {sourceIds:affected.flatMap(b => b.sourceIds),
    text:old.slice(spans[first].start,from) + inserted + old.slice(to,spans[last].end), confirmed:false};
  const blocks = [...draft.blocks.slice(0,first),merged,...draft.blocks.slice(last+1)];
  if (join(blocks) !== text) throw new Error('修改位置无法映射，请撤销后重试。');
  return {...draft,blocks,edited:true};
}
export function editBlock(draft, index, text) {
  return {...draft, edited:true, blocks:draft.blocks.map((b,i) => i===index ? {...b,text,confirmed:false} : b)};
}
export function draftSegments(draft) {
  return draft.blocks.map(b => {
    const sources = b.sourceIds.map(id => draft.sources[id]);
    return {...b, startMs:sources.length ? Math.min(...sources.map(s=>s.startMs)) : undefined,
      endMs:sources.length ? Math.max(...sources.map(s=>s.endMs)) : undefined,
      original:sources.map(s => s.original).join('\n'), needsAttention:sources.some(s => s.needsAttention),
      referenceText:sources.map(s => s.referenceText || '').filter(Boolean).join('\n')};
  });
}
export function exportDraft(draft) {
  const text = draftText(draft), segments = draftSegments(draft);
  const kept = segments.filter(s => s.text.trim());
  let srtError = '';
  if (!text.trim()) srtError = '当前稿为空，请先填写文案。';
  else if (!draft.sources.length) srtError = '当前稿没有原字幕时间。可复制或导出 TXT；重新提取后再导出 SRT。';
  else if (!validSources(kept,draft.durationMs)) srtError = '当前稿有片段缺少有效时间，不能安全导出 SRT。可将该段与相邻段合并，或删除该段整行及换行后重试；复制和 TXT 仍可用。';
  else if (text.split('\n').some(line => !line.trim()) || /-->/.test(text))
    srtError = '当前稿含空白行或字幕分隔符，无法安全写入 SRT。请删除空白行或分隔符，或导出 TXT。';
  return {text, srt:srtError ? null : kept.map((s,i) => `${i+1}\n${timestamp(s.startMs)} --> ${timestamp(s.endMs)}\n${s.text}\n`).join('\n'),
    srtError, confirmed:segments.filter(s=>s.confirmed).length, total:segments.length};
}
