import base64
import copy
import json
import unittest
from urllib.parse import quote
from inspect_douyin_response import inspect

TARGET = '7689864994510343451'


def fixture():
    return {'aweme_id': TARGET, 'desc': 'Synthetic test work',
            'video_control': {'allow_download': True, 'download_info': {'level': 0}},
            'video': {'duration': 300000, 'play_addr': {'url_list': ['https://media.example/video?token=private-query'], 'width': 1920, 'height': 1080}}}


def page_fixture():
    return {'app': {'videoDetail': {'awemeId': TARGET, 'desc': 'Synthetic page work',
            'download': {'allowDownload': False, 'urlList': ['https://media.example/download?secret=hidden']},
            'video': {'duration': 300000, 'bitRateList': [
                {'playAddr': [{'src': 'https://media.example/play?secret=hidden'}],
                 'format': 'mp4', 'gearName': 'normal_720_0', 'width': 1280, 'height': 720, 'dataSize': 123}],
                'bitRateAudioList': [{'urlList': [{'src': 'https://media.example/audio'}], 'mediaType': 'audio'}]}}}}


def page_html(data):
    return '<html><script id="RENDER_DATA" type="application/json">' + quote(json.dumps(data)) + '</script></html>'


class InspectorTest(unittest.TestCase):
    def test_does_not_select_recommendation(self):
        other = fixture(); other['aweme_id'] = '1111111111111111111'
        report = inspect({'aweme_list': [other, fixture()]}, TARGET)
        self.assertEqual(len(report['results']), 1)
        self.assertEqual(report['results'][0]['work_id'], TARGET)
        self.assertEqual(inspect(other, TARGET)['status'], 'target_not_found')

    def test_numeric_id_keeps_precision(self):
        work = fixture(); work['aweme_id'] = int(TARGET)
        self.assertEqual(inspect(json.loads(json.dumps(work)), TARGET)['status'], 'target_found')

    def test_restricted_is_not_overridden_by_playable_url(self):
        work = fixture(); work['video_control']['allow_download'] = False
        result = inspect(work, TARGET)['results'][0]
        self.assertEqual(result['download_permission']['state'], 'restricted')
        self.assertEqual(result['candidate_count'], 1)
        self.assertFalse(result['download_performed'])

    def test_missing_and_string_permission_are_unknown(self):
        work = fixture(); work.pop('video_control')
        self.assertEqual(inspect(work, TARGET)['results'][0]['download_permission']['state'], 'unknown')
        work['video_control'] = {'allow_download': 'true', 'download_info': {'level': 0}}
        self.assertEqual(inspect(work, TARGET)['results'][0]['download_permission']['state'], 'unknown')

    def test_urls_and_cookies_are_not_disclosed(self):
        work = fixture(); work['unrelated_secret'] = 'not-for-output'
        text = json.dumps(inspect(work, TARGET))
        self.assertNotIn('private-query', text)
        self.assertNotIn('not-for-output', text)
        self.assertIn('media.example', text)
        self.assertIn('unverified', text)

    def test_har_ignores_failed_and_unrelated_requests(self):
        def entry(host, status=200):
            return {'request': {'url': 'https://' + host + '/aweme/v1/web/aweme/detail/', 'cookies': ['secret']},
                    'response': {'status': status, 'content': {'encoding': 'base64', 'text': base64.b64encode(json.dumps(fixture()).encode()).decode()}}}
        report = inspect({'log': {'entries': [entry('unrelated.example'), entry('www.douyin.com', 403), entry('www.douyin.com')]}}, TARGET)
        self.assertEqual(len(report['results']), 1)
        self.assertEqual(report['results'][0]['source'], 'har_response_2')
        self.assertNotIn('secret', json.dumps(report))

    def test_separate_audio_and_encoded_dynamic_urls(self):
        work = fixture()
        work['video']['bit_rate_audio'] = [{'audio_meta': {'url_list': {'main_url': 'https://media.example/audio'}}}]
        work['video']['video_model'] = json.dumps({'dynamic_video': {'dynamic_video_list': [{'main_url': 'aHR0cHM6Ly9leGFtcGxlLmNvbQ=='}]}})
        result = inspect(work, TARGET)['results'][0]
        self.assertEqual([c['kind'] for c in result['media_candidates']], ['playback', 'audio', 'video'])
        self.assertEqual(result['media_candidates'][-1]['url_state'], 'not_plain_http_url')

    def test_conflicting_versions_are_preserved_for_review(self):
        one = fixture(); two = copy.deepcopy(one); two['video_control']['allow_download'] = False
        report = inspect([one, one, two], TARGET)
        self.assertEqual(report['status'], 'multiple_versions_review_required')
        self.assertEqual(len(report['results']), 2)

    def test_actual_page_shape_html_preserves_restriction(self):
        result = inspect(page_html(page_fixture()), TARGET)['results'][0]
        self.assertEqual(result['schema'], 'normalized_page_data')
        self.assertEqual(result['download_permission']['state'], 'restricted')
        self.assertEqual([c['kind'] for c in result['media_candidates']], ['playback', 'audio', 'download'])
        candidate = result['media_candidates'][0]
        self.assertEqual((candidate['format'], candidate['width'], candidate['size']), ('mp4', 1280, 123))
        self.assertNotIn('secret=hidden', json.dumps(result))
        self.assertFalse(result['download_performed'])

    def test_page_har_with_base64_and_observed_alternate_host(self):
        report = inspect({'log': {'entries': [{'request': {'url': 'https://www-hj.douyin.com/user/self?modal_id=' + TARGET},
            'response': {'status': 200, 'content': {'encoding': 'base64', 'text': base64.b64encode(page_html(page_fixture()).encode()).decode()}}}]}}, TARGET)
        self.assertEqual(report['status'], 'target_found')

    def test_rejects_spoofed_host_even_when_body_matches(self):
        entry = {'request': {'url': 'https://www.douyin.com.attacker.example/user/self'},
                 'response': {'status': 200, 'content': {'text': page_html(page_fixture())}}}
        self.assertEqual(inspect({'log': {'entries': [entry]}}, TARGET)['status'], 'target_not_found')

    def test_normalized_permission_missing_or_mistyped_is_unknown(self):
        work = page_fixture()['app']['videoDetail']
        for allow in (None, 'true', 1):
            work['download']['allowDownload'] = allow
            self.assertEqual(inspect(work, TARGET)['results'][0]['download_permission']['state'], 'unknown')

    def test_restriction_wins_over_conflicting_normalized_allow(self):
        work = fixture(); work['video_control']['allow_download'] = False
        work['download'] = {'allowDownload': True}
        self.assertEqual(inspect(work, TARGET)['results'][0]['download_permission']['state'], 'restricted')

    def test_mismatched_alias_id_never_selects_work(self):
        work = fixture(); work['awemeId'] = '1111111111111111111'
        self.assertEqual(inspect(work, TARGET)['status'], 'target_not_found')

    def test_arbitrary_script_is_not_executed_or_parsed(self):
        with self.assertRaises(ValueError):
            inspect('<script>window.RENDER_DATA=' + json.dumps(page_fixture()) + '</script>', TARGET)
        with self.assertRaises(ValueError):
            inspect(page_html(page_fixture()) * 2, TARGET)


if __name__ == '__main__':
    unittest.main()
