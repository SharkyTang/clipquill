import {draftText, editFullText, editBlock} from './draft.mjs';

// A UI adapter around the existing draft mapper. It never owns a textarea and
// never writes .value, selection, or the browser's native undo stack. Targets
// are 'full' or a current segment index. Call sync after non-text draft changes.
export function createDraftEditor(initialDraft = null, {maxSnapshots = 120, maxCharacters = 2_000_000} = {}) {
  maxSnapshots = Math.max(2, Number.isInteger(maxSnapshots) ? maxSnapshots : 120);
  maxCharacters = Math.max(1, Number.isFinite(maxCharacters) ? maxCharacters : 2_000_000);
  let draft = null, histories = new Map(), pending = null, composition = null;
  const copyBlocks = blocks => blocks.map(block => ({...block, sourceIds:[...block.sourceIds]}));
  const identity = value => value && `${value.jobId}:${value.sourceSignature}`;
  const fullTarget = target => target === 'full';
  const textFor = target => fullTarget(target) ? draftText(draft) : draft.blocks[target]?.text;
  const keyFor = target => fullTarget(target) ? 'full' : `segment:${draft.blocks[target]?.sourceIds.join(',')}:${target}`;
  const result = (changed = false, extra = {}) => ({draft, changed, pending:!!composition, historyRestored:false, warning:'', ...extra});
  function checkTarget(target) {
    if (!draft) throw new Error('没有可编辑的当前稿。');
    if (!fullTarget(target) && (!Number.isInteger(target) || target < 0 || target >= draft.blocks.length))
      throw new Error('当前字幕段已变化，请重新选择。');
  }
  function snapshot(target) {
    return {value:textFor(target), blocks:fullTarget(target) ? copyBlocks(draft.blocks) : [copyBlocks([draft.blocks[target]])[0]], edited:draft.edited};
  }
  function trim(history) {
    let characters = history.states.reduce((sum, state) => sum + state.value.length, 0);
    // The current document itself may exceed the budget; retain one mapping.
    while (history.states.length > 1 && (history.states.length > maxSnapshots || characters > maxCharacters)) {
      characters -= history.states.shift().value.length;
      history.index--;
    }
  }
  function historyFor(target) {
    checkTarget(target);
    const key = keyFor(target), value = textFor(target);
    // There is one segment textarea. Selecting another block sets its value
    // programmatically, so retaining every visited block's stack adds memory
    // without representing a browser undo history. Keep only the active one.
    if (!fullTarget(target)) for (const other of histories.keys())
      if (other !== 'full' && other !== key) histories.delete(other);
    let history = histories.get(key);
    if (!history || history.states[history.index]?.value !== value) {
      history = {states:[snapshot(target)], index:0}; histories.set(key, history);
    }
    return history;
  }
  function remember(target, history) {
    history.states.splice(history.index + 1);
    history.states.push(snapshot(target)); history.index = history.states.length - 1;
    trim(history);
    // Changes in one editor update the other textarea programmatically. Its
    // previous native stack no longer describes the displayed document.
    if (fullTarget(target)) {
      for (const key of histories.keys()) if (key !== 'full') histories.delete(key);
    } else histories.set('full', {states:[snapshot('full')], index:0});
  }
  function rangeFor(field, inputType) {
    const range = {start:field.selectionStart, end:field.selectionEnd};
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) return null;
    if (range.start === range.end && inputType === 'deleteContentBackward' && range.start > 0)
      range.start -= Array.from(field.value.slice(0, range.start)).at(-1)?.length || 0;
    else if (range.start === range.end && inputType === 'deleteContentForward')
      range.end += Array.from(field.value.slice(range.end))[0]?.length || 0;
    return range;
  }
  function apply(target, value, inputType, range) {
    const history = historyFor(target);
    if (value === textFor(target)) return result();
    const undo = inputType === 'historyUndo', redo = inputType === 'historyRedo';
    if (undo || redo) {
      const direction = undo ? -1 : 1;
      for (let index = history.index + direction; index >= 0 && index < history.states.length; index += direction) {
        const saved = history.states[index];
        if (saved.value !== value) continue;
        draft = {...draft, edited:saved.edited, blocks:fullTarget(target) ? copyBlocks(saved.blocks) :
          draft.blocks.map((block, i) => i === target ? copyBlocks(saved.blocks)[0] : block)};
        history.index = index;
        if (fullTarget(target)) {
          for (const key of histories.keys()) if (key !== 'full') histories.delete(key);
        } else histories.set('full', {states:[snapshot('full')], index:0});
        return result(true, {historyRestored:true});
      }
    }
    // A grouped native undo can skip many input events. If its older mapping
    // has left this bounded cache, use the original conservative mapper and
    // report the limitation; never pass a fabricated whole-document range.
    draft = fullTarget(target) ? editFullText(draft, value, undo || redo ? null : range) : editBlock(draft, target, value);
    remember(target, history);
    return result(true, {warning:undo || redo ? '这次撤销/重做已超出本页字幕映射缓存，当前文字已保留并按原编辑规则映射；请检查字幕时间后导出。' : ''});
  }
  function reset(nextDraft) {
    draft = nextDraft; histories = new Map(); pending = null; composition = null;
    if (draft) histories.set('full', {states:[snapshot('full')], index:0});
    return result();
  }
  function sync(nextDraft) {
    if (identity(nextDraft) !== identity(draft) || !nextDraft || draftText(nextDraft) !== draftText(draft)) return reset(nextDraft);
    draft = nextDraft;
    for (const [key, history] of histories) {
      const target = key === 'full' ? 'full' : Number(key.slice(key.lastIndexOf(':') + 1));
      if (fullTarget(target) || key === keyFor(target)) history.states[history.index] = snapshot(target);
      else histories.delete(key);
    }
    return result();
  }
  const api = {
    get draft() { return draft; },
    get composing() { return !!composition; },
    reset, sync,
    beforeInput(target, field, event = {}) {
      historyFor(target);
      if (composition) return result();
      pending = {target, inputType:event.inputType || '', range:rangeFor(field, event.inputType)};
      return result();
    },
    compositionStart(target, field) {
      historyFor(target);
      composition = {target, range:rangeFor(field, '')};
      pending = null;
      return result();
    },
    input(target, field, event = {}) {
      checkTarget(target);
      if (!composition && field.value === textFor(target)) { pending = null; return result(); }
      if (composition || event.isComposing) {
        if (!composition) composition = {target, range:pending?.target === target ? pending.range : null};
        return result(false, {pending:true});
      }
      const before = pending?.target === target ? pending : null; pending = null;
      return apply(target, field.value, event.inputType || before?.inputType || '', before?.range || null);
    },
    compositionEnd(target, field) {
      const active = composition; composition = null; pending = null;
      if (!active || active.target !== target) return result();
      return apply(target, field.value, 'insertFromComposition', active.range);
    }
  };
  reset(initialDraft);
  return api;
}
