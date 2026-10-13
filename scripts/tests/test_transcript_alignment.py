import unittest
from transcript_alignment import timed_segments, canonical, to_srt, flag_disagreements


class AlignmentTests(unittest.TestCase):
    def test_retains_english_spaces_numbers_and_punctuation(self):
        text='用 GPT-6 Astra，抽帧。'
        units=['用','GPT','6','Astra','抽','帧']
        words=[dict(text=w,start=i*.3,end=i*.3+.2) for i,w in enumerate(units)]
        segments=timed_segments(text,words,10,15)
        self.assertEqual(''.join(s['text'] for s in segments),text)
        self.assertEqual(segments[0]['startMs'],10000)
        self.assertIn('GPT-6 Astra，',to_srt(segments))

    def test_mismatch_preserves_full_text_and_marks_review(self):
        text='没有遗漏的原稿。'
        out=timed_segments(text,[dict(text='原稿',start=0,end=1)],0,3)
        self.assertEqual(out[0]['text'],text)
        self.assertTrue(out[0]['needsAttention'])
        self.assertEqual(out[0]['endMs'],3000)

    def test_times_are_monotonic_and_bounded(self):
        words=[dict(text='一',start=1,end=2),dict(text='二',start=.5,end=9)]
        out=timed_segments('一，二。',words,10,13)
        self.assertGreaterEqual(out[1]['startMs'],out[0]['endMs'])
        self.assertEqual(out[1]['endMs'],13000)

    def test_disagreement_flags_misrecognition_without_rewriting(self):
        segments=[dict(text='抽帧。',needsAttention=False),dict(text='复刻的成天。',needsAttention=False)]
        flag_disagreements(segments,'抽帧，复刻的成片。')
        self.assertFalse(segments[0]['needsAttention'])
        self.assertTrue(segments[1]['needsAttention'])
        self.assertEqual(segments[1]['text'],'复刻的成天。')
        self.assertIn('成片',segments[1]['referenceText'])


if __name__ == '__main__': unittest.main()
