# Durable Workbench

基于 `@earendil-works/pi-durable` 的本地持久化 Agent 工作台。UI 组件与 CSS 直接复制并适配 DeepSeek Harness（DSH）；插件装配参考 DSH Cordis 与 pi-durable Extension/Registry，不运行第二套 Agent 内核。

## 功能

- 真实模型消息与工具轨迹：Chat、Trajectory、流式回答、用量与失败状态。
- SQLite 持久会话与恢复：Entry、Task、Submission、Document 在进程重启后恢复。
- Todo：`app.todos` rewindable Document，支持人工编辑、模型更新和 Fork 点回溯。
- Subagent：官方 Anchor + Reporter 模式，后台运行、独立会话、Steer/停止和结果去重。
- 审批：Bash/write/edit 调用需人工批准；unsafe 工具中断后不自动重放，也不会保留可操作的假审批。
- Provider：添加、编辑、启停 OpenAI/Anthropic 兼容端点与模型，运行时热更新，密钥仅写不读。
- 本地安全：单工作区进程锁、回环监听、访问令牌、HttpOnly Cookie、WebSocket Origin 校验。
- DSH 原始 AppFrame、Conversation、Tool、Approval、Dockkit、Trajectory、Provider 设置及明暗主题。

## 启动

要求 Node.js 22.19+（当前使用 Node 24）与 npm。

```bash
npm install
npm run dev
```

开发模式同时启动：

- Vite：`http://127.0.0.1:5173`
- Durable Host：`http://127.0.0.1:4174`

Host 输出包含一次性访问 token 的 URL，请使用完整 URL 打开页面。`DURABLE_AUTH_TOKEN` 可在本地自动化中固定 token。

生产模式：

```bash
npm start
```

生产 Host 直接提供 `dist` 页面，默认地址 `http://127.0.0.1:4174`。

指定工作区：

```bash
npx tsx server/index.ts /absolute/path/to/workspace
```

每个工作区的数据默认位于 `~/.durable-workbench/<workspace-hash>/`：

- `session.sqlite`：会话与任务状态。
- `providers.json`：Provider 与凭据，权限 `0600`。

首次启动会导入 `~/.pie/models.json` 的 Provider 和模型元数据。密钥只保存在服务端，不进入浏览器 DTO、源码或日志。`DURABLE_WORKSPACE_DATA` 可覆盖测试数据目录。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

测试覆盖 Todo 原子更新与回溯、Provider 脱敏/运行时模型同步、审批中断终态。

已执行真实验收：

- `deepseek-v4.1-flash` 消息与用量写入 SQLite。
- 模型发起 Bash → 审批挂起 → 人工批准 → 真实执行与结果展示。
- 后台 Subagent 创建、独立会话、结果回报、强杀恢复且无重复回报。
- Todo 勾选、Provider 添加/启停/密钥轮换、真实 Trajectory、暗色与移动端截图评审。

## 结构

```text
server/
  host.ts                 # 工作区锁、SQLite Harness、恢复与公开 Document
  rpc.ts                  # 认证 HTTP command + WS snapshot/delta
  plugin-runtime.ts       # Host 插件注册、命令与公开 Document 网关
  providers.ts            # Provider 配置、密钥和 pi-ai 模型同步
  plugins/
    conversation.ts       # 输入、停止、配置、历史与 Todo 命令
    providers.ts          # Provider 查询、保存与启停
    approval.ts           # Tool Wrapper、审批决定与中断恢复
    subagent.ts           # Anchor/Reporter 后台子 Agent
    todo.ts               # Todo 工具、Document、Receipt 与 Prompt Section
src/
  App.tsx                 # 组合根，不是业务插件实现集合
  modules/
    layout/               # DSH AppFrame 源码与 CSS
    sidebar/              # DSH SidebarRoot 源码与 CSS
    conversation/         # Conversation shell 与 Composer
    chat/                 # Chat、Markdown、Tool Disclosure
    trajectory/           # 真实 Entry 轨迹
    todo/                 # DSH TodoPanel
    approval/             # DSH ApprovalCard
    inspector/            # Dockkit Inspector
    providers/            # Provider 列表、编辑与 write-only API Key
    settings/             # DSH 设置面板
    session/              # Durable Client model 与 DTO 映射
  vendor/dsh/             # 按需复制的 DSH primitives、Slots、Store 和许可
```

## 当前边界

- 面向单用户、单工作区、单 Host；不用于公网、多租户或多写者部署。
- 所有插件是受信任的本地代码，不是隔离沙箱。工具在工作区以当前 OS 用户权限执行。
- `pi-durable@1.4.0` 为 Experimental，已按实际发布包 API 实现；升级前需重跑恢复测试。
- 流式回答和工具进度使用 deferred commit，崩溃时可能丢失默认约 1 秒尾部进度；业务输入、Todo 与审批使用即时提交。
- unsafe 工具恢复显示 interrupted，不猜测外部副作用是否发生。Shell 与文件工具不宣称 exactly-once。
- 当前未实现自动 Worktree、插件市场、远程插件沙箱、Child Ask、多工作区启动器和公网认证。

## 设计与许可

- [`DESIGN.md`](DESIGN.md)：运行时与持久化设计。
- [`docs/ui-architecture.md`](docs/ui-architecture.md)：DSH 风格 UI 分层。
- [`docs/plugin-architecture.md`](docs/plugin-architecture.md)：Host 与 Browser 插件装配。

DeepSeek Harness 源码为 MIT，复制内容保留于 `src/vendor/dsh/`。对应版权、MIT License、第三方说明和 Montserrat 字体许可随源码保留。界面使用 DSH 官方品牌组件；本项目是独立的 Durable 适配，不暗示 DeepSeek 官方背书。
