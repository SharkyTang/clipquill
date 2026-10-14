import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from install_helper import safe_path, extension_id, checked_copy, download_model, register_host


class Reply(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = headers or {}


class InstallHelperTests(unittest.TestCase):
    def entry(self, body=b'model'):
        return {'path': 'work/independent-asr/model.bin', 'bytes': len(body),
                'sha256': hashlib.sha256(body).hexdigest(),
                'url': 'https://huggingface.co/vendor/model/resolve/' + 'a' * 40 + '/model.bin'}

    def test_paths_cannot_escape_installation_or_follow_an_external_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for value in ['/etc/passwd', '../outside', 'a/../../outside']:
                with self.assertRaises(ValueError):
                    safe_path(root, value)
            (root / 'link').symlink_to('/tmp')
            with self.assertRaises(ValueError):
                safe_path(root, 'link/file')
            self.assertEqual(safe_path(root, 'scripts/native_host.py'), root / 'scripts/native_host.py')

    def test_extension_identity_is_automatic_and_public_key_is_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / 'manifest.json'
            manifest.write_text('{}')
            value = extension_id(root)
            self.assertRegex(value, r'^[a-p]{32}$')
            self.assertEqual(value, extension_id(root))
            manifest.write_text('{"key":"dGVzdA=="}')
            expected = ''.join(chr(97 + int(value, 16)) for value in hashlib.sha256(b'test').hexdigest()[:32])
            self.assertEqual(extension_id(root), expected)

    def test_bundle_copy_rejects_corruption_and_preserves_executable_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, destination = root / 'source', root / 'installed/tool'
            source.write_bytes(b'model')
            entry = {**self.entry(), 'mode': 0o755}
            checked_copy(source, destination, entry)
            self.assertEqual(destination.read_bytes(), b'model')
            self.assertEqual(destination.stat().st_mode & 0o777, 0o755)
            source.write_bytes(b'wrong')
            with self.assertRaises(ValueError):
                checked_copy(source, destination, entry)
            self.assertEqual(destination.read_bytes(), b'model')

    def test_model_download_resumes_and_verifies_before_installing(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'model.bin'
            destination.with_suffix('.bin.part').write_bytes(b'mo')
            def open_reply(request, timeout):
                self.assertEqual(request.get_header('Range'), 'bytes=2-')
                return Reply(b'del', 206, {'Content-Range': 'bytes 2-4/5'})
            download_model(self.entry(), destination, opener=open_reply)
            self.assertEqual(destination.read_bytes(), b'model')
            self.assertFalse(destination.with_suffix('.bin.part').exists())

    def test_servers_that_ignore_range_restart_the_file_without_duplicate_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'model.bin'
            destination.with_suffix('.bin.part').write_bytes(b'mo')
            download_model(self.entry(), destination, opener=lambda *_args, **_kwargs: Reply(b'model'))
            self.assertEqual(destination.read_bytes(), b'model')

    def test_bad_download_never_replaces_an_existing_model(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'model.bin'
            destination.write_bytes(b'existing')
            with self.assertRaises(RuntimeError):
                download_model(self.entry(), destination, opener=lambda *_args, **_kwargs: Reply(b'wrong'), sleep=lambda _: None)
            self.assertEqual(destination.read_bytes(), b'existing')

    def test_unpinned_or_non_official_model_addresses_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            for url in ['http://huggingface.co/vendor/model/resolve/' + 'a' * 40 + '/file',
                        'https://huggingface.co/vendor/model/resolve/main/file', 'https://example.com/file']:
                with self.assertRaises(ValueError):
                    download_model({**self.entry(), 'url': url}, Path(directory) / 'model.bin')

    def test_registered_host_allows_only_the_paired_extension_and_quotes_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "helper with ' quote"
            (root / 'scripts').mkdir(parents=True)
            host = Path(directory) / 'chrome-hosts'
            register_host(root, ['a' * 32], host)
            manifest = json.loads((host / 'com.clipquill.local_helper.json').read_text())
            self.assertEqual(manifest['allowed_origins'], ['chrome-extension://' + 'a' * 32 + '/'])
            launcher = Path(manifest['path'])
            self.assertEqual(launcher.stat().st_mode & 0o777, 0o755)
            self.assertIn(' -u -B ', launcher.read_text())
            self.assertNotIn('*', manifest['allowed_origins'])
