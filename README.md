# MajdataPlay 反向代理 Worker

这是一个为 Majdata.net 设计的 Cloudflare Workers 反向代理项目，提供了多种增强功能，包括广告插入、公告自定义、离线模拟、数据缓存与同步等。通过此 Worker，您可以在代理原站内容的同时，灵活控制特定接口的行为，并在原站离线时维持基本服务能力。

> 其实本来是给 FandoraBOX 写的，后来发现只要 API 接口支持 MajdataPlay 就能用。

---

## TODO
- [x] 支持扫码登录接口
（以后TODO放is）

---

## 功能特性

- **反向代理**  
  将您的代理域名（如 `fandorabox.tzhd427.dpdns.org`）的请求透明转发至目标网站（通过环境变量 `ORIGIN_HOST` 配置），并自动处理跨域、Cookie 域限制、重定向域名替换等。

- **广告插入**  
  在代理的 HTML 页面中，于 `<main>` 元素后自动插入指定的 Google AdSense 广告代码（代码在 `ads.js` 中，可自定义）。

- **自定义公告**  
  拦截 `/api/notice` 请求，直接返回您指定的公告 JSON（内容在 `notice-modifier.js` 中定义），不再依赖原站内容。

- **离线模拟模式**  
  通过环境变量 `OFFLINE_MODE` 控制，当设为 `true` 时，模拟原站离线状态，对特定 API 返回预设响应，并利用 KV 存储用户会话、暂存成绩，待原站恢复后自动同步。

- **API 数据暂存**  
  对 `/api/maichart/list.all` 使用 GitHub工作流 同步文件，每日尝试更新一次。当源站离线时，自动返回最后一次成功获取的缓存数据。

- **根页面缓存**  
  对根路径 `/` 进行每日缓存（使用 Cache API），提升访问速度。

- **手动数据同步**  
  通过 `/api/manual-sync?password=你的密码` 可随时触发暂存成绩的上传（需配置 `SYNC_PASSWORD` 环境变量）。

- **定时自动同步**  
  每30分钟自动尝试上传暂存的成绩（通过 Cron 触发器）。

- **Cookie 处理**  
  移除 `Set-Cookie` 中的 `Domain` 属性，使其能在代理域名下正常使用。

- **重定向重写**  
  将原站返回的 `Location` 头中的域名替换为代理域名，确保跳转仍通过 Worker。

- **安全头部处理**  
  自动移除响应中的 `Content-Security-Policy` 头，添加 `Access-Control-Allow-Origin: *`。

- **广告验证文件**  
  `/ads.txt` 返回指定的广告验证文本（可自定义）。

---

## 部署前准备

1. **Cloudflare 账户** 并已启用 Workers。
2. **创建三个 KV 命名空间**：
   - `USER_DATA`：存储离线登录时的用户加密密码。
   - `SESSIONS`：存储离线会话映射。
   - `PENDING_SCORES`：暂存用户上传的成绩。
3. **准备您的广告代码**（可选）：修改 `ads.js` 中的 `AD_CODE` 常量。
4. **准备自定义公告内容**（可选）：修改 `notice-modifier.js` 中的 `CUSTOM_NOTICE_CONTENT` 变量。
5. **设置原站地址**：确定要代理的目标网站（例如 `https://fandorabox.net`）。
6. **设置同步密码**：准备一个强密码用于手动同步接口。（不要傻傻的直接把密码写在GitHub仓库里）

---

## 配置说明

### 环境变量（通过 `wrangler.toml` 或 Dashboard 设置）

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `ORIGIN_HOST` | string | 目标网站地址，例如 `https://fandorabox.net`（**必填**） |
| `OFFLINE_MODE` | string | 设为 `"true"` 启用离线模拟模式，否则正常代理（默认为 `false`） |
| `SYNC_PASSWORD` | string | 手动同步接口的密码，必须设置否则手动同步无法使用 |

### KV 命名空间绑定

在 `wrangler.toml` 中添加：

```toml
[[kv_namespaces]]
binding = "USER_DATA"
id = "your_user_data_kv_id"

[[kv_namespaces]]
binding = "SESSIONS"
id = "your_sessions_kv_id"

[[kv_namespaces]]
binding = "PENDING_SCORES"
id = "your_pending_scores_kv_id"
```

### 定时触发器（用于自动同步）

```toml
[triggers]
crons = ["*/30 * * * *"]   # 每30分钟触发一次同步
```

---

## 文件结构
```
.
├── worker.js              # 主程序入口
├── ads.js                 # 广告代码模块
├── notice-modifier.js     # 公告替换模块
├── custom-handlers.js     # 铺面列表处理模块（从 songs-data.js 导入数据）
├── offline-handler.js     # 离线模拟与成绩上传模块
├── songs-data.js          # 铺面列表静态数据（由 GitHub Actions 自动更新）
├── .github/workflows/update-songs.yml  # GitHub Actions 自动更新工作流
└── README.md              # 本文档
```


---

## 部署步骤

### 方式一：使用 Wrangler CLI

1. 安装并登录 Wrangler：
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. 在项目目录下创建 `wrangler.toml`，参考上方配置填写 KV 命名空间 ID 和环境变量。

3. 发布 Worker：
   ```bash
   wrangler deploy
   ```

### 方式二：通过 Cloudflare Dashboard 手动上传

1. 在 Workers 页面创建新 Worker，选择“快速编辑”。
2. 将各模块代码分别以“附加模块”形式上传（`worker.js` 为主模块）。
3. 在“设置”中添加 KV 命名空间绑定和环境变量。
4. 部署。

### `wrangler.toml` 配置示例

```toml
name = "majdata-proxy"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "USER_DATA"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

[[kv_namespaces]]
binding = "SESSIONS"
id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"

[[kv_namespaces]]
binding = "PENDING_SCORES"
id = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"

[vars]
ORIGIN_HOST = "https://fandorabox.net"
OFFLINE_MODE = "false"
SYNC_PASSWORD = "your-secure-password"

[triggers]
crons = ["*/30 * * * *"]
```

---

## 使用方法

### 正常代理模式
- 设置 `OFFLINE_MODE = "false"`。
- 访问您的代理域名（如 `https://fandorabox.tzhd427.dpdns.org`）即可浏览原站内容，页面底部将显示广告。
- 公告将显示您在 `notice-modifier.js` 中定义的内容。
- 曲目列表接口 `/api/maichart/list.all` 每日更新一次，源站离线时返回缓存。
- 根路径 `/` 每日更新一次。

### 离线模拟模式
- 设置 `OFFLINE_MODE = "true"`。
- 以下 API 将返回模拟响应，不依赖原站：

| 路径 | 行为 |
|------|------|
| `/api/machine/register` | 返回 404 |
| `/api/account/login` (POST) | 模拟登录，生成会话 Cookie，存储用户凭证 |
| `/api/account/info` | 根据 Cookie 返回用户信息 |
| `/api/account/icon?username=xxx` | 返回固定头像图片 |
| `/api/maichart/*/interact` | 返回 `{"IsLiked":false,"LikeCount":0,"Likes":[]}` |
| `/api/maichart/*/score` (POST) | 暂存成绩至 KV，返回 `{"ok":true}` |
| `/api/account/logout` | 清除会话 Cookie |

- 当原站恢复后，Worker 会通过定时任务（每30分钟）自动登录并上传暂存的成绩（使用原站返回的真实 Cookie）。

### 手动触发同步
```bash
curl "https://your-proxy-domain/api/manual-sync?password=你的密码"
```
成功时返回 `{"success":true,"message":"同步完成"}`。

---

## GitHub Actions 自动更新铺面列表

项目包含一个 GitHub Actions 工作流文件 .github/workflows/update-songs.yml，它会：

- 定时触发：每天 UTC 0:00（北京时间 8:00）运行一次。
- 手动触发：可通过 GitHub 界面手动运行。
- 从原站获取最新数据：请求 ORIGIN_HOST/api/maichart/list.all，保存为 JSON。
- 更新 songs-data.js：将获取的数据写入 songs-data.js 文件中的 SONGS_LIST 常量。
- 提交并推送：如果有变化，自动提交并推送到仓库。
- 触发 Cloudflare 重新部署：由于 Cloudflare 与 GitHub 集成，推送后会自动拉取新代码并部署，使铺面列表保持最新。

### 注意事项

- 确保 GitHub 仓库中已设置 Secrets ORIGIN_HOST（否则使用默认值 https://fandorabox.net）。
- songs-data.js 初始内容应为 export const SONGS_LIST = { "songs": [] };。
- 工作流会完全覆盖 songs-data.js，因此该文件不应包含其他代码。

---

## 注意事项

1. 原站地址配置：必须正确设置 ORIGIN_HOST 环境变量，否则 Worker 无法工作。
2. KV 计费：离线模式会频繁读写 KV，请注意免费层用量限制。
3. 密码安全：SYNC_PASSWORD 请使用强密码，并通过环境变量设置，避免泄露。
4. 健康检查：自动同步和缓存更新通过 HEAD 请求原站首页判断源站在线，请确保原站首页可访问。
5. 广告代码：ads.js 中的广告单元 ID 需替换为您自己的 Google AdSense 代码。
6. 公告文本：notice-modifier.js 中的 CUSTOM_NOTICE_CONTENT 变量可按需修改。
7. 缓存时间：根路径缓存时间默认为 86400 秒（1天），可根据需要调整 worker.js 中的 CACHE_TTL 常量。
8. 域名替换：Worker 会自动将响应内容中的原站域名替换为您的代理域名，确保站内链接正确。
9. 超时限制：如果暂存成绩量很大，手动同步可能超过 Worker 的 CPU 时间限制（免费套餐 10ms，付费套餐 30 秒）。可考虑升级套餐或分批处理。
10. GitHub Actions 权限：工作流需要 contents: write 权限，已在配置中声明，确保仓库设置允许 Actions 创建提交。

---

## 自定义扩展

您可以根据需要修改或添加新的路径处理逻辑：

- 在 `offline-handler.js` 中增加更多模拟接口。
- 在 `custom-handlers.js` 中添加其他 API 的缓存策略。
- 在 `worker.js` 中调整广告插入位置（例如改为 `body` 或特定元素）。

## 贡献代码
如果你想贡献代码，请去dev分支提交，测试无bug后会同步到main。

---

## 许可证

本项目采用 **GNU General Public License v3.0（GPLv3）**。

- **强制开源**：任何分发或派生作品必须提供源代码，且同样以 GPLv3 许可。
- **沿用许可证**：修改后的版本必须继续使用 GPLv3，确保自由传播。
- **允许商业使用**：GPLv3 不禁止商业销售，但要求销售时必须同时提供完整的源代码。
- **禁止附加限制**：不得对软件使用者施加进一步的限制（如专利报复条款）。

完整的许可证文本请参阅项目根目录下的 `LICENSE` 文件或访问 [GNU官网](https://www.gnu.org/licenses/gpl-3.0.html)。
