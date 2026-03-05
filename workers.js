//代理网站主要逻辑

//导入广告相关逻辑
import { AD_CODE } from './ads.js';
//导入自定义公告相关逻辑
import { getCustomNoticeResponse } from './notice-modifier.js';
//导入缓存相关逻辑
import { handleListAllCache } from './custom-handlers.js';
//导入离线暂存相关逻辑
import { handleOfflineRequest, syncToOriginalServer } from './offline-handler.js';
//导入扫码登录相关逻辑
import { handleAuthRequest } from './auth-handler.js';
//导入授权登录前端页面相关逻辑
import { renderAuthConfirmPage, renderLoginPage } from './auth-page.js';


// 从环境变量获取配置
let rawOrigin = globalThis.ORIGIN_HOST || 'https://fandorabox.net';
if (!rawOrigin.startsWith('http://') && !rawOrigin.startsWith('https://')) {
  rawOrigin = 'https://' + rawOrigin;
}
const TARGET_HOST = rawOrigin;
const TARGET_DOMAIN = new URL(TARGET_HOST).hostname;
const PROXY_DOMAIN = globalThis.PROXY_DOMAIN || TARGET_DOMAIN;
const FRONTEND_HOST = globalThis.FRONTEND_HOST || 'https://your-frontend.com';
const CACHE_TTL = 86400;
const cache = caches.default;

// KV 绑定
const OFFLINE_MODE = globalThis.OFFLINE_MODE === 'true';
const SYNC_PASSWORD = globalThis.SYNC_PASSWORD;
const USER_DATA = globalThis.USER_DATA;
const SESSIONS = globalThis.SESSIONS;
const PENDING_SCORES = globalThis.PENDING_SCORES;
const MACHINE_SESSIONS = globalThis.MACHINE_SESSIONS;
const OAUTH_SESSIONS = globalThis.OAUTH_SESSIONS;

const bindings = {
  OFFLINE_MODE,
  USER_DATA,
  SESSIONS,
  PENDING_SCORES,
  MACHINE_SESSIONS,
  OAUTH_SESSIONS
};

/**
 * Generate a short unique identifier suitable for use as a session ID.
 * @returns {string} A unique identifier string.
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2)}`;
}

/**
 * Compute the MD5 hash of a string.
 * @param {string} str - The input string to hash.
 * @returns {Promise<string>} The MD5 digest as a lowercase hexadecimal string.
 */
async function md5(str) {
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('MD5', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

addEventListener('scheduled', event => {
  event.waitUntil(syncToOriginalServer(bindings, TARGET_HOST));
});

/**
 * Handle an incoming fetch request: serve login/auth pages and APIs, perform manual/offline sync and caching, or reverse-proxy the request to the configured target with post-processing.
 *
 * This function may:
 * - Render the frontend login or auth confirmation pages.
 * - Authenticate users in offline mode (create or validate credentials, issue a session cookie).
 * - Handle auth-related requests, manual synchronization, offline request handling, and static endpoints like /ads.txt and /api/notice.
 * - Serve a cached root (/) response and store successful proxied root responses to cache.
 * - Forward other requests to the target origin, inject ad content into HTML responses, rewrite Set-Cookie headers (remove Domain), rewrite redirect Location headers to the proxy domain when appropriate, remove Content-Security-Policy headers, and add Access-Control-Allow-Origin: *.
 *
 * @param {Request} request - The incoming request to handle.
 * @param {FetchEvent} event - The fetch event associated with the request.
 * @returns {Response} A Response for the request (page, JSON, or proxied response) after any applicable authentication, caching, injection, and header rewrites.
 */
async function handleRequest(request, event) {
  try {
    const url = new URL(request.url);

    // ========== 前端登录页面 ==========
    if (url.pathname === '/login' && request.method === 'GET') {
      return renderLoginPage();
    }

    // ========== 登录 API（离线模拟模式） ==========
    if (url.pathname === '/api/account/login' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body) {
        return new Response('Bad Request: invalid JSON', { status: 400 });
      }
      const { username, password } = body;
      if (!username || !password) {
        return new Response('Bad Request: missing username or password', { status: 400 });
      }

      const hashedPassword = await md5(password);
      const storedPassword = await USER_DATA.get(`cred:${username}`);
      
      if (!storedPassword) {
        await USER_DATA.put(`cred:${username}`, hashedPassword, { expirationTtl: 30 * 86400 });
      } else if (storedPassword !== hashedPassword) {
        return new Response('Unauthorized', { status: 401 });
      }

      const sessionId = generateId();
      await SESSIONS.put(sessionId, username, { expirationTtl: 7 * 86400 });

      const headers = new Headers();
      headers.set('Set-Cookie', `connect.sid=${sessionId}; Path=/; HttpOnly; Max-Age=604800`);
      headers.set('Content-Type', 'application/json');
      const responseBody = {
        username,
        isAdmin: false,
        avatarUrl: `/api/account/Avatar/${username}`
      };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers
      });
    }

    // ========== 前端确认页面 ==========
    if (url.pathname === '/auth/confirm' && request.method === 'GET') {
      return renderAuthConfirmPage();
    }

    // ========== 处理扫码登录相关 API ==========
    const authResponse = await handleAuthRequest(request, bindings, FRONTEND_HOST);
    if (authResponse) return authResponse;

    // 手动同步端点
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

    // 广告插入
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
