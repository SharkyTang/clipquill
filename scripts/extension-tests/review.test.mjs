import test from 'node:test';
import assert from 'node:assert/strict';
import {createReview, changeText, exportReview} from '../../outputs/douyin-independent-extension/review.mjs';
const job={id:'a'.repeat(32), reviewSegments:[{id:0,startMs:1234,endMs:3000,text:'抽针。'}, {id:1,startMs:4000,endMs:5900,text:'原音。'}]};
test('review remains separate, edits invalidate confirmation, TXT and SRT use the same text',()=>{
  const review=createReview(job); assert.ok(review.every(s=>!s.confirmed));
  review[0].confirmed=true; review[0]=changeText(review[0],'抽帧。');
  assert.equal(review[0].confirmed,false); assert.equal(job.reviewSegments[0].text,'抽针。');
  const out=exportReview(review); assert.equal(out.confirmed,0);
  assert.equal(out.text,'抽帧。\n原音。'); assert.match(out.srt,/00:00:01,234 --> 00:00:03,000\n抽帧。/);
  assert.doesNotMatch(out.srt,/抽针/);
});
test('review draft restores only for its exact job, original and timing',()=>{
  const review=createReview(job); review[0].text='抽帧。';review[0].confirmed=true;
  const saved={jobId:job.id,segments:review};
  assert.equal(createReview(job,saved)[0].confirmed,true);
  assert.equal(createReview(job,{...saved,jobId:'other'})[0].text,'抽针。');
  assert.equal(createReview({...job,reviewSegments:[{...job.reviewSegments[0],endMs:3001}]},saved)[0].confirmed,false);
});
test('deleted text is absent from both exports without renumbering source segments',()=>{
  const review=createReview(job);review[0]=changeText(review[0],'');
  const out=exportReview(review);assert.equal(out.text,'原音。');assert.match(out.srt,/^1\n00:00:04,000/);assert.equal(out.total,2);
});
