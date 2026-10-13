#!/usr/bin/env python3
"""Inspect local Douyin JSON, saved HTML or HAR. Never sends network requests.

This is a metadata inspector, not a downloader or a permission override.
Only the requested work is reported. URLs are fingerprinted, never exported.
"""
import argparse
import base64
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

MAX_BYTES = 64 * 1024 * 1024


class RenderDataParser(HTMLParser):
    """Read the inert JSON script only; never execute page JavaScript."""
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = False
        self.parts = []
        self.count = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script':
            self.active = attrs.get('id') == 'RENDER_DATA' and attrs.get('type') == 'application/json'
            if self.active:
                self.count += 1

    def handle_endtag(self, tag):
        if tag == 'script':
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)


def parse_payload(text):
    if not text.lstrip().startswith('<'):
        return json.loads(text)
    parser = RenderDataParser()
    parser.feed(text)
    if parser.count != 1:
        raise ValueError('expected exactly one application/json RENDER_DATA script')
    return json.loads(unquote(''.join(parser.parts)))


def object_value(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            pass
    return {}


def documents(data):
    """HAR requests/headers/cookies are intentionally not copied to results."""
    if not isinstance(data, dict) or 'log' not in data:
        yield ('html_render_data', parse_payload(data)) if isinstance(data, str) else ('json', data)
        return
    for index, entry in enumerate(object_value(data['log']).get('entries', [])):
        if not isinstance(entry, dict):
            continue
        url = urlsplit(object_value(entry.get('request')).get('url', ''))
        if url.scheme != 'https' or url.hostname not in ('www.douyin.com', 'www-hj.douyin.com'):
            continue
        if not (url.path.startswith('/aweme/v1/web/') or url.path.startswith('/video/') or url.path == '/user/self'):
            continue
        response = object_value(entry.get('response'))
        if response.get('status') != 200:
            continue
        content = object_value(response.get('content'))
        text = content.get('text', '')
        try:
            if content.get('encoding') == 'base64':
                text = base64.b64decode(text, validate=True).decode('utf-8')
            yield f'har_response_{index}', parse_payload(text)
        except (ValueError, TypeError, UnicodeError):
            continue


def matching_works(data, work_id):
    stack = [data]
    examined = 0
    while stack:
        value = stack.pop()
        examined += 1
        if examined > 200000:
            raise ValueError('JSON structure exceeds inspection limit')
        if isinstance(value, dict):
            ids = [str(value[key]) for key in ('aweme_id', 'awemeId') if key in value]
            if ids and all(item == work_id for item in ids) and isinstance(value.get('video'), dict):
                yield value
            else:
                stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)


def download_permission(work):
    control = object_value(work.get('video_control'))
    allow = control.get('allow_download')
    level = object_value(control.get('download_info')).get('level')
    prevent = work.get('prevent_download', work.get('preventDownload'))
    normalized_allow = object_value(work.get('download')).get('allowDownload')
    if prevent or normalized_allow is False or allow is False or (type(allow) is int and allow == 0) or (level is not None and level != 0):
        state = 'restricted'
    elif normalized_allow is True or ((allow is True or (type(allow) is int and allow == 1)) and type(level) is int and level == 0):
        state = 'allowed_in_metadata'
    else:
        state = 'unknown'
    return {'state': state, 'allow_download': allow, 'normalized_allow_download': normalized_allow, 'download_info_level': level,
            'prevent_download': prevent, 'note': 'Site download UI signal only; HTTP media access is separately verified and neither signal grants reuse rights.'}


def inspect_work(work):
    video = work['video']
    candidates = []

    def add(address, field, kind, metadata=None):
        metadata = metadata or {}
        urls = address if isinstance(address, list) else [address]
        for url in urls:
            if isinstance(url, dict):
                url = url.get('src')
            if not isinstance(url, str) or not url:
                continue
            parsed = urlsplit(url)
            if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
                candidates.append({'field': field, 'kind': kind, 'url_state': 'not_plain_http_url'})
                continue
            candidates.append({'field': field, 'kind': kind, 'host': parsed.hostname,
                               'url_sha256': hashlib.sha256(url.encode()).hexdigest(),
                               'url_state': 'observed_metadata_only',
                               'width': metadata.get('width'), 'height': metadata.get('height'),
                               'size': metadata.get('data_size', metadata.get('dataSize', metadata.get('size'))),
                               'format': metadata.get('format', metadata.get('videoFormat')),
                               'gear_name': metadata.get('gearName'),
                               'is_h265': metadata.get('isH265'),
                               'media_file_id': metadata.get('fileId'),
                               'encrypted_metadata_present': bool(metadata.get('encrypt_info') or metadata.get('encrypted') or metadata.get('drm')),
                               'watermark_verdict': 'unverified'})

    for field in ('play_addr', 'play_addr_265', 'download_addr', 'download_suffix_logo_addr'):
        address = object_value(video.get(field))
        add(address.get('url_list', []), 'video.' + field, 'download' if 'download' in field else 'playback', address)
    for index, bitrate in enumerate(video.get('bit_rate') or []):
        address = object_value(object_value(bitrate).get('play_addr'))
        add(address.get('url_list', []), f'video.bit_rate[{index}].play_addr', 'playback', address)
    for index, audio in enumerate(video.get('bit_rate_audio') or []):
        metadata = object_value(object_value(audio).get('audio_meta'))
        urls = object_value(metadata.get('url_list'))
        add([urls.get(key) for key in ('main_url', 'backup_url', 'fallback_url')],
            f'video.bit_rate_audio[{index}].audio_meta.url_list', 'audio', metadata)
    for field in ('playAddr', 'playAddrH265'):
        metadata = {'width': video.get('width'), 'height': video.get('height'),
                    'dataSize': video.get(field + 'Size')}
        add(video.get(field, []), 'video.' + field, 'playback', metadata)
    for index, bitrate in enumerate(video.get('bitRateList') or []):
        bitrate = object_value(bitrate)
        add(bitrate.get('playAddr', []), f'video.bitRateList[{index}].playAddr', 'playback', bitrate)
    for index, audio in enumerate(video.get('bitRateAudioList') or []):
        audio = object_value(audio)
        add(audio.get('urlList', []), f'video.bitRateAudioList[{index}].urlList', 'audio', audio)
    download = object_value(work.get('download'))
    add(download.get('urlList', []), 'download.urlList', 'download', download)
    model = object_value(video.get('video_model'))
    dynamic = object_value(model.get('dynamic_video'))
    for field, kind in (('dynamic_video_list', 'video'), ('dynamic_audio_list', 'audio')):
        items = dynamic.get(field) or []
        if isinstance(items, dict):
            items = list(items.values())
        for index, item in enumerate(items):
            item = object_value(item)
            add([item.get(key) for key in ('main_url', 'backup_url', 'backup_url_1')],
                f'video.video_model.dynamic_video.{field}[{index}]', kind, item)
    return {'work_id': str(work.get('aweme_id', work.get('awemeId'))), 'title': work.get('desc'),
            'schema': 'normalized_page_data' if 'awemeId' in work else 'raw_api_data',
            'duration_raw': video.get('duration'), 'duration_unit': 'not_inferred',
            'download_permission': download_permission(work),
            'media_candidates': candidates, 'candidate_count': len(candidates),
            'watermark_verdict': 'unverified', 'download_performed': False}


def inspect(data, work_id):
    versions = []
    seen = set()
    for source, document in documents(data):
        for work in matching_works(document, work_id):
            result = inspect_work(work)
            fingerprint = json.dumps(result, ensure_ascii=False, sort_keys=True)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            result['source'] = source
            versions.append(result)
    return {'requested_work_id': work_id,
            'status': 'target_not_found' if not versions else ('target_found' if len(versions) == 1 else 'multiple_versions_review_required'),
            'network_requests_sent': 0, 'results': versions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--work-id', required=True)
    args = parser.parse_args()
    if not args.work_id.isdecimal() or not 10 <= len(args.work_id) <= 30:
        parser.error('work-id must be a decimal work ID')
    try:
        with args.input.open('rb') as source:
            content = source.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise ValueError('input exceeds 64 MiB')
        text = content.decode('utf-8-sig')
        data = text if text.lstrip().startswith('<') else json.loads(text)
        print(json.dumps(inspect(data, args.work_id), ensure_ascii=False, indent=2))
    except (OSError, ValueError, TypeError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
