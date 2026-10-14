/* TEST ONLY. Injected by server.py; never included in the extension manifest/page. */
(() => {
  const pageURL = new URL(location.href);
  if (pageURL.protocol !== 'http:' || pageURL.hostname !== '127.0.0.1')
    throw new Error('ClipQuill fixture 只能运行在隔离的本机 HTTP 预览。');
  const requestedScenario = pageURL.searchParams.get('scenario') || '';
  const scenario = ['success','poll-error','submit-unknown','storage-error'].includes(requestedScenario) ? requestedScenario : '';
  const interactive = Boolean(scenario);
  const counts = {submissions:0,polls:0,nativeAttempts:0,downloadAttempts:0,blockedRequests:0};
  const requests = [];
  const themeKey = 'clipquill.ui.theme.v1';
  const changed = new Set();
  const id = 'f'.repeat(32), workId = '1000000000000000000';
  const text = [
    '这是一份隔离的界面测试文案，不代表真实视频处理结果。',
    'ClipQuill 把视频里的想法，整理成可以编辑和带走的文字。',
    '从一条抖音分享链接开始，也可以选择已经打开的作品。',
    '下载视频与提取文案彼此独立，按自己的需要选择。',
    '提取时会按原有规则检查和复用完整的本地视频。',
    '识别完成后，先读一遍全文，再结合原音核对细节。',
    '专有名词、数字与标点，往往值得多听一次。',
    '你可以直接修改当前稿，复制全文，或导出 TXT。',
    'SRT 沿用原时间区间，不会平均重新估算时间。',
    '切换浅色、深色或跟随系统时，当前稿会留在原处。',
    '测试预览与真实扩展存储隔离，不会改动你的文案。',
    '本页没有连接抖音、本地模型或浏览器下载接口。'
  ].join('\n');
  const job = {id,workId,status:'complete',title:'界面测试文案 · 非真实任务',text,srt:'fixture',characters:Array.from(text).length,segments:12,elapsedSeconds:0,durationSeconds:60,model:'隔离测试数据',hasAudio:false,warnings:['这是开发 fixture，仅用于布局和当前稿交互检查。'],reviewSegments:text.split('\n').map((line,index)=>({id:index,startMs:index*5000,endMs:index*5000+4500,text:line}))};
  const mode = pageURL.searchParams.get('state') || 'complete';
  const nextId = 'e'.repeat(32), alternateId = 'd'.repeat(32);
  const modeKey = mode + (scenario ? ':' + scenario : '');
  // Reset only known fixture keys on this HTTP origin, never extension storage.
  if (localStorage.getItem('preview.fixture.mode') !== modeKey) {
    for (const key of ['lastCompleted-v1','lastTranscription',...[id,nextId,alternateId].flatMap(value => ['result-v1-'+value,'draft-v1-'+value])]) localStorage.removeItem(key);
    if (mode !== 'empty') {
      localStorage.setItem('lastCompleted-v1',JSON.stringify({id,workId}));
      localStorage.setItem('result-v1-'+id,JSON.stringify(job));
      localStorage.setItem('lastTranscription',JSON.stringify({id,workId}));
    }
    localStorage.setItem('preview.fixture.mode',modeKey);
  }
  localStorage.setItem('loginTipSeen-v1','true');
  if (scenario === 'storage-error') {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (this === window.localStorage && /^draft-v1-/.test(String(key)))
        throw new DOMException('隔离 fixture：模拟当前稿存储空间不足。','QuotaExceededError');
      return setItem.call(this,key,value);
    };
  }
  const fixtureTabs = [1,2].map(index => ({id:8100+index,windowId:8000,active:index===1,
    title:`【隔离测试 ${index}】非真实抖音作品`,url:`https://www.douyin.com/video/100000000000000000${index}`}));
  const fixtureWork = tab => ({id:tab.url.split('/').at(-1),pageURL:tab.url,
    title:tab.title + ' · 模拟元数据',durationMs:60000,webpageDownloadEnabled:null,
    variants:[{width:1280,height:720,size:1024000,format:'mp4',isH265:0,
      // A syntactically compatible address only. The download shim always
      // rejects and cross-origin fetch is blocked; no media request is sent.
      urls:['https://v3-dy-o.zjcdn.com/clipquill-fixture-do-not-fetch.mp4']}]});
  let submittedJob = null;
  const response = (value, status = 200) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const completedJob = value => {
    const lines = [
      '【隔离测试新结果】这不是下载、识别或真实服务成功的证据。',
      '旧的当前稿应先保留，新结果等待明确载入。',
      '本页只模拟来源、视频复用和任务阶段，未读取任何真实视频。'
    ];
    return {...job,id:value.id,workId:value.workId,title:'【隔离测试新结果】' + value.title,text:lines.join('\n'),
      characters:Array.from(lines.join('\n')).length,segments:lines.length,hasAudio:false,
      elapsedSeconds:0,reviewSegments:lines.map((line,index)=>({id:index,startMs:index*5000,endMs:index*5000+4500,text:line}))};
  };
  window.ClipQuillFixture = Object.freeze({
    inspect:() => ({scenario:scenario || 'baseline',state:mode,...counts,
      submittedJobId:submittedJob?.id || null,requests:requests.map(value => ({...value})),
      sources:fixtureTabs.map(tab => ({id:tab.id,url:tab.url,title:tab.title})),
      isolation:'TEST ONLY: no real service, native host, video downloads or Douyin access'})
  });
  const event = (key, oldValue, newValue) => changed.forEach(listener => listener({[key]:{oldValue,newValue}},'local'));
  window.addEventListener('storage',e => {
    if (e.key === 'preview.chrome.'+themeKey) event(themeKey,e.oldValue ? JSON.parse(e.oldValue) : undefined,e.newValue ? JSON.parse(e.newValue) : undefined);
  });
  window.chrome = {
    runtime: {
      getManifest: () => ({name:'ClipQuill',version:'0.1.5'}),
      sendMessage: async payload => {
        if (interactive && payload.action === 'resolve-douyin') {
          const tab = payload.existingTabId ? fixtureTabs.find(tab => tab.id === payload.existingTabId) :
            fixtureTabs.find(tab => tab.url === payload.url);
          return tab ? {ok:true,work:fixtureWork(tab)} : {ok:false,error:'隔离测试仅接受标有测试字样的两个模拟作品链接。'};
        }
        return {ok:false,error:'隔离测试：此预览不会读取真实抖音页面。'};
      },
      sendNativeMessage: async () => { counts.nativeAttempts++; throw new Error('隔离测试：此预览不会启动本地助手。'); }
    },
    storage: {local:{
      async get(key) { const raw=localStorage.getItem('preview.chrome.'+key); return raw ? {[key]:JSON.parse(raw)} : {}; },
      async set(values) {
        for (const [key,value] of Object.entries(values)) {
          const raw=localStorage.getItem('preview.chrome.'+key), oldValue=raw ? JSON.parse(raw) : undefined;
          localStorage.setItem('preview.chrome.'+key,JSON.stringify(value));
          if (oldValue !== value) event(key,oldValue,value);
        }
      }
    },onChanged:{addListener:fn=>changed.add(fn),removeListener:fn=>changed.delete(fn)}},
    tabs:{query:async()=>interactive ? fixtureTabs.map(tab => ({...tab})) : [],update:async()=>{throw new Error('隔离测试不操作浏览器标签。');}},
    windows:{update:async()=>{}},
    downloads:{onChanged:{addListener(){},removeListener(){}},download:async()=>{counts.downloadAttempts++;throw new Error('隔离测试不下载真实视频；本页仅验证错误提示，不能证明下载成功。');},search:async()=>[]}
  };
  // Every service URL is intercepted before native fetch; unknown routes fail
  // closed. Every other cross-origin fetch is blocked too. Same-origin files
  // remain available for the real extension modules and optional test assets.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input),location.href);
    if (url.origin === 'http://127.0.0.1:8766') {
      const method = String(options.method || input.method || 'GET').toUpperCase();
      requests.push({method,path:url.pathname});
      if (!interactive) throw new TypeError('隔离测试不连接本地语音服务。');
      const payload = options.body ? JSON.parse(options.body) : null;
      if (url.pathname === '/health' && method === 'GET')
        return response({service:'douyin-local-transcription',protocol:1,ready:true,videoReuse:true});
      if (url.pathname === '/videos/find' && method === 'POST') {
        const tab = fixtureTabs.find(tab => tab.url.endsWith('/' + payload?.workId));
        const variant = payload?.variants?.find(value => value.height === 720 && value.expectedBytes === 1024000);
        if (!tab || !variant) return response({error:'隔离测试视频参数不匹配。',code:'FIXTURE_INVALID'},400);
        return response({file:{path:'/CLIPQUILL_FIXTURE_ONLY/no-real-file.mp4',workId:payload.workId,
          height:720,expectedBytes:1024000,durationMs:60000}});
      }
      if (url.pathname === '/jobs' && method === 'POST') {
        counts.submissions++;
        if (!fixtureTabs.some(tab => tab.url.endsWith('/' + payload?.workId)))
          return response({error:'隔离测试作品无效。',code:'FIXTURE_INVALID'},400);
        submittedJob = {id:payload.workId.endsWith('2') ? alternateId : nextId,workId:payload.workId,
          title:payload.title,startedAt:Date.now()/1000,status:'running',stage:'隔离测试：模拟任务已接收'};
        if (scenario === 'submit-unknown') throw new TypeError('隔离 fixture：POST 响应丢失，提交结果未知。');
        return response(submittedJob);
      }
      if (url.pathname === '/jobs/' + id && method === 'GET') return response(job);
      if (submittedJob && url.pathname === '/jobs/' + submittedJob.id && method === 'GET') {
        counts.polls++;
        if (scenario === 'poll-error' && counts.polls === 1) throw new TypeError('隔离 fixture：第一次任务查询连接失败。');
        if (counts.polls >= (scenario === 'poll-error' ? 2 : 3)) return response(completedJob(submittedJob));
        return response({...submittedJob,stage:counts.polls === 1 ? '隔离测试：模拟读取已复用文件' : '隔离测试：模拟语音识别阶段'});
      }
      return response({error:'隔离 fixture 未模拟此服务接口，未发送真实请求。',code:'FIXTURE_UNSUPPORTED'},404);
    }
    if (url.origin !== location.origin) {
      counts.blockedRequests++;
      throw new TypeError('隔离 fixture 阻止外部网络请求。');
    }
    return originalFetch(input, options);
  };
  document.addEventListener('DOMContentLoaded',() => {
    const banner=document.createElement('div'); banner.className='fixture-banner';
    banner.textContent='隔离 UI 测试 · ' + (scenario || 'baseline') + ' · 示例文案/模拟阶段 · 无真实下载 / 识别 / 本地服务';
    document.body.prepend(banner);
    const style=document.createElement('link'); style.rel='stylesheet'; style.href='fixture.css'; document.head.append(style);
  });
})();
