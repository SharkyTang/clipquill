/* TEST ONLY. Injected by server.py; never included in the extension manifest/page. */
(() => {
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
  const mode = new URL(location.href).searchParams.get('state') || 'complete';
  // Query states use distinct page origins only when needed; reset only this HTTP fixture.
  if (localStorage.getItem('preview.fixture.mode') !== mode) {
    for (const key of ['lastCompleted-v1','lastTranscription','result-v1-'+id,'draft-v1-'+id]) localStorage.removeItem(key);
    if (mode !== 'empty') {
      localStorage.setItem('lastCompleted-v1',JSON.stringify({id,workId}));
      localStorage.setItem('result-v1-'+id,JSON.stringify(job));
      localStorage.setItem('lastTranscription',JSON.stringify({id,workId}));
    }
    localStorage.setItem('preview.fixture.mode',mode);
  }
  localStorage.setItem('loginTipSeen-v1','true');
  const event = (key, oldValue, newValue) => changed.forEach(listener => listener({[key]:{oldValue,newValue}},'local'));
  window.addEventListener('storage',e => {
    if (e.key === 'preview.chrome.'+themeKey) event(themeKey,e.oldValue ? JSON.parse(e.oldValue) : undefined,e.newValue ? JSON.parse(e.newValue) : undefined);
  });
  window.chrome = {
    runtime: {
      getManifest: () => ({name:'ClipQuill',version:'0.1.5'}),
      sendMessage: async () => ({ok:false,error:'隔离测试：此预览不会读取真实抖音页面。'}),
      sendNativeMessage: async () => { throw new Error('隔离测试：此预览不会启动本地助手。'); }
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
    tabs:{query:async()=>[],update:async()=>{throw new Error('隔离测试不操作浏览器标签。');}},
    windows:{update:async()=>{}},
    downloads:{onChanged:{addListener(){}},download:async()=>{throw new Error('隔离测试不下载视频。');},search:async()=>[]}
  };
  // Prevent existing service functions from making any real loopback requests.
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => String(input).startsWith('http://127.0.0.1:8766')
    ? Promise.reject(new TypeError('隔离测试不连接本地语音服务。')) : originalFetch(input, options);
  document.addEventListener('DOMContentLoaded',() => {
    const banner=document.createElement('div'); banner.className='fixture-banner';
    banner.textContent='隔离 UI 测试 · 示例文案 · 无真实下载 / 识别';
    document.body.prepend(banner);
    const style=document.createElement('link'); style.rel='stylesheet'; style.href='fixture.css'; document.head.append(style);
  });
})();
