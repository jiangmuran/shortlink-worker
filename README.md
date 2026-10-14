# ShortLink

一个跑在 Cloudflare Workers 上的自托管短链接服务。一个 Worker 包含了管理控制台、REST API、跳转页和定时清理，数据存在 D1。没有运行时依赖，前端也不需要构建。

免费套餐就能跑：Workers 每天 10 万次请求、D1 5 GB 存储，个人和小团队足够用。

![概览](docs/screenshots/dashboard.png)

## 功能

**短链**
- 自定义后缀，或自动生成 4–10 位随机后缀（避开 `0/O`、`1/l` 这类易混字符）
- 支持备注、过期时间、启用/停用；目标、后缀、域名创建后都能改
- 三种跳转方式：直接 302、动画中转页（4 种动画，可设时长/标题/文案/颜色）、确认页（访客确认目的地后再跳）

**多域名**
- 一个 Worker 绑定任意多个域名，分为「管理域名」（打开控制台）和「短链域名」（生成链接）
- 每个域名可以设置自己的默认跳转方式

**访问统计**
- 每次访问记录时间、IP、国家/城市、浏览器、系统、来源页
- 概览页有 14 日趋势、热门短链和实时访问；单条短链的记录可分页查看、导出 CSV

**账户与权限**
- 用户名密码登录，也支持通行密钥（Passkey：指纹 / Face ID / 硬件钥匙）
- 多用户：可限定每个人能用哪些域名、能否建短链/看统计/用 API，以及短链数量上限
- 会话列表，可一键注销其他设备

**API**
- API 密钥按权限范围（scope）授权，可设有效期，服务端只存哈希
- `/api/v1` REST 接口，开启 CORS，控制台内置中文文档页 `/docs`

**维护**
- Cron 每小时清理过期会话、超期访问记录和过期短链，保留天数可在设置里调整

**界面**
- 明暗两套主题，跟随系统也可手动切换
- 桌面端侧边栏，手机端抽屉菜单和底部弹层

<table>
  <tr>
    <td width="68%"><img src="docs/screenshots/links.png" alt="短链列表"></td>
    <td><img src="docs/screenshots/mobile.png" alt="手机端"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/new-link.png" alt="新建短链"></td>
    <td><img src="docs/screenshots/login.png" alt="登录"></td>
  </tr>
</table>

<details>
<summary>深色模式</summary>

![深色模式](docs/screenshots/dashboard-dark.png)
</details>

## 部署

需要：Node.js 18+，一个 Cloudflare 账号，以及至少一个已经接入该账号的域名。

### 1. 获取代码并登录

```bash
git clone https://github.com/jiangmuran/shortlink-worker.git
cd shortlink-worker
npm install
npx wrangler login
```

### 2. 创建数据库

```bash
npx wrangler d1 create shortlink
```

把输出里的 `database_id` 填进 `wrangler.jsonc`，替换 `<YOUR_D1_DATABASE_ID>`。

### 3. 建表并部署

```bash
npm run db:migrate    # 在远程 D1 上执行 migrations/
npm run deploy
```

### 4. 绑定域名

两种方式任选一种：

- 在 `wrangler.jsonc` 里取消 `routes` 的注释，填上自己的域名，再执行一次 `npm run deploy`
- 或者在 Cloudflare Dashboard 打开这个 Worker → **设置 → 域名和路由 → 添加 → 自定义域**

至少需要两个（子）域名，一个域名只能承担其中一种用途：

| 用途 | 示例 | 说明 |
| --- | --- | --- |
| 管理域名 | `sl.example.com` | 打开控制台 |
| 短链域名 | `s.example.com` | 生成出来的短链用这个，可以有多个 |

指向这个 Worker、但还没在控制台登记的域名会显示控制台；登记为短链域名之后才开始处理跳转。

### 5. 初始化

浏览器打开管理域名，按引导设置站点名和管理员账户。当前访问的域名会自动登记为管理域名，然后在「域名」页面添加短链域名就可以开始用了。

> 通行密钥和注册时所在的域名绑定，换了管理域名需要重新添加。

### 更新

```bash
git pull
npm run db:migrate    # 有新迁移时才会执行
npm run deploy
```

## 本地开发

```bash
cp .dev.vars.example .dev.vars   # DEV_MODE=true：本地不强制 HTTPS
npm run db:migrate:local
npm run dev                      # http://localhost:8787
```

`npm run dev` 带了 `--test-scheduled`，访问 `http://localhost:8787/__scheduled` 可手动触发清理任务。

本地测试时用 `localhost`，不要用 `127.0.0.1`：会话 Cookie 带 `Secure`，浏览器和 curl 只在 `localhost` 上会接受。

## API

在控制台「API 密钥」页面创建密钥，然后：

```bash
KEY=sk_xxxxxxxx

# 创建短链（code 留空则随机生成）
curl -X POST https://sl.example.com/api/v1/links \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/some/long/path", "domain": "s.example.com", "code": "demo"}'

# 列出短链
curl https://sl.example.com/api/v1/links -H "Authorization: Bearer $KEY"
```

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/api/v1/me` | 任意 |
| `GET` | `/api/v1/domains` | `domains:read` |
| `GET` | `/api/v1/links` | `links:read` |
| `POST` | `/api/v1/links` | `links:write` |
| `GET` | `/api/v1/links/:id` | `links:read` |
| `PATCH` | `/api/v1/links/:id` | `links:write` |
| `DELETE` | `/api/v1/links/:id` | `links:write` |
| `GET` | `/api/v1/links/:id/stats` | `logs:read` |

参数和返回格式见部署后的 `/docs` 页面。

## 项目结构

```
├── wrangler.jsonc        Worker 配置（静态资源 / D1 / Cron）
├── migrations/           D1 建表语句
├── src/
│   ├── index.js          入口：按域名分流到控制台或短链跳转，分发 API
│   ├── router.js         路径路由
│   ├── auth.js           会话、API 密钥、权限模型
│   ├── crypto.js         PBKDF2 密码哈希、HMAC 签名
│   ├── webauthn.js       CBOR 解码，WebAuthn 注册与断言验签
│   ├── api-auth.js       /api/setup  /api/auth  /api/me
│   ├── api-main.js       /api/links  /api/domains  /api/logs  /api/stats
│   ├── api-admin.js      /api/users  /api/keys  /api/settings
│   ├── api-v1.js         /api/v1 公共 API（密钥认证 + CORS）
│   ├── redirect.js       短链域名的请求处理与访问记录
│   ├── pages.js          中转页、确认页、错误页
│   └── cleanup.js        定时清理
└── public/               控制台前端（原生 JS，无构建）
```

## 安全

- 密码：PBKDF2-SHA256，10 万轮，加盐
- 通行密钥：公钥存在 D1，用 WebCrypto 验证 ES256 / RS256 签名，自己实现、不依赖第三方库
- 会话：Cookie 为 `HttpOnly` + `Secure` + `SameSite=Lax`，会话记录在服务端，可随时吊销；改密码或改权限时自动清理相关会话
- 写操作校验 `Origin`，防止跨站请求
- API 密钥只存 SHA-256 摘要，明文只在创建时显示一次
- 短链目标只允许 `http` / `https`，页面输出全部做 HTML 转义

发现安全问题请通过 GitHub 私下报告（Security → Report a vulnerability），不要直接开公开 issue。

## 许可

[MIT](LICENSE)
