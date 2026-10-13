"""Preserve recognized characters while assigning model-estimated word times."""
import re
import unicodedata
from difflib import SequenceMatcher


def canonical(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text).casefold() if c.isalnum())


def timed_segments(text, words, offset, end):
    # Never replace speech with the aligner's normalized words or lose punctuation.
    positions = []
    normalized = ''
    for i, char in enumerate(text):
        part = canonical(char)
        normalized += part
        positions.extend([i] * len(part))
    if not words or ''.join(canonical(w['text']) for w in words) != normalized:
        return [dict(startMs=round(offset*1000), endMs=round(end*1000), text=text.strip(), needsAttention=True)]
    result, cursor, text_start, time_start, previous_end = [], 0, 0, None, offset
    for index, word in enumerate(words):
        size = len(canonical(word['text']))
        if not size:
            continue
        cursor += size
        text_end = positions[cursor] if cursor < len(positions) else len(text)
        start = max(previous_end, min(end, offset + max(0, word['start'])))
        finish = max(start, min(end, offset + max(0, word['end'])))
        if time_start is None:
            time_start = start
        fragment = text[text_start:text_end]
        next_start = offset + words[index+1]['start'] if index+1 < len(words) else end
        boundary = bool(re.search(r'[。！？!?；;，,]\s*$', fragment)) or len(fragment) >= 42 or (len(fragment) >= 6 and next_start - finish > 0.7)
        if boundary or index == len(words)-1:
            result.append(dict(startMs=round(time_start*1000), endMs=round(finish*1000), text=fragment.strip(), needsAttention=finish <= time_start or finish-time_start > 12))
            text_start, time_start = text_end, None
        previous_end = finish
    if ''.join(canonical(s['text']) for s in result) != normalized:
        return [dict(startMs=round(offset*1000), endMs=round(end*1000), text=text.strip(), needsAttention=True)]
    return result


def flag_disagreements(segments, reference):
    pieces = [canonical(s['text']) for s in segments]
    primary, reference = ''.join(pieces), canonical(reference)
    differences = [op for op in SequenceMatcher(None, primary, reference, autojunk=False).get_opcodes() if op[0] != 'equal']
    offset = 0
    for segment, piece in zip(segments, pieces):
        end = offset + len(piece)
        matches = [op for op in differences if (op[1] < end and op[2] > offset) or (op[1] == op[2] and offset <= op[1] < end)]
        if matches:
            segment['needsAttention'] = True
            # Reference is evidence to review, never an automatic replacement.
            segment['referenceText'] = ' / '.join(reference[max(0,op[3]-5):min(len(reference),op[4]+5)] for op in matches)[:240]
        offset = end
    return segments


def srt_timestamp(ms):
    ms = max(0, round(ms))
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'


def to_srt(segments):
    return '\n'.join(f'{i+1}\n{srt_timestamp(s["startMs"])} --> {srt_timestamp(s["endMs"])}\n{s["text"]}\n' for i,s in enumerate(segments))
