//代理网站主要逻辑

//导入广告相关逻辑
import { AD_CODE } from './ads.js';
//导入自定义公告相关逻辑
import { getCustomNoticeResponse } from './notice-modifier.js';
//导入缓存相关逻辑
import { handleListAllCache } from './custom-handlers.js';
//导入离线暂存相关逻辑
import { handleOfflineRequest, syncToOriginalServer } from './offline-handler.js';


// 从环境变量获取配置
let rawOrigin = globalThis.ORIGIN_HOST || 'https://fandorabox.net';
if (!rawOrigin.startsWith('http://') && !rawOrigin.startsWith('https://')) {
  rawOrigin = 'https://' + rawOrigin;
}
const TARGET_HOST = rawOrigin;
const TARGET_DOMAIN = new URL(TARGET_HOST).hostname;
const PROXY_DOMAIN = globalThis.PROXY_DOMAIN || TARGET_DOMAIN;
const FRONTEND_HOST = globalThis.FRONTEND_HOST || 'https://your-frontend.com'; // 用于生成二维码跳转URL
const CACHE_TTL = 86400;
const cache = caches.default;

// KV 绑定
const OFFLINE_MODE = globalThis.OFFLINE_MODE === 'true';
const SYNC_PASSWORD = globalThis.SYNC_PASSWORD;
const USER_DATA = globalThis.USER_DATA;
const SESSIONS = globalThis.SESSIONS;
const PENDING_SCORES = globalThis.PENDING_SCORES;
const LIST_CACHE = globalThis.LIST_CACHE;
const MACHINE_SESSIONS = globalThis.MACHINE_SESSIONS;
const OAUTH_SESSIONS = globalThis.OAUTH_SESSIONS; // 新增

const bindings = {
  OFFLINE_MODE,
  USER_DATA,
  SESSIONS,
  PENDING_SCORES,
  LIST_CACHE,
  MACHINE_SESSIONS,
  OAUTH_SESSIONS
};

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

addEventListener('scheduled', event => {
  event.waitUntil(syncToOriginalServer(bindings, TARGET_HOST));
});

// 工具函数：生成随机 ID
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2)}`;
}

async function handleRequest(request, event) {
  try {
    const url = new URL(request.url);

    // ========== 新 API：机器注册 (POST /api/machine/register) ==========
    if (url.pathname === '/api/machine/register' && request.method === 'POST') {
      const appId = url.searchParams.get('appId');
      if (!appId) return new Response('Bad Request: missing appId', { status: 400 });

      const body = await request.json();
      const { name, place, description, maintainerToken } = body;
      if (!name || !place || !description || maintainerToken !== '114514') {
        return new Response('Bad Request: invalid fields or maintainerToken', { status: 400 });
      }

      const machineId = generateId();
      const machineToken = generateId();
      const now = Date.now();

      await MACHINE_SESSIONS.put(machineId, JSON.stringify({
        machineId,
        machineToken,
        name,
        place,
        description,
        maintainerToken,
        appId,
        lastActive: now,
        userId: null // 尚未绑定用户
      }), { expirationTtl: 300 }); // 5分钟无活动自动过期

      // 存储 machineToken 到 machineId 的映射，便于快速查找
      await MACHINE_SESSIONS.put(`token:${machineToken}`, machineId, { expirationTtl: 300 });

      const responseBody = { machineId };
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Set-Cookie', `machine-token=${machineToken}; Path=/; HttpOnly; Max-Age=300`);
      return new Response(JSON.stringify(responseBody), { status: 200, headers });
    }

    // ========== 新 API：申请 OAuth 授权 (GET /api/oauth/register) ==========
    if (url.pathname === '/api/oauth/register' && request.method === 'GET') {
      const cookie = request.headers.get('Cookie') || '';
      const match = cookie.match(/machine-token=([^;]+)/);
      if (!match) return new Response('Unauthorized', { status: 401 });

      const machineToken = match[1];
      const machineId = await MACHINE_SESSIONS.get(`token:${machineToken}`);
      if (!machineId) return new Response('Machine token invalid', { status: 403 });

      const machine = await MACHINE_SESSIONS.get(machineId, 'json');
      if (!machine) return new Response('Machine not found', { status: 404 });

      // 更新最后活动时间
      machine.lastActive = Date.now();
      await MACHINE_SESSIONS.put(machineId, JSON.stringify(machine), { expirationTtl: 300 });

      const appId = url.searchParams.get('appId');
      const reqPermission = url.searchParams.get('reqPermission') || 'basic';
      if (!appId) return new Response('Bad Request: missing appId', { status: 400 });

      const oauthToken = generateId();
      await OAUTH_SESSIONS.put(oauthToken, JSON.stringify({
        machineId,
        appId,
        permission: reqPermission,
        state: 'Pending',
        createdAt: Date.now()
      }), { expirationTtl: 600 }); // 10分钟有效期

      return new Response(oauthToken, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    // ========== 新 API：查询 OAuth 状态 (GET /api/oauth/{oauth-token}/token) ==========
    const oauthMatch = url.pathname.match(/^\/api\/oauth\/([^\/]+)\/token$/);
    if (oauthMatch && request.method === 'GET') {
      const oauthToken = oauthMatch[1];
      const cookie = request.headers.get('Cookie') || '';
      const match = cookie.match(/machine-token=([^;]+)/);
      if (!match) return new Response('Unauthorized', { status: 401 });

      const machineToken = match[1];
      const machineId = await MACHINE_SESSIONS.get(`token:${machineToken}`);
      if (!machineId) return new Response('Machine token invalid', { status: 403 });

      const oauthData = await OAUTH_SESSIONS.get(oauthToken, 'json');
      if (!oauthData) return new Response('Not Found', { status: 404 });

      if (oauthData.machineId !== machineId) {
        return new Response('Forbidden', { status: 403 });
      }

      // 更新机器最后活动时间
      const machine = await MACHINE_SESSIONS.get(machineId, 'json');
      if (machine) {
        machine.lastActive = Date.now();
        await MACHINE_SESSIONS.put(machineId, JSON.stringify(machine), { expirationTtl: 300 });
      }

      let responseBody;
      if (oauthData.state === 'Authorized') {
        // 已授权，返回用户 token（这里模拟生成一个用户token，实际应与现有 SESSIONS 集成）
        const userToken = generateId();
        // 可以将 userToken 与机器绑定，以便后续使用
        responseBody = { state: 'Authorized', token: userToken, permission: oauthData.permission };
        // 可选：删除 OAuth 会话，或保留
      } else {
        responseBody = { state: 'Pending', permission: oauthData.permission };
      }
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ========== 保留原有的四个机台 API（与旧前端兼容）==========
    // GET /api/account/MachineInfo?machine-id-token=GUID
    if (url.pathname === '/api/account/MachineInfo' && request.method === 'GET') {
      const token = url.searchParams.get('machine-id-token');
      if (!token) return new Response('Bad Request', { status: 400 });
      const data = await MACHINE_SESSIONS.get(token, 'json');
      if (!data) return new Response('Not Found', { status: 404 });
      // 更新最后活动时间
      data.lastActive = Date.now();
      await MACHINE_SESSIONS.put(token, JSON.stringify(data), { expirationTtl: 300 });

      const responseBody = {
        IP: "255.168.127.1",
        Place: data.place || "上海市，长宁区",
        MachineInfo: data.name || "GIGO秋叶原1号馆114514鸡"
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // GET /api/account/MachineLoginPermit?machine-id-token=GUID
    if (url.pathname === '/api/account/MachineLoginPermit' && request.method === 'GET') {
      const cookie = request.headers.get('Cookie') || '';
      // 检查用户是否已登录（这里假设有 token cookie，需与现有 SESSIONS 集成）
      if (!cookie.includes('token=')) {
        return new Response('Unauthorized', { status: 401 });
      }
      const token = url.searchParams.get('machine-id-token');
      if (!token) return new Response('Bad Request', { status: 400 });
      const data = await MACHINE_SESSIONS.get(token, 'json');
      if (!data) return new Response('Not Found', { status: 404 });

      // 标记为已确认，并关联用户（假设从 cookie 中获取用户）
      // 这里简化：从 cookie 解析 userId，实际应与 SESSIONS 配合
      const userId = 'user123'; // 模拟
      data.confirmed = true;
      data.userId = userId;
      await MACHINE_SESSIONS.put(token, JSON.stringify(data), { expirationTtl: 300 });
      return new Response(null, { status: 200 });
    }

    // GET /api/account/MachineRegister?MachineInfo=...
    if (url.pathname === '/api/account/MachineRegister' && request.method === 'GET') {
      const machineInfo = url.searchParams.get('MachineInfo');
      if (!machineInfo) return new Response('Bad Request', { status: 400 });
      const guid = generateId();
      await MACHINE_SESSIONS.put(guid, JSON.stringify({
        machineId: guid,
        name: machineInfo,
        place: "上海市，长宁区",
        confirmed: false,
        lastActive: Date.now()
      }), { expirationTtl: 300 });
      const qrContent = `${FRONTEND_HOST}/confirm?machine-id-token=${guid}`;
      return new Response(JSON.stringify({ MachineID: guid, QRContent: qrContent }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // GET /api/account/MachineLoginCheck?MachineID=GUID
    if (url.pathname === '/api/account/MachineLoginCheck' && request.method === 'GET') {
      const machineId = url.searchParams.get('MachineID');
      if (!machineId) return new Response('Bad Request', { status: 400 });
      const data = await MACHINE_SESSIONS.get(machineId, 'json');
      if (!data) return new Response('Not Found', { status: 404 });

      // 更新最后活动时间
      data.lastActive = Date.now();
      await MACHINE_SESSIONS.put(machineId, JSON.stringify(data), { expirationTtl: 300 });

      if (data.confirmed) {
        // 生成 device-token（即 machine-token）
        const deviceToken = generateId();
        // 存储映射
        await MACHINE_SESSIONS.put(`token:${deviceToken}`, machineId, { expirationTtl: 86400 }); // 1天
        const headers = new Headers();
        headers.set('Set-Cookie', `machine-token=${deviceToken}; Path=/; HttpOnly; Max-Age=86400`);
        return new Response(null, { status: 200, headers });
      } else {
        return new Response(null, { status: 202 });
      }
    }

    // ========== 手动同步端点 ==========
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

    // ========== 离线模式处理 ==========
    if (OFFLINE_MODE) {
      const offlineResponse = await handleOfflineRequest(request, bindings);
      if (offlineResponse) return offlineResponse;
    }

    // ========== 特殊路径处理 ==========
    if (url.pathname === '/ads.txt') {
      return new Response(
        'google.com, pub-4002076249242835, DIRECT, f08c47fec0942fa0',
        { status: 200, headers: { 'Content-Type': 'text/plain' } }
      );
    }

    if (url.pathname === '/api/notice') {
      return getCustomNoticeResponse();
    }

    // 铺面列表
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
