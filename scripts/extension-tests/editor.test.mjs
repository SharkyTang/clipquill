import test from 'node:test';
import assert from 'node:assert/strict';
import {createReview} from '../../outputs/douyin-independent-extension/review.mjs';
import {createDraft, draftText, draftSegments, exportDraft, saveableDraft} from '../../outputs/douyin-independent-extension/draft.mjs';
import {createDraftEditor} from '../../outputs/douyin-independent-extension/editor.mjs';

const job = {id:'a'.repeat(32), text:'第一句。\n第二句。\n第三句。', durationSeconds:10,
  reviewSegments:[{id:0,startMs:100,endMs:2000,text:'第一句。'},
    {id:1,startMs:3000,endMs:5000,text:'第二句。'}, {id:2,startMs:6000,endMs:8000,text:'第三句。'}]};
const fresh = () => createDraft(job, createReview(job));
const field = (value, start = 0, end = start) => ({value, selectionStart:start, selectionEnd:end});
function change(editor, target, value, start, end, inputType = 'insertText') {
  const previous = target === 'full' ? draftText(editor.draft) : editor.draft.blocks[target].text;
  editor.beforeInput(target, field(previous, start, end), {inputType});
  return editor.input(target, field(value), {inputType});
}
const times = draft => draftSegments(draft).map(segment => [segment.startMs, segment.endMs]);

test('Chinese composition commits once, retains the original selection, and ignores duplicate final input', () => {
  const draft = fresh(); draft.blocks[0].confirmed = true; draft.blocks[1].confirmed = true;
  const editor = createDraftEditor(draft), original = draftText(draft);
  editor.compositionStart('full', field(original, 5, 8));
  editor.beforeInput('full', field(original, 5, 8), {inputType:'insertCompositionText'});
  for (const value of ['第一句。\nz\n第三句。', '第一句。\nzhong\n第三句。', '第一句。\n中文\n第三句。']) {
    const result = editor.input('full', field(value), {isComposing:true, inputType:'insertCompositionText'});
    assert.equal(result.changed, false); assert.equal(result.pending, true);
    assert.equal(draftText(result.draft), original);
  }
  const value = '第一句。\n中文。\n第三句。';
  const result = editor.compositionEnd('full', field(value));
  assert.equal(result.changed, true); assert.equal(result.pending, false);
  assert.equal(draftText(result.draft), value);
  assert.deepEqual(result.draft.blocks.map(block => block.sourceIds), [[0],[1],[2]]);
  assert.deepEqual(result.draft.blocks.map(block => block.confirmed), [true,false,false]);
  assert.equal(editor.input('full', field(value), {inputType:'insertFromComposition'}).changed, false);
  assert.equal(editor.input('full', field(value), {inputType:'insertCompositionText',isComposing:true}).pending, false);
  assert.deepEqual(times(result.draft), [[100,2000],[3000,5000],[6000,8000]]);
});

test('cancelled and segment composition neither store intermediate pinyin nor duplicate final saves', () => {
  const editor = createDraftEditor(fresh()), initial = editor.draft;
  editor.compositionStart('full', field(draftText(initial), 5));
  editor.input('full', field('第一句。\npinyin第二句。\n第三句。'), {isComposing:true});
  assert.equal(editor.compositionEnd('full', field(draftText(initial))).changed, false);
  assert.equal(editor.draft, initial);
  editor.compositionStart(1, field('第二句。', 0, 3));
  assert.equal(editor.input(1, field('xin。'), {isComposing:true}).changed, false);
  assert.equal(editor.compositionEnd(1, field('新句。')).changed, true);
  assert.equal(editor.input(1, field('新句。'), {inputType:'insertFromComposition'}).changed, false);
  assert.match(exportDraft(editor.draft).srt, /00:00:03,000 --> 00:00:05,000\n新句。/);
});

test('a composing input still defers mapping when the browser omits compositionstart', () => {
  const editor = createDraftEditor(fresh()), original = draftText(editor.draft);
  editor.beforeInput('full', field(original, 5, 8), {inputType:'insertCompositionText'});
  const interim = editor.input('full', field('第一句。\nzhong。\n第三句。'), {isComposing:true});
  assert.equal(interim.pending, true); assert.equal(draftText(interim.draft), original);
  const final = editor.compositionEnd('full', field('第一句。\n中文。\n第三句。'));
  assert.equal(final.changed, true); assert.deepEqual(times(final.draft), [[100,2000],[3000,5000],[6000,8000]]);
});

test('native undo restores separate source intervals after a merge, and native redo restores the merged mapping', () => {
  const editor = createDraftEditor(fresh()), original = draftText(editor.draft);
  const merged = '第一句。第二句。\n第三句。';
  change(editor, 'full', merged, 4, 5, 'deleteContentBackward');
  assert.deepEqual(times(editor.draft), [[100,5000],[6000,8000]]);
  const undo = change(editor, 'full', original, 0, merged.length, 'historyUndo');
  assert.equal(undo.historyRestored, true);
  assert.deepEqual(undo.draft.blocks.map(block => block.sourceIds), [[0],[1],[2]]);
  assert.deepEqual(times(undo.draft), [[100,2000],[3000,5000],[6000,8000]]);
  const redo = change(editor, 'full', merged, 0, original.length, 'historyRedo');
  assert.equal(redo.historyRestored, true);
  assert.deepEqual(times(redo.draft), [[100,5000],[6000,8000]]);
});

test('grouped native undo skips intermediate snapshots and divergent edits discard the redo branch', () => {
  const editor = createDraftEditor(fresh()), original = draftText(editor.draft);
  change(editor, 'full', original.replace('第二', '第a二'), 6, 6);
  change(editor, 'full', original.replace('第二', '第ab二'), 7, 7);
  assert.equal(change(editor, 'full', original, 0, 0, 'historyUndo').historyRestored, true);
  assert.deepEqual(times(editor.draft), [[100,2000],[3000,5000],[6000,8000]]);
  change(editor, 'full', original.replace('第二', '新二'), 5, 6);
  const staleRedo = change(editor, 'full', original.replace('第二', '第ab二'), 0, 0, 'historyRedo');
  assert.equal(staleRedo.historyRestored, false); assert.match(staleRedo.warning, /缓存/);
  assert.equal(exportDraft(editor.draft).text, original.replace('第二', '第ab二'));
});

test('newlines, complete line deletion, cross-segment paste and current TXT/SRT keep the original mapping rules', () => {
  const editor = createDraftEditor(fresh());
  change(editor, 'full', '第一句。\n第二句。新增\n补充。\n第三句。', 9, 9, 'insertFromPaste');
  assert.deepEqual(times(editor.draft), [[100,2000],[3000,5000],[6000,8000]]);
  assert.match(exportDraft(editor.draft).srt, /第二句。新增\n补充。/);
  editor.reset(fresh());
  change(editor, 'full', '第一句。\n第三句。', 5, 10, 'deleteByCut');
  assert.deepEqual(times(editor.draft), [[100,2000],[6000,8000]]);
  editor.reset(fresh());
  change(editor, 'full', '第一跨段中文 English！三句。', 2, 11, 'insertFromPaste');
  assert.deepEqual(times(editor.draft), [[100,8000]]);
  assert.equal(exportDraft(editor.draft).text, '第一跨段中文 English！三句。');
  assert.match(exportDraft(editor.draft).srt, /00:00:00,100 --> 00:00:08,000\n第一跨段中文 English！三句。/);
  change(editor, 'full', '', 0, draftText(editor.draft).length, 'deleteByCut');
  assert.equal(exportDraft(editor.draft).srt, null); assert.equal(exportDraft(editor.draft).text, '');
});

test('a repeated-sentence selection and emoji backspace preserve unaffected confirmations and time intervals', () => {
  const repeated = {...job, reviewSegments:job.reviewSegments.map(segment => ({...segment,text:'相同🙂'}))};
  const draft = createDraft(repeated, createReview(repeated)); draft.blocks[0].confirmed = true;
  const editor = createDraftEditor(draft);
  change(editor, 'full', '相同🙂\n相同\n相同🙂', 9, 9, 'deleteContentBackward');
  assert.deepEqual(editor.draft.blocks.map(block => block.sourceIds), [[0],[1],[2]]);
  assert.equal(editor.draft.blocks[0].confirmed, true);
  assert.deepEqual(times(editor.draft), [[100,2000],[3000,5000],[6000,8000]]);
});

test('segment edits and native undo use the current draft, and saveable data keeps the existing schema', () => {
  const editor = createDraftEditor(fresh());
  change(editor, 1, '新稿 English。', 0, 4, 'insertFromPaste');
  let output = exportDraft(editor.draft);
  assert.equal(output.text, '第一句。\n新稿 English。\n第三句。'); assert.match(output.srt, /新稿 English。/);
  assert.equal(change(editor, 1, '第二句。', 0, 0, 'historyUndo').historyRestored, true);
  output = exportDraft(editor.draft);
  assert.equal(output.text, job.text); assert.match(output.srt, /第二句。/);
  const saved = saveableDraft(editor.draft);
  assert.deepEqual(Object.keys(saved), ['version','jobId','sourceSignature','blocks','edited']);
  assert.deepEqual(exportDraft(createDraft(job, createReview(job), JSON.parse(JSON.stringify(saved)))), output);
});

test('switching the segment textarea discards the old segment stack and never rolls back other blocks', () => {
  const editor = createDraftEditor(fresh());
  change(editor, 1, '第二段已改。', 0, 4, 'insertFromPaste');
  change(editor, 2, '第三段已改。', 0, 4, 'insertFromPaste');
  const result = change(editor, 1, '第二句。', 0, 0, 'historyUndo');
  assert.equal(result.historyRestored, false); assert.match(result.warning, /缓存/);
  assert.equal(result.draft.blocks[2].text, '第三段已改。');
  assert.deepEqual(times(result.draft), [[100,2000],[3000,5000],[6000,8000]]);
});

test('long text is preserved and consecutive blank lines retain the existing safe SRT refusal', () => {
  const editor = createDraftEditor(fresh()), inserted = '长文中文 English🙂'.repeat(1200);
  change(editor, 'full', `第一句。\n第二句。${inserted}\n第三句。`, 9, 9, 'insertFromPaste');
  assert.ok(exportDraft(editor.draft).text.length > 10_000);
  assert.match(exportDraft(editor.draft).srt, /00:00:03,000 --> 00:00:05,000/);
  editor.reset(fresh());
  change(editor, 'full', '第一句。\n第二句。\n\n\n第三句。', 9, 9, 'insertLineBreak');
  assert.equal(exportDraft(editor.draft).text, '第一句。\n第二句。\n\n\n第三句。');
  assert.equal(exportDraft(editor.draft).srt, null); assert.match(exportDraft(editor.draft).srtError, /空白行/);
});

test('confirmation sync copies snapshots and reset drops composition and mapping history from the previous job', () => {
  const editor = createDraftEditor(fresh()), original = draftText(editor.draft);
  editor.draft.blocks[0].confirmed = true; editor.sync(editor.draft);
  change(editor, 'full', '第一句。第二句。\n第三句。', 4, 5, 'deleteContentBackward');
  editor.draft.blocks[0].confirmed = false;
  assert.equal(change(editor, 'full', original, 0, 0, 'historyUndo').draft.blocks[0].confirmed, true);
  editor.compositionStart('full', field(original, 0));
  const next = createDraft({...job,id:'b'.repeat(32)}, createReview(job));
  editor.reset(next);
  assert.equal(editor.composing, false);
  assert.equal(editor.compositionEnd('full', field('迟到的旧稿')).changed, false);
  assert.equal(editor.draft.jobId, next.jobId); assert.equal(draftText(editor.draft), job.text);
  assert.equal(change(editor, 'full', original + '旧稿', 0, 0, 'historyRedo').historyRestored, false);
});

test('adapter never writes textarea values or selection and reports an evicted history mapping honestly', () => {
  const editor = createDraftEditor(fresh(), {maxSnapshots:2, maxCharacters:1000});
  const original = draftText(editor.draft);
  for (let i = 1; i <= 3; i++) change(editor, 'full', original + String(i), original.length, draftText(editor.draft).length);
  const readonly = Object.freeze(field(original, 4));
  editor.beforeInput('full', readonly, {inputType:'historyUndo'});
  const result = editor.input('full', readonly, {inputType:'historyUndo'});
  assert.equal(result.changed, true); assert.equal(result.historyRestored, false); assert.match(result.warning, /字幕映射缓存/);
  assert.equal(exportDraft(result.draft).text, original);
  assert.equal(readonly.value, original); assert.equal(readonly.selectionStart, 4);
  assert.deepEqual(times(result.draft), [[100,2000],[3000,5000],[6000,8000]]);
});

test('a cross-segment IME replacement commits once and native undo restores original cue boundaries and confirmations', () => {
  const draft = fresh(); draft.blocks.forEach(block => { block.confirmed = true; });
  const editor = createDraftEditor(draft), original = draftText(draft);
  editor.compositionStart('full', field(original, 2, 11));
  assert.equal(editor.input('full', field('第一kua三句。'), {isComposing:true}).changed, false);
  const replacement = '第一跨段中文 English！三句。';
  const committed = editor.compositionEnd('full', field(replacement));
  assert.equal(committed.changed, true); assert.equal(editor.composing, false);
  assert.deepEqual(committed.draft.blocks.map(block => block.sourceIds), [[0,1,2]]);
  assert.deepEqual(times(committed.draft), [[100,8000]]);
  assert.match(exportDraft(committed.draft).srt, /00:00:00,100 --> 00:00:08,000\n第一跨段中文 English！三句。/);
  assert.equal(editor.input('full', field(replacement), {inputType:'insertFromComposition'}).changed, false);
  const undo = change(editor, 'full', original, 0, 0, 'historyUndo');
  assert.equal(undo.historyRestored, true);
  assert.deepEqual(undo.draft.blocks.map(block => block.sourceIds), [[0],[1],[2]]);
  assert.deepEqual(undo.draft.blocks.map(block => block.confirmed), [true,true,true]);
  assert.deepEqual(times(undo.draft), [[100,2000],[3000,5000],[6000,8000]]);
  const redo = change(editor, 'full', replacement, 0, 0, 'historyRedo');
  assert.equal(redo.historyRestored, true); assert.deepEqual(times(redo.draft), [[100,8000]]);
  assert.equal(redo.draft.blocks[0].confirmed, false);
  assert.deepEqual(job.reviewSegments.map(segment => [segment.startMs,segment.endMs]), [[100,2000],[3000,5000],[6000,8000]]);
});

test('forward delete handles a whole surrogate-pair emoji in the selected repeated cue and only merges on newline deletion', () => {
  const repeated = {...job,reviewSegments:job.reviewSegments.map(segment => ({...segment,text:'相同🙂'}))};
  const draft = createDraft(repeated,createReview(repeated)); draft.blocks.forEach(block => { block.confirmed = true; });
  const editor = createDraftEditor(draft), original = draftText(draft);
  const deleted = change(editor,'full','相同🙂\n相同\n相同🙂',7,7,'deleteContentForward');
  assert.deepEqual(deleted.draft.blocks.map(block => block.sourceIds), [[0],[1],[2]]);
  assert.deepEqual(deleted.draft.blocks.map(block => block.confirmed), [true,false,true]);
  assert.deepEqual(times(deleted.draft), [[100,2000],[3000,5000],[6000,8000]]);
  assert.equal(change(editor,'full',original,0,0,'historyUndo').historyRestored,true);
  const merged = change(editor,'full','相同🙂相同🙂\n相同🙂',4,4,'deleteContentForward');
  assert.deepEqual(merged.draft.blocks.map(block => block.sourceIds), [[0,1],[2]]);
  assert.deepEqual(times(merged.draft), [[100,5000],[6000,8000]]);
  assert.equal(merged.draft.blocks[1].confirmed,true);
});

test('the character budget evicts old mappings without imposing a document-length cap or exporting stale text', () => {
  const editor = createDraftEditor(fresh(),{maxSnapshots:120,maxCharacters:30}), original = draftText(editor.draft);
  change(editor,'full',original+'甲',original.length,original.length);
  change(editor,'full',original+'甲乙',original.length+1,original.length+1);
  const undo = change(editor,'full',original,0,0,'historyUndo');
  assert.equal(undo.historyRestored,false); assert.match(undo.warning,/缓存/);
  const long = '文'.repeat(100000);
  change(editor,'full',long,0,original.length,'insertFromPaste');
  const output = exportDraft(editor.draft);
  assert.equal(output.text.length,100000); assert.equal(output.text,long);
  assert.match(output.srt,/00:00:00,100 --> 00:00:08,000/);
  assert.deepEqual(times(editor.draft), [[100,8000]]);
});
