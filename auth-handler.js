// auth-handler.js
// 处理所有与扫码登录相关的API请求

// 工具函数：生成随机ID
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2)}`;
}

/**
 * 处理扫码登录相关的API请求
 * @param {Request} request - 原始请求对象
 * @param {Object} bindings - 包含 KV 绑定的对象（MACHINE_SESSIONS, OAUTH_SESSIONS）
 * @param {string} frontendHost - 前端主机地址，用于生成二维码跳转URL
 * @returns {Promise<Response|null>} 如果路径匹配则返回响应，否则返回 null
 */
export async function handleAuthRequest(request, bindings, frontendHost) {
  const { MACHINE_SESSIONS, OAUTH_SESSIONS } = bindings;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // ========== 新 API：机器注册 (POST /api/machine/register) ==========
  if (path === '/api/machine/register' && method === 'POST') {
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
  if (path === '/api/oauth/register' && method === 'GET') {
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
  const oauthMatch = path.match(/^\/api\/oauth\/([^\/]+)\/token$/);
  if (oauthMatch && method === 'GET') {
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
      // 已授权，返回用户 token（这里模拟生成一个用户token，实际可与现有 SESSIONS 集成）
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
  if (path === '/api/account/MachineInfo' && method === 'GET') {
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
  if (path === '/api/account/MachineLoginPermit' && method === 'GET') {
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
  if (path === '/api/account/MachineRegister' && method === 'GET') {
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
    const qrContent = `${frontendHost}/confirm?machine-id-token=${guid}`;
    return new Response(JSON.stringify({ MachineID: guid, QRContent: qrContent }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // GET /api/account/MachineLoginCheck?MachineID=GUID
  if (path === '/api/account/MachineLoginCheck' && method === 'GET') {
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

  // 如果路径不匹配，返回 null 让主流程继续
  return null;
}
