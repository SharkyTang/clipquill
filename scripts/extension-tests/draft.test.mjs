import test from 'node:test';
import assert from 'node:assert/strict';
import {createReview} from '../../outputs/douyin-independent-extension/review.mjs';
import {createDraft, draftText, editFullText, editBlock, exportDraft, saveableDraft, draftSegments} from '../../outputs/douyin-independent-extension/draft.mjs';
import {migrateTerms, activeTerms} from '../../outputs/douyin-independent-extension/settings.mjs';

const job={id:'a'.repeat(32),text:'第一句。\n第二句。\n第三句。',durationSeconds:10,
  reviewSegments:[{id:0,startMs:100,endMs:2000,text:'第一句。'},
    {id:1,startMs:3000,endMs:5000,text:'第二句。'}, {id:2,startMs:6000,endMs:8000,text:'第三句。'}]};
const fresh=()=>createDraft(job,createReview(job));
test('simple full edit is the only current text, invalidates confirmation and preserves source',()=>{
  const draft=fresh(); draft.blocks[1].confirmed=true;
  const changed=editFullText(draft,'第一句。\n改字🙂。\n第三句。');
  const out=exportDraft(changed);
  assert.equal(draftText(changed),out.text);
  assert.equal(out.text,'第一句。\n改字🙂。\n第三句。');
  assert.match(out.srt,/00:00:03,000 --> 00:00:05,000\n改字🙂。/);
  assert.equal(out.confirmed,0);assert.equal(job.reviewSegments[1].text,'第二句。');
});
test('merging subtitles uses original outer endpoints and exports current merged text',()=>{
  const changed=editFullText(fresh(),'第一句。第二句。\n第三句。',{start:4,end:5});
  assert.deepEqual(changed.blocks[0].sourceIds,[0,1]);
  assert.match(exportDraft(changed).srt,/00:00:00,100 --> 00:00:05,000\n第一句。第二句。/);
  assert.equal(draftSegments(changed)[1].startMs,6000);
});
test('inserting a new line keeps its containing interval, never synthesizes a timestamp',()=>{
  const changed=editFullText(fresh(),'第一句。\n第二句。新增\n补充。\n第三句。',{start:9,end:9});
  assert.equal(changed.blocks.length,3);
  assert.match(exportDraft(changed).srt,/00:00:03,000 --> 00:00:05,000\n第二句。新增\n补充。/);
});
test('deleting complete first, middle and last lines keeps remaining original times',()=>{
  for (const [text,range,ids] of [
    ['第二句。\n第三句。',{start:0,end:5},[1,2]],
    ['第一句。\n第三句。',{start:5,end:10},[0,2]],
    ['第一句。\n第二句。',{start:9,end:14},[0,1]]]) {
    const changed=editFullText(fresh(),text,range);
    assert.deepEqual(changed.blocks.flatMap(b=>b.sourceIds),ids);
    assert.equal(draftText(changed),text);
    const restored=createDraft(job,createReview(job),JSON.parse(JSON.stringify(saveableDraft(changed))));
    assert.equal(exportDraft(restored).srt,exportDraft(changed).srt);
  }
});
test('exact input selection disambiguates repeated sentences and preserves unaffected confirmation',()=>{
  const repeated={...job,reviewSegments:job.reviewSegments.map(s=>({...s,text:'相同'}))};
  const draft=createDraft(repeated,createReview(repeated));draft.blocks[0].confirmed=true;
  const changed=editFullText(draft,'相同\n相同字\n相同',{start:5,end:5});
  assert.deepEqual(changed.blocks.map(b=>b.sourceIds),[[0],[1],[2]]);
  assert.equal(changed.blocks[0].confirmed,true);assert.match(exportDraft(changed).srt,/00:00:03,000 --> 00:00:05,000\n相同字/);
});
test('draft restores only for the exact original and timing; old review is migrated without mutation',()=>{
  const review=createReview(job);review[0].text='旧校对。';review[0].confirmed=true;
  const savedReview=JSON.stringify(review);
  const draft=createDraft(job,review);assert.equal(draftText(draft).startsWith('旧校对。'),true);
  const changed=editFullText(draft,'新稿。\n第二句。\n第三句。');const saved=JSON.parse(JSON.stringify(saveableDraft(changed)));
  assert.equal(draftText(createDraft(job,review,saved)),draftText(changed));
  assert.equal(JSON.stringify(review),savedReview);
  assert.equal(draftText(createDraft({...job,id:'b'.repeat(32)},review,saved)),draftText(draft));
  const altered=review.map((s,i)=>i? s : {...s,endMs:2001});
  assert.equal(draftText(createDraft(job,altered,saved)),draftText(draft));
  assert.equal(draftText(createDraft(job,review,{...saved,blocks:[{text:'bad',sourceIds:[2,1]}]})),draftText(draft));
});
test('fine edit after full merge edits the same current draft and exports no stale segments',()=>{
  const merged=editFullText(fresh(),'第一句。第二句。\n第三句。');
  const changed=editBlock(merged,0,'合并后精校。');
  assert.equal(exportDraft(changed).text,'合并后精校。\n第三句。');
  assert.doesNotMatch(exportDraft(changed).srt,/第一句|第二句/);
});
test('empty drafts, absent/overlapping/out-of-range times and unsafe SRT text never export old SRT',()=>{
  for (const draft of [
    editFullText(fresh(),''),createDraft(job,null),
    createDraft(job,createReview({...job,reviewSegments:job.reviewSegments.map((s,i)=>i===1? {...s,startMs:1000}:s)})),
    createDraft({...job,durationSeconds:7},createReview(job)),
    editBlock(fresh(),0,'段落\n\n空行'), editBlock(fresh(),0,'\n前导空行'),
    editBlock(fresh(),0,'尾随空行\n'), editBlock(fresh(),0,'伪造 --> 时间')]) {
    const out=exportDraft(draft);assert.equal(out.srt,null);assert.ok(out.srtError);assert.equal(typeof out.text,'string');
  }
});
test('legacy terms survive migration but are disabled unless explicitly chosen for this task',()=>{
  const map=new Map([['terms','Claude, Opus']]);const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  assert.equal(migrateTerms(storage),'Claude, Opus');assert.equal(map.get('terms'),'Claude, Opus');
  assert.equal(activeTerms(false,'Claude, Opus'),'');assert.equal(activeTerms(true,' 本条术语 '),'本条术语');
  assert.equal(migrateTerms(storage),'Claude, Opus');assert.equal(map.get('terms-policy-v1'),'explicit-per-task');
});
test('a zero-duration source is refused, but explicit deletion or merging can use existing endpoints',()=>{
  const source={...job,reviewSegments:job.reviewSegments.map((s,i)=>i===1? {...s,endMs:s.startMs}:s)};
  const draft=createDraft(source,createReview(source));
  assert.equal(exportDraft(draft).srt,null);
  const merged=editFullText(draft,'第一句。第二句。\n第三句。',{start:4,end:5});
  assert.equal(exportDraft(merged).srtError,'');
  assert.match(exportDraft(merged).srt,/00:00:00,100 --> 00:00:03,000\n第一句。第二句。/);
  const cleared=editBlock(draft,1,'');assert.equal(exportDraft(cleared).srt,null);
  const removed=editFullText(cleared,'第一句。\n第三句。',{start:5,end:6});
  assert.equal(exportDraft(removed).srtError,'');
  assert.equal(source.reviewSegments[1].startMs,source.reviewSegments[1].endMs);
});
test('clearing a whole row preserves TXT and refuses SRT until that blank row is explicitly removed',()=>{
  const cleared=editFullText(fresh(),'第一句。\n\n第三句。',{start:5,end:9});
  const out=exportDraft(cleared);
  assert.equal(out.text,'第一句。\n\n第三句。');
  assert.equal(out.srt,null);assert.match(out.srtError,/空白行/);
  const restored=createDraft(job,createReview(job),JSON.parse(JSON.stringify(saveableDraft(cleared))));
  assert.deepEqual(exportDraft(restored),out);
  const removed=editFullText(restored,'第一句。\n第三句。',{start:5,end:6});
  assert.equal(exportDraft(removed).srtError,'');
  assert.deepEqual(draftSegments(removed).map(s=>[s.startMs,s.endMs]),[[100,2000],[6000,8000]]);
});
test('SRT uses the rounded millisecond media bound without accepting an endpoint beyond it',()=>{
  const source={id:'b'.repeat(32),text:'嗯。',durationSeconds:174.241995,
    reviewSegments:[{id:0,startMs:174192,endMs:174242,text:'嗯。'}]};
  const draft=createDraft(source,createReview(source));
  assert.equal(exportDraft(draft).srtError,'');
  assert.match(exportDraft(draft).srt,/00:02:54,192 --> 00:02:54,242/);
  assert.equal(draft.durationMs,174241.995);assert.equal(source.reviewSegments[0].endMs,174242);
  const beyond={...source,reviewSegments:[{...source.reviewSegments[0],endMs:174243}]};
  assert.equal(exportDraft(createDraft(beyond,createReview(beyond))).srt,null);
});
