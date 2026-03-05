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

            // 获取机台信息
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

            // 确认按钮点击
            document.getElementById('confirmBtn').addEventListener('click', function() {
                this.disabled = true;
                this.innerText = '处理中...';
                fetch('/api/machine/auth/permit?auth-id=' + encodeURIComponent(authId), {
                    method: 'POST'
                })
                .then(res => {
                    if (res.status === 200) {
                        // 成功
                        document.getElementById('info').style.display = 'none';
                        this.style.display = 'none';
                        document.getElementById('success').style.display = 'block';
                    } else if (res.status === 204) {
                        // 已处理
                        document.getElementById('info').style.display = 'none';
                        this.style.display = 'none';
                        document.getElementById('already').style.display = 'block';
                    } else if (res.status === 401) {
                        throw new Error('未登录，请先登录');
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
// auth-page.js
return new Response(html, {
  headers: {
    'Content-Type': 'text/html;charset=UTF-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none';"
  }
  });
}
