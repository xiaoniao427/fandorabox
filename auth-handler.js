// auth-handler.js
// 实现新的扫码登录 API（完全基于您提供的最新设计）

// 工具函数：生成随机 ID
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2)}`;
}

// 模拟获取客户端 IP（实际可从 CF-Connecting-IP 头获取，这里简化）
function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || '255.168.127.1';
}

/**
 * 处理扫码登录相关的 API 请求
 * @param {Request} request - 原始请求对象
 * @param {Object} bindings - 包含 KV 绑定的对象（MACHINE_SESSIONS, OAUTH_SESSIONS, SESSIONS, USER_DATA）
 * @param {string} frontendHost - 前端主机地址，用于生成授权页 URL
 * @returns {Promise<Response|null>} 如果路径匹配则返回响应，否则返回 null
 */
export async function handleAuthRequest(request, bindings, frontendHost) {
  const { MACHINE_SESSIONS, OAUTH_SESSIONS, SESSIONS, USER_DATA } = bindings;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

// ---------- 机器注册 POST /api/machine/registry 和 /api/machine/register ----------
if ((path === '/api/machine/registry' || path === '/api/machine/register') && method === 'POST') {
  const body = await request.json();
  const { name, description } = body;
  if (!name || !description) {
    return new Response('Bad Request: missing name or description', { status: 400 });
  }

  const machineId = generateId();
  const machineToken = generateId();

  await MACHINE_SESSIONS.put(machineId, JSON.stringify({
    machineId,
    machineToken,
    name,
    description,
    place: '上海市，长宁区',
    lastActive: Date.now()
  }), { expirationTtl: 300 });

  await MACHINE_SESSIONS.put(`token:${machineToken}`, machineId, { expirationTtl: 300 });

  const headers = new Headers();
  headers.set('Set-Cookie', `machine-token=${machineToken}; Path=/; HttpOnly; Max-Age=300`);
  headers.set('Set-Cookie', `machine-id=${machineId}; Path=/; HttpOnly; Max-Age=300`);
  return new Response(null, { status: 200, headers });
}

  // ---------- 申请授权会话 POST /api/machine/auth/request ----------
  if (path === '/api/machine/auth/request' && method === 'POST') {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/machine-token=([^;]+)/);
    if (!match) return new Response('Unauthorized', { status: 401 });

    const machineToken = match[1];
    const machineId = await MACHINE_SESSIONS.get(`token:${machineToken}`);
    if (!machineId) return new Response('Machine token invalid', { status: 401 });

    const machine = await MACHINE_SESSIONS.get(machineId, 'json');
    if (!machine) return new Response('Machine not found', { status: 404 });

    // 检查该机器是否有未完成的授权会话
    const existingAuth = await OAUTH_SESSIONS.list({ prefix: `machine:${machineId}:` });
    for (const key of existingAuth.keys) {
      const auth = await OAUTH_SESSIONS.get(key.name, 'json');
      if (auth && auth.status === 'pending') {
        return new Response('Forbidden: pending auth session exists', { status: 403 });
      }
    }

    const authId = generateId();
    const location = `${frontendHost}/auth/confirm?auth-id=${authId}`;

    await OAUTH_SESSIONS.put(authId, JSON.stringify({
      machineId,
      status: 'pending',
      createdAt: Date.now()
    }), { expirationTtl: 600 }); // 10分钟有效期

    // 同时存储一个按机器索引的键，便于查找
    await OAUTH_SESSIONS.put(`machine:${machineId}:${authId}`, authId, { expirationTtl: 600 });

    const headers = new Headers();
    headers.set('Location', location);
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ authId }), {
      status: 201,
      headers
    });
  }

  // ---------- 前端获取机台信息 GET /api/machine/auth/info?auth-id={authId} ----------
  if (path === '/api/machine/auth/info' && method === 'GET') {
    const authId = url.searchParams.get('auth-id');
    if (!authId) return new Response('Bad Request: missing auth-id', { status: 400 });

    const auth = await OAUTH_SESSIONS.get(authId, 'json');
    if (!auth) return new Response('Not Found', { status: 404 });

    const machine = await MACHINE_SESSIONS.get(auth.machineId, 'json');
    if (!machine) return new Response('Machine not found', { status: 404 });

    // 更新机器最后活动时间
    machine.lastActive = Date.now();
    await MACHINE_SESSIONS.put(auth.machineId, JSON.stringify(machine), { expirationTtl: 300 });

    const responseBody = {
      grantee: 'machine',
      granteeInfo: {
        name: machine.name,
        description: machine.description,
        place: machine.place,
        remoteIP: getClientIP(request)  // 模拟或真实 IP
      }
    };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // ---------- 用户确认登录 POST /api/machine/auth/permit?auth-id={authId} ----------
  if (path === '/api/machine/auth/permit' && method === 'POST') {
    const authId = url.searchParams.get('auth-id');
    if (!authId) return new Response('Bad Request: missing auth-id', { status: 400 });

    // 检查用户是否已在前端登录（假设有 token cookie）
    const cookie = request.headers.get('Cookie') || '';
    const userMatch = cookie.match(/token=([^;]+)/);
    if (!userMatch) return new Response('Unauthorized', { status: 401 });

    const userToken = userMatch[1];
    // 从 SESSIONS 获取用户名（假设 SESSIONS 存储了 username）
    const username = await SESSIONS.get(userToken);
    if (!username) return new Response('Unauthorized', { status: 401 });

    const auth = await OAUTH_SESSIONS.get(authId, 'json');
    if (!auth) return new Response('Not Found', { status: 404 });

    if (auth.status !== 'pending') {
      // 已处理过的会话返回 204（No Content）
      return new Response(null, { status: 204 });
    }

    // 标记为已授权，并存储用户信息
    auth.status = 'authorized';
    auth.userInfo = {
      username,
      // 可从 USER_DATA 获取更多信息，如 email、joinDate
      email: 'user@example.com',
      joinDate: new Date().toISOString().split('T')[0]
    };
    await OAUTH_SESSIONS.put(authId, JSON.stringify(auth), { expirationTtl: 600 });

    return new Response(null, { status: 200 });
  }

  // ---------- Majplay 检查授权状态 GET /api/machine/auth/check?auth-id={authId} ----------
  if (path === '/api/machine/auth/check' && method === 'GET') {
    const authId = url.searchParams.get('auth-id');
    if (!authId) return new Response('Bad Request: missing auth-id', { status: 400 });

    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/machine-token=([^;]+)/);
    if (!match) return new Response('Unauthorized', { status: 401 });

    const machineToken = match[1];
    const machineId = await MACHINE_SESSIONS.get(`token:${machineToken}`);
    if (!machineId) return new Response('Machine token invalid', { status: 401 });

    const auth = await OAUTH_SESSIONS.get(authId, 'json');
    if (!auth) return new Response('Not Found', { status: 404 });

    // 验证所有权
    if (auth.machineId !== machineId) {
      return new Response('Forbidden', { status: 403 });
    }

    // 更新机器最后活动时间
    const machine = await MACHINE_SESSIONS.get(machineId, 'json');
    if (machine) {
      machine.lastActive = Date.now();
      await MACHINE_SESSIONS.put(machineId, JSON.stringify(machine), { expirationTtl: 300 });
    }

    if (auth.status === 'pending') {
      return new Response(null, { status: 202 }); // 尚未完成
    } else if (auth.status === 'authorized') {
      // 生成用户 token（这里用 auth.userInfo 构造，实际应与现有登录系统集成）
      const userToken = generateId();
      // 存储用户 token 到 SESSIONS（假设用 userToken 映射用户名）
      await SESSIONS.put(userToken, auth.userInfo.username, { expirationTtl: 86400 }); // 1天

      const headers = new Headers();
      headers.set('Set-Cookie', `token=${userToken}; Path=/; HttpOnly; Max-Age=86400`);
      headers.set('Content-Type', 'application/json');
      const responseBody = {
        token: userToken,
        userInfo: auth.userInfo
      };
      return new Response(JSON.stringify(responseBody), { status: 200, headers });
    } else {
      // 其他状态视为未找到
      return new Response('Not Found', { status: 404 });
    }
  }

  // ---------- 吊销授权会话 POST /api/machine/auth/revoke?auth-id={authId} ----------
  if (path === '/api/machine/auth/revoke' && method === 'POST') {
    const authId = url.searchParams.get('auth-id');
    if (!authId) return new Response('Bad Request: missing auth-id', { status: 400 });

    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/machine-token=([^;]+)/);
    if (!match) return new Response('Unauthorized', { status: 401 });

    const machineToken = match[1];
    const machineId = await MACHINE_SESSIONS.get(`token:${machineToken}`);
    if (!machineId) return new Response('Machine token invalid', { status: 401 });

    const auth = await OAUTH_SESSIONS.get(authId, 'json');
    if (!auth) return new Response('Not Found', { status: 404 });

    if (auth.machineId !== machineId) {
      return new Response('Forbidden', { status: 403 });
    }

    // 删除授权会话及相关索引
    await OAUTH_SESSIONS.delete(authId);
    await OAUTH_SESSIONS.delete(`machine:${machineId}:${authId}`);
    return new Response(null, { status: 200 });
  }

  // 如果路径不匹配，返回 null 让主流程继续
  return null;
}
