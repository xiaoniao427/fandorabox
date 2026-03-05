// auth-page.js
export function renderAuthConfirmPage() {
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>扫码登录确认</title>
    <style>
        body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        .info { margin: 20px 0; }
        .info p { margin: 8px 0; }
        .btn { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 16px; }
        .btn:hover { background: #0056b3; }
        .error { color: red; }
        .success { color: green; }
    </style>
</head>
<body>
    <div class="card">
        <h1>机台登录确认</h1>
        <div id="loading">加载中...</div>
        <div id="info" style="display:none;" class="info">
            <p><strong>机台名称：</strong> <span id="name"></span></p>
            <p><strong>描述：</strong> <span id="description"></span></p>
            <p><strong>地点：</strong> <span id="place"></span></p>
            <p><strong>IP地址：</strong> <span id="ip"></span></p>
        </div>
        <div id="error" class="error" style="display:none;"></div>
        <div id="success" class="success" style="display:none;">授权成功！</div>
        <button id="confirmBtn" class="btn" style="display:none;">确认登录</button>
        <div id="already" style="display:none;">此授权会话已完成。</div>
    </div>
    <script>
        (function() {
            const urlParams = new URLSearchParams(window.location.search);
            const authId = urlParams.get('auth-id');
            if (!authId) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').innerText = '缺少 auth-id 参数';
                return;
            }

            fetch('/api/machine/auth/info?auth-id=' + encodeURIComponent(authId))
                .then(res => {
                    if (res.status === 404) throw new Error('授权会话不存在');
                    if (!res.ok) throw new Error('获取信息失败');
                    return res.json();
                })
                .then(data => {
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('info').style.display = 'block';
                    document.getElementById('name').innerText = data.granteeInfo.name;
                    document.getElementById('description').innerText = data.granteeInfo.description;
                    document.getElementById('place').innerText = data.granteeInfo.place;
                    document.getElementById('ip').innerText = data.granteeInfo.remoteIP;
                    document.getElementById('confirmBtn').style.display = 'block';
                })
                .catch(err => {
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('error').style.display = 'block';
                    document.getElementById('error').innerText = err.message;
                });

            document.getElementById('confirmBtn').addEventListener('click', function() {
                this.disabled = true;
                this.innerText = '处理中...';
                fetch('/api/machine/auth/permit?auth-id=' + encodeURIComponent(authId), {
                    method: 'POST'
                })
                .then(res => {
                    if (res.status === 200) {
                        document.getElementById('info').style.display = 'none';
                        this.style.display = 'none';
                        document.getElementById('success').style.display = 'block';
                    } else if (res.status === 204) {
                        document.getElementById('info').style.display = 'none';
                        this.style.display = 'none';
                        document.getElementById('already').style.display = 'block';
                    } else if (res.status === 401) {
                        window.location.href = '/login?auth-id=' + encodeURIComponent(authId);
                    } else {
                        throw new Error('确认失败');
                    }
                })
                .catch(err => {
                    this.disabled = false;
                    this.innerText = '确认登录';
                    document.getElementById('error').style.display = 'block';
                    document.getElementById('error').innerText = err.message;
                });
            });
        })();
    </script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

export function renderLoginPage() {
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <title>登录</title>
    <script src="https://cdn.jsdelivr.net/npm/blueimp-md5@2.19.0/js/md5.min.js"></script>
    <style>
        body { font-family: sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        input { width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box; }
        button { background: #007bff; color: white; border: none; padding: 10px; width: 100%; border-radius: 4px; cursor: pointer; }
        .error { color: red; margin-top: 10px; }
    </style>
</head>
<body>
    <div class="card">
        <h2>登录 Majdata</h2>
        <input type="text" id="username" placeholder="用户名" />
        <input type="password" id="password" placeholder="密码" />
        <button id="loginBtn">登录</button>
        <div id="error" class="error"></div>
    </div>
    <script>
        document.getElementById('loginBtn').addEventListener('click', function() {
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;
            if (!username) {
                document.getElementById('error').innerText = '请输入用户名';
                return;
            }
            // 对密码进行 MD5 加密（与 MajdataPlay 客户端行为一致）
            const hashedPassword = md5(password);
            fetch('/api/account/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password: hashedPassword })
            })
            .then(res => {
                if (res.ok) {
                    const urlParams = new URLSearchParams(window.location.search);
                    const authId = urlParams.get('auth-id');
                    if (authId) {
                        window.location.href = '/auth/confirm?auth-id=' + encodeURIComponent(authId);
                    } else {
                        window.location.href = '/';
                    }
                } else {
                    return res.text().then(text => { throw new Error(text || '登录失败'); });
                }
            })
            .catch(err => {
                document.getElementById('error').innerText = err.message;
            });
        });
    </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}
