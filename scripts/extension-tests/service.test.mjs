import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureLocalService, launchLocalHelper, NATIVE_HOST} from '../../outputs/douyin-independent-extension/service.mjs';

const ready = {service:'douyin-local-transcription',protocol:1,ready:true,videoReuse:true};
const unavailable = () => Object.assign(new Error('offline'),{code:'SERVICE_UNAVAILABLE'});

test('a ready service is reused without invoking a native host', async () => {
  let launched = 0;
  assert.equal(await ensureLocalService({request:async() => ready,launch:async() => launched++}),ready);
  assert.equal(launched,0);
});
test('a cold service is launched and checked before processing continues', async () => {
  const events = [];
  let connected = false;
  await ensureLocalService({
    request:async() => { events.push('health'); if (!connected) throw unavailable(); return ready; },
    launch:async() => { events.push('launch'); connected = true; },
    onState:text => events.push(text)
  });
  assert.deepEqual(events.filter(event => ['health','launch'].includes(event)),['health','launch','health']);
  assert.ok(events.some(event => event.includes('启动后会继续提取')));
});
test('a failed startup is retryable and the next attempt checks and launches anew', async () => {
  let attempts = 0, connected = false;
  const options = {
    request:async() => { if (!connected) throw unavailable(); return ready; },
    launch:async() => { if (++attempts === 1) throw new Error('first attempt failed'); connected = true; }
  };
  await assert.rejects(ensureLocalService(options),error => error.serviceStartup === true);
  assert.equal(await ensureLocalService(options),ready);
  assert.equal(attempts,2);
});
test('a mismatched or unready service is surfaced without launching a duplicate', async () => {
  for (const value of [{...ready,service:'other'},{...ready,ready:false},{...ready,videoReuse:false}]) {
    let launched = false;
    await assert.rejects(ensureLocalService({request:async() => value,launch:async() => {launched=true;}}));
    assert.equal(launched,false);
  }
});
test('native messaging uses only the fixed host and startup command', async () => {
  await launchLocalHelper({async sendNativeMessage(name,payload) {
    assert.equal(name,NATIVE_HOST);
    assert.deepEqual(payload,{action:'ensureService',protocol:1});
    return {ok:true,protocol:1};
  }});
});
test('missing hosts, startup errors, bad protocol and timeouts provide actionable retry errors', async () => {
  await assert.rejects(launchLocalHelper({async sendNativeMessage(){throw new Error('Specified native messaging host not found.');}}),error => error.code === 'HELPER_NOT_INSTALLED');
  await assert.rejects(launchLocalHelper({async sendNativeMessage(){return {ok:false,protocol:1,code:'PORT_IN_USE',error:'port busy'};}}),error => error.serviceStartup && error.code === 'PORT_IN_USE');
  await assert.rejects(launchLocalHelper({async sendNativeMessage(){return {ok:true,protocol:999};}}),/启动失败/);
  await assert.rejects(launchLocalHelper({sendNativeMessage(){return new Promise(() => {});}},5),error => error.code === 'STARTUP_TIMEOUT');
});
