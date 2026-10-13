import io
import json
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import transcription_bridge as bridge

ID = '7689864994510343451'
ORIGIN = 'chrome-extension://' + bridge.DEFAULT_EXTENSION


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / (ID + '_720p_测试 (1).mp4')
        self.source.write_bytes(b'test')
        self.payload = dict(workId=ID, path=str(self.source), expectedBytes=4, durationMs=300000)

    def test_valid_complete_download_including_chrome_duplicate_suffix(self):
        self.assertEqual(bridge.validate_source(self.payload, self.root)[0], self.source)

    def test_rejects_arbitrary_paths_symlinks_incomplete_files_and_wrong_work(self):
        for change in [dict(path='/etc/passwd'), dict(path='../sample.mp4'), dict(path='https://example.com/a'),
                       dict(path=str(self.source)+'\x00'), dict(expectedBytes=5), dict(expectedBytes=True),
                       dict(workId='1111111111111111111'), dict(durationMs=3600001)]:
            with self.subTest(change=change), self.assertRaises(bridge.RequestError):
                bridge.validate_source({**self.payload, **change}, self.root)
        link = self.root / (ID + '_720p_link.mp4')
        link.symlink_to(self.source)
        with self.assertRaises(bridge.RequestError):
            bridge.validate_source({**self.payload, 'path': str(link)}, self.root)

    def request(self, method, path, headers=None, body=b''):
        jobs = Mock()
        jobs.start.return_value = {'id': 'a'*32, 'workId': ID, 'status': 'running'}
        cls = bridge.make_handler(jobs, ORIGIN)
        handler = object.__new__(cls)
        handler.server = SimpleNamespace(server_port=8766)
        handler.headers = Message()
        for key, value in (headers or {}).items(): handler.headers[key] = value
        handler.path, handler.rfile, handler.wfile = path, io.BytesIO(body), io.BytesIO()
        handler.connection = Mock()
        response = {'headers': {}}
        handler.send_response = lambda code: response.update(status=code)
        handler.send_header = lambda key, value: response['headers'].update({key: value})
        handler.end_headers = lambda: None
        getattr(handler, 'do_' + method)()
        response['body'] = handler.wfile.getvalue()
        return response, jobs

    def test_cors_rejects_other_websites_missing_origin_and_dns_rebinding(self):
        for headers in [{}, {'Host':'127.0.0.1:8766','Origin':'https://evil.test'},
                        {'Host':'evil.test:8766','Origin':ORIGIN}]:
            response, jobs = self.request('GET','/health',headers)
            self.assertEqual(response['status'],403)
            jobs.start.assert_not_called()

    def test_json_preflight_and_plain_form_rejection(self):
        headers={'Host':'127.0.0.1:8766','Origin':ORIGIN}
        result,_=self.request('OPTIONS','/jobs',headers)
        self.assertEqual(result['status'],204)
        self.assertEqual(result['headers']['Access-Control-Allow-Origin'],ORIGIN)
        result,jobs=self.request('POST','/jobs',{**headers,'Content-Type':'text/plain','Content-Length':'2'},b'{}')
        self.assertEqual(result['status'],415)
        jobs.start.assert_not_called()
        data=json.dumps(self.payload).encode()
        result,jobs=self.request('POST','/jobs',{**headers,'Content-Type':'application/json','Content-Length':str(len(data))},data)
        self.assertEqual(result['status'],202)
        jobs.start.assert_called_once_with(self.payload)

    def test_saved_results_survive_restart_but_interrupted_job_is_not_success(self):
        jobs=bridge.Jobs(self.root,self.root/'work',self.root/'out')
        jobs.save({'id':'a'*32,'status':'running'})
        restored=bridge.Jobs(self.root,self.root/'work',self.root/'out')
        self.assertEqual(restored.get('a'*32)['status'],'failed')
        for value in ['../secret','a'*31,'a'*33]:
            with self.assertRaises(bridge.RequestError):restored.get(value)

    def test_only_one_inference_can_start(self):
        jobs=bridge.Jobs(self.root,self.root/'work',self.root/'out')
        jobs.active='already-running'
        with patch.object(bridge,'runtime_ready',return_value=True),self.assertRaises(bridge.RequestError) as error:
            jobs.start(self.payload)
        self.assertEqual(error.exception.status,409)

    def test_terms_rejects_non_text_or_oversized_before_starting_worker(self):
        jobs=bridge.Jobs(self.root,self.root/'work',self.root/'out')
        for terms in [False, [], 'x'*401, 'a\x00b']:
            with self.assertRaises(bridge.RequestError): jobs.start({**self.payload,'terms':terms})
        self.assertIsNone(jobs.active)

    def test_audio_is_only_from_completed_job_and_rejects_symlink(self):
        jobs=bridge.Jobs(self.root,self.root/'work',self.root/'out')
        job={'id':'a'*32,'workId':ID,'status':'complete','hasAudio':True}
        jobs.save(job)
        folder=jobs.output_root/(ID+'-'+job['id']);folder.mkdir()
        audio=folder/'review.m4a';audio.write_bytes(b'audio')
        self.assertEqual(jobs.audio(job['id']),b'audio')
        audio.unlink();audio.symlink_to(self.source)
        with self.assertRaises(bridge.RequestError): jobs.audio(job['id'])
        jobs.save({**job,'status':'running'})
        with self.assertRaises(bridge.RequestError): jobs.audio(job['id'])

    def test_audio_endpoint_requires_extension_origin(self):
        response,jobs=self.request('GET','/jobs/'+'a'*32+'/audio',{'Host':'127.0.0.1:8766','Origin':'https://evil.test'})
        self.assertEqual(response['status'],403)
        jobs.audio.assert_not_called()


if __name__ == '__main__':unittest.main()
