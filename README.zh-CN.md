# TYR 前后端源码交付包

源码基线：`codex/marlow-green`，commit `dd4838cae65110f021e5cee8dca00185946b03d0`。本包用于独立部署、演示录屏和自行定制。

## 内容

- `apps/web`：React + Vite 工作台，包含 Chat、Topology、Workspace 3D 场景和 Operator 页面，以及前端所需图片、地图、字体和素材来源说明。
- `apps/server`：API、WebSocket、认证、消息与 thread、Agent 管理、Bridge、Runtime Execution 以及现有集成的服务端代码。
- `packages/contracts`、`packages/db`、`packages/governance`、`packages/safety`：前后端必需的共享协议、SQLite 数据层和策略模块。
- 根目录的 pnpm 配置、锁文件、TypeScript 配置和无凭据的环境变量模板。

未附带本地数据库、消息记录、客户数据、密钥、Git 历史、依赖目录或构建产物；也未附带 daemon、CLI、chat-bridge 和移动端执行器源码或安装包。录屏时要展示真实设备在线状态、Agent runtime 执行或设备操作，需要另外接入兼容的 daemon / 执行器；前后端可独立启动和定制。

## 本地启动

使用 Node.js 22.22.x 和 pnpm 10.21.x。首次安装依赖需要访问 npm registry；`better-sqlite3` 在无可用预编译包时需要本机 C/C++ 编译工具。

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.development.example .env.development
pnpm dev
```

访问 `http://127.0.0.1:5178/`。后台地址为 `http://127.0.0.1:3001`，Vite 已配置 API 与 WebSocket 代理。

空数据库首次开发启动时，原有 seed 会创建本地演示账号：`young@example.local` / `12345678`。该账号只用于本地演示；对外部署前在 Settings 修改密码，或使用 `TYR_BOOTSTRAP_SEED=none` 从空数据库创建自己的账号。前后端源码不包含已连接设备或现成演示消息。

环境文件从压缩包根目录读取，后台读取 `.env.development` / `.env.production`，不读取单独的 `.env`。前端默认使用同源 API；修改前端变量时可在 `apps/web/.env.local` 设置 `VITE_TYR_API_BASE`、`VITE_TYR_REALTIME_PATH` 或 `VITE_BASE_PATH`。

## 构建与单进程启动

```bash
pnpm typecheck
pnpm build
cp .env.production.example .env.production
pnpm start
```

构建后后台同时提供 `apps/web/dist` 静态页面，访问 `http://127.0.0.1:3001/`。生产模板默认禁用演示 seed，复用本地开发初始化的 `tyr-data` 时保留已有账号；如使用空数据目录，可通过本机 `/api/auth/register` 创建账号：

```bash
curl -X POST http://127.0.0.1:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"replace-with-your-password","name":"Demo Owner","serverName":"Demo Workspace"}'
```

请替换示例邮箱和密码。在 `.env.production` 中设置客户自己的 `HOST`、`PORT`、`TYR_SERVER_URL` 和 `TYR_DATA_DIR`；对外提供服务时使用自己的反向代理配置 HTTPS。同源部署可同时代理 HTTP 与 WebSocket。

SQLite 文件、上传附件和共享文件会写入 `TYR_DATA_DIR`。选择新目录即可使用独立数据，不连接现有正式实例。生产模板中的模型、邮件、Telegram 和策略模型调用开关默认关闭；需要这些能力时，在环境文件填写客户自己的凭据并开启对应开关。

## 定制入口

- 工作台布局与 3D 场景：`apps/web/src/app/`。
- 工作台样式：`apps/web/src/styles/`。
- 城市、办公室模型和地图：`apps/web/src/map/`、`apps/web/public/maps/`。
- Chat 与 thread 页面：`apps/web/src/pages/chat/`。
- 后台接口：`apps/server/src/routes/`。
- 数据模型与初始化：`packages/db/src/index.ts`。
- 前后端协议和类型：`packages/contracts/src/`。

源码保留当前分支的产品边界；历史群聊与 Task 存储兼容不代表提供群聊或 Task Board 工作流。第三方图片、字体、地图和参考模型的来源说明随素材保留。
