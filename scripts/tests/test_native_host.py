import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from native_host import (StartupError, read_message, write_message, authorized_origin,
                         paired_extensions, ensure_service, service_environment)

ID = 'a' * 32


class NativeHostTests(unittest.TestCase):
    def packet(self, value):
        body = json.dumps(value).encode()
        return io.BytesIO(struct.pack('=I', len(body)) + body)

    def test_fixed_command_and_protocol_framing(self):
        command = {'action': 'ensureService', 'protocol': 1}
        self.assertEqual(read_message(self.packet(command)), command)
        for value in [[], {'action': 'run', 'protocol': 1}, {**command, 'path': '/etc/passwd'},
                      {**command, 'protocol': True}]:
            with self.assertRaises(StartupError):
                read_message(self.packet(value))
        for packet in [b'', b'\0', struct.pack('=I', 5000), struct.pack('=I', 10) + b'{}']:
            with self.assertRaises(StartupError):
                read_message(io.BytesIO(packet))
        output = io.BytesIO()
        write_message(output, {'ok': True, 'message': '文案'})
        packet = output.getvalue()
        self.assertEqual(struct.unpack('=I', packet[:4])[0], len(packet[4:]))
        self.assertEqual(json.loads(packet[4:])['message'], '文案')

    def test_only_paired_origins_are_accepted(self):
        self.assertEqual(authorized_origin('chrome-extension://' + ID + '/', [ID]), 'chrome-extension://' + ID)
        for value in ['https://example.com', 'chrome-extension://' + 'b' * 32,
                      'chrome-extension://' + ID + '/tool.html']:
            with self.assertRaises(StartupError):
                authorized_origin(value, [ID])

    def test_installation_configuration_is_validated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(StartupError):
                paired_extensions(root)
            (root / 'work').mkdir()
            config = root / 'work/native-host.json'
            config.write_text(json.dumps({'protocol': 1, 'extensions': [ID, ID]}))
            self.assertEqual(paired_extensions(root), [ID])
            config.write_text(json.dumps({'protocol': 1, 'extensions': ['*']}))
            with self.assertRaises(StartupError):
                paired_extensions(root)

    def test_a_running_service_is_reused_without_a_process(self):
        with tempfile.TemporaryDirectory() as directory, patch('native_host.health', return_value={'ready': True}), patch('native_host.subprocess.Popen') as spawn:
            self.assertTrue(ensure_service(Path(directory), 'chrome-extension://' + ID, [ID])['reused'])
            spawn.assert_not_called()

    def test_cold_start_uses_configured_runtime_and_redirects_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'work/asr-venv/bin').mkdir(parents=True)
            (root / 'work/asr-venv/bin/python').touch()
            (root / 'scripts').mkdir()
            (root / 'scripts/transcription_bridge.py').touch()
            with patch('native_host.health', side_effect=[None, {'ready': True}]), patch('native_host.subprocess.Popen') as spawn:
                spawn.return_value.poll.return_value = None
                spawn.return_value.pid = 123
                self.assertFalse(ensure_service(root, 'chrome-extension://' + ID, [ID])['reused'])
                args, kwargs = spawn.call_args
                self.assertEqual(args[0][-2:], ['--extension-id', ID])
                self.assertTrue(kwargs['start_new_session'])
                self.assertEqual(kwargs['env']['PATH'].split(':')[0], str(root / 'bin'))
                self.assertNotIn('shell', kwargs)

    def test_a_busy_port_does_not_spawn_or_kill_other_processes(self):
        with tempfile.TemporaryDirectory() as directory, patch('native_host.health', side_effect=StartupError('busy', 'PORT_IN_USE')), patch('native_host.subprocess.Popen') as spawn:
            with self.assertRaises(StartupError):
                ensure_service(Path(directory), 'chrome-extension://' + ID, [ID])
            spawn.assert_not_called()

    def test_service_uses_bundled_tools_and_offline_models(self):
        with patch.dict('os.environ', {'PYTHONPATH': '/untrusted', 'DYLD_INSERT_LIBRARIES': '/untrusted'}):
            env = service_environment(Path('/helper'))
        self.assertEqual(env['HF_HUB_OFFLINE'], '1')
        self.assertEqual(env['PATH'], '/helper/bin:/usr/bin:/bin:/usr/sbin:/sbin')
        self.assertNotIn('PYTHONPATH', env)
        self.assertNotIn('DYLD_INSERT_LIBRARIES', env)
