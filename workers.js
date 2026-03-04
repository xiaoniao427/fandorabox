//代理网站主要逻辑

//导入广告相关逻辑
import { AD_CODE } from './ads.js';
//导入自定义公告相关逻辑
import { getCustomNoticeResponse } from './notice-modifier.js';
//导入缓存相关逻辑
import { handleListAllCache } from './custom-handlers.js';
//导入离线暂存相关逻辑
import { handleOfflineRequest, syncToOriginalServer } from './offline-handler.js';

const TARGET_HOST = globalThis.ORIGIN_HOST || 'https://fandorabox.net';
const TARGET_DOMAIN = new URL(TARGET_HOST).hostname;
const PROXY_DOMAIN = globalThis.PROXY_DOMAIN || new URL(TARGET_HOST).hostname; // 可选，用于替换响应中的域名
const CACHE_TTL = 86400; // 24小时
const cache = caches.default;

// 从全局获取绑定的 KV 和变量
const OFFLINE_MODE = globalThis.OFFLINE_MODE === 'true';
const SYNC_PASSWORD = globalThis.SYNC_PASSWORD;
const USER_DATA = globalThis.USER_DATA;
const SESSIONS = globalThis.SESSIONS;
const PENDING_SCORES = globalThis.PENDING_SCORES;
const LIST_CACHE = globalThis.LIST_CACHE;
const MACHINE_SESSIONS = globalThis.MACHINE_SESSIONS; // 新增：用于机台登录会话

const bindings = {
  OFFLINE_MODE,
  USER_DATA,
  SESSIONS,
  PENDING_SCORES,
  LIST_CACHE,
  MACHINE_SESSIONS
};

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

// 定时触发器（每30分钟）
addEventListener('scheduled', event => {
  event.waitUntil(syncToOriginalServer(bindings, TARGET_HOST));
});

async function handleRequest(request, event) {
  try {
    const url = new URL(request.url);

    // ========== 新增：机台登录相关 API（始终返回模拟响应）==========
    if (url.pathname === '/api/account/MachineInfo' && request.method === 'GET') {
      const token = url.searchParams.get('machine-id-token');
      if (!token) return new Response('Bad Request', { status: 400 });
      const data = await MACHINE_SESSIONS.get(token, 'json');
      if (!data) return new Response('Not Found', { status: 404 });
      const responseBody = {
        IP: "255.168.127.1",
        Place: data.place || "上海市，长宁区",
        MachineInfo: data.machineInfo || "GIGO秋叶原1号馆114514鸡"
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/api/account/MachineLoginPermit' && request.method === 'GET') {
      const cookie = request.headers.get('Cookie') || '';
      if (!cookie.includes('token=')) {
        return new Response('Unauthorized', { status: 401 });
      }
      const token = url.searchParams.get('machine-id-token');
      if (!token) return new Response('Bad Request', { status: 400 });
      const data = await MACHINE_SESSIONS.get(token, 'json');
      if (!data) return new Response('Not Found', { status: 404 });
      data.confirmed = true;
      await MACHINE_SESSIONS.put(token, JSON.stringify(data));
      return new Response(null, { status: 200 });
    }

    if (url.pathname === '/api/account/MachineRegister' && request.method === 'GET') {
      const machineInfo = url.searchParams.get('MachineInfo');
      if (!machineInfo) return new Response('Bad Request', { status: 400 });
      const guid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2)}`;
      await MACHINE_SESSIONS.put(guid, JSON.stringify({
        machineInfo,
        place: "上海市，长宁区", //别问为什么
        confirmed: false
      }));
      const qrContent = `https://majdata.net/...?machine-id-token=${guid}`;
      return new Response(JSON.stringify({ MachineID: guid, QRContent: qrContent }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/api/account/MachineLoginCheck' && request.method === 'GET') {
      const machineId = url.searchParams.get('MachineID');
      if (!machineId) return new Response('Bad Request', { status: 400 });
      const data = await MACHINE_SESSIONS.get(machineId, 'json');
      if (!data) return new Response('Not Found', { status: 404 });
      if (data.confirmed) {
        const headers = new Headers();
        headers.set('Set-Cookie', 'machine-token=amns114514; Path=/; HttpOnly');
        return new Response(null, { status: 200, headers });
      } else {
        return new Response(null, { status: 202 });
      }
    }
    // ========== 机台登录 API 结束 ==========

    // 手动同步端点（需密码鉴权）
    if (url.pathname === '/api/manual-sync') {
      if (!SYNC_PASSWORD) {
        return new Response(JSON.stringify({ success: false, error: 'Sync password not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const password = url.searchParams.get('password');
      if (password !== SYNC_PASSWORD) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      try {
        await syncToOriginalServer(bindings, TARGET_HOST);
        return new Response(JSON.stringify({ success: true, message: '同步完成' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 离线模式处理
    if (OFFLINE_MODE) {
      const offlineResponse = await handleOfflineRequest(request, bindings);
      if (offlineResponse) return offlineResponse;
    }

    // 特殊路径处理
    if (url.pathname === '/ads.txt') {
      return new Response(
        'google.com, pub-4002076249242835, DIRECT, f08c47fec0942fa0',
        { status: 200, headers: { 'Content-Type': 'text/plain' } }
      );
    }

    if (url.pathname === '/api/notice') {
      return getCustomNoticeResponse();
    }

    // 铺面列表 - 直接返回静态数据
    const listAllResponse = await handleListAllCache(request);
    if (listAllResponse) return listAllResponse;

    // 根路径缓存
    if (url.pathname === '/' && request.method === 'GET') {
      const cacheKey = new Request(TARGET_HOST + '/', { method: 'GET' });
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) return cachedResponse;
    }

    // 反向代理其他请求
    const targetUrl = TARGET_HOST + url.pathname + url.search;
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual'
    });

    newRequest.headers.set('Host', TARGET_DOMAIN);
    newRequest.headers.set('Origin', TARGET_HOST);
    newRequest.headers.set('Referer', TARGET_HOST + '/');
    newRequest.headers.delete('X-Forwarded-For');

    let response = await fetch(newRequest);

    // 广告插入（仅 HTML）
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('text/html')) {
      const rewriter = new HTMLRewriter().on('main', {
        element(element) {
          element.after(AD_CODE, { html: true });
        }
      });
      response = rewriter.transform(response);
    }

    const modifiedResponse = new Response(response.body, response);

    // 处理 Set-Cookie
    const cookies = [];
    modifiedResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        cookies.push(value);
      }
    });
    if (cookies.length) {
      modifiedResponse.headers.delete('Set-Cookie');
      cookies.forEach(cookie => {
        let newCookie = cookie.replace(/;?\s*Domain=[^;]*/i, '');
        modifiedResponse.headers.append('Set-Cookie', newCookie);
      });
    }

    // 处理重定向 Location
    const location = modifiedResponse.headers.get('Location');
    if (location) {
      try {
        const locationUrl = new URL(location, TARGET_HOST);
        if (locationUrl.hostname === TARGET_DOMAIN) {
          const workerUrl = new URL(request.url);
          workerUrl.hostname = PROXY_DOMAIN;
          workerUrl.pathname = locationUrl.pathname;
          workerUrl.search = locationUrl.search;
          modifiedResponse.headers.set('Location', workerUrl.toString());
        }
      } catch (e) {}
    }

    // 删除 CSP，添加 CORS
    modifiedResponse.headers.delete('Content-Security-Policy');
    modifiedResponse.headers.delete('Content-Security-Policy-Report-Only');
    modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');

    // 根路径缓存存储
    if (url.pathname === '/' && request.method === 'GET' && modifiedResponse.status === 200) {
      const responseToCache = modifiedResponse.clone();
      const newHeaders = new Headers(responseToCache.headers);
      newHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: newHeaders
      });
      await cache.put(new Request(TARGET_HOST + '/', { method: 'GET' }), cachedResponse);
    }

    return modifiedResponse;
  } catch (error) {
    return new Response('代理错误：' + error.message, { status: 500 });
  }
}
