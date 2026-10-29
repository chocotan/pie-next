# Durable Workbench

基于 `@earendil-works/pi-durable` 的本地持久化 Agent 工作台。UI 组件与 CSS 直接复制并适配 DeepSeek Harness（DSH），但不使用 DeepSeek 品牌；插件装配参考 DSH Cordis 与 pi-durable Extension/Registry，不运行第二套 Agent 内核。

## 功能

- 真实模型消息与工具轨迹：Chat、Trajectory、流式回答、发送/生成 Loading、持久消息队列、用量与失败状态。
- 后台 Shell：内置 `bg_run` / `bg_status` / `bg_logs` / `bg_kill`，支持输出查看、停止与状态恢复；重启后运行中任务标记 interrupted，不自动重放。
- SQLite 持久会话与恢复：Entry、Task、Submission、Document 在进程重启后恢复。
- 任务管理：内置 `TaskCreate` / `TaskList` / `TaskGet` / `TaskUpdate`，支持状态、负责人和依赖；`app.todos` rewindable Document 支持回溯，人工侧栏只读。
- Subagent：同一子 Conversation 复用实现多轮对话，`send` 继续原线程，`result` / `list` 可查轮次与最近回答；独立会话、后台运行、Steer/停止和结果去重。
- 上下文与 Skills：读取全局（`~/.agents`、`~/.pie`）与项目祖先目录的 `AGENTS.md`，并把 `SKILL.md` 目录（名称/描述/路径）注入 System Prompt，模型按需用 read 加载全文。
- 权限：默认“允许全部”，可切换“执行前审批”；审批模式下 unsafe 工具中断后不自动重放，也不会保留可操作的假审批。
- Compact 与 Retry：Durable 原生自动重试、阈值/溢出压缩；Compact 独立插件可配置专用模型，失败回退会话模型。
- Provider：添加、编辑、启停 OpenAI/Anthropic 兼容端点，同步后勾选模型再添加，运行时热更新，密钥仅写不读。
- 模型与 Thinking Level 按会话选择；权限、模型、思考级别、主题和工作区统一使用键盘可导航菜单。
- 工作区：按绝对路径添加与切换，分别保存会话；删除只移除列表项（目录与数据保留），至少保留一个工作区。
- 会话删除：停止该会话及其后台任务后从列表移除；本地历史仍保留在 SQLite 中。
- 本地安全：单工作区进程锁、回环监听、访问令牌、HttpOnly Cookie、WebSocket Origin 校验。
- 普通会话默认展示（内部 Root 隐藏）、顶部子代理菜单、只读任务/子代理/后台任务侧栏、可搜索 Trajectory、Provider 弹层、内置插件管理及明暗主题。

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
- `plugins.json`：五个内置插件的启停状态，权限 `0600`。
- `runtime.json`：Retry、自动 Compact 与 Compact 模型，权限 `0600`。

工作区列表另存于 `~/.durable-workbench/workspaces.json`，可用 `DURABLE_WORKSPACES_FILE` 覆盖。

首次启动会导入 `~/.pie/models.json` 的 Provider 和模型元数据。密钥只保存在服务端，不进入浏览器 DTO、源码或日志。`DURABLE_WORKSPACE_DATA` 可覆盖测试数据目录。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

测试覆盖 AI 任务依赖与回溯、Provider 脱敏/模型发现/运行时同步、Thinking Level、插件配置与真实 Host 重载、Retry/Compact 配置、AGENTS.md 与 skills 发现、消息队列、工作区生命周期、权限终态，以及真实 Shell 后台执行、输出截断和停止。

已执行真实验收：

- `deepseek-v4.1-flash` 消息与用量写入 SQLite。
- 模型发起 Bash → 审批挂起 → 人工批准 → 真实执行与结果展示。
- 后台 Subagent 创建、独立会话、结果回报、强杀恢复且无重复回报。
- 只读任务展示、插件停用/恢复、Retry 保存、Provider 添加/启停/密钥轮换/同步后勾选模型、真实 Trajectory、暗色与移动端截图评审。
- 真实 Host 读取 `~/.agents/skills`（7 个 skills）并在设置中展示“上下文与 Skills”插件；`context.list` 返回发现结果。
- 发送 Loading、Follow-up 排队与自动消耗、后台 Shell 输出/完成/停止。
- 搜索返回、Thinking Level 持久化、工作区添加/切回与订阅隔离。
- 会话删除、工作区添加/切换/删除、工作区展开图标与删除按钮。

## 结构

```text
server/
  host.ts                 # 工作区锁、SQLite Harness、恢复与公开 Document
  rpc.ts                  # 认证 HTTP command + WS snapshot/delta
  plugin-runtime.ts       # Host 插件注册、命令与公开 Document 网关
  providers.ts            # Provider 配置、密钥和 pi-ai 模型同步
  plugins/
    conversation.ts       # 输入、停止、配置、历史与手动 Compact 命令
    providers.ts          # Provider 查询、保存与启停
    approval.ts           # Tool Wrapper、审批决定与中断恢复
    subagent.ts           # 多轮子 Conversation、Anchor/Reporter 与结果回流
    background.ts         # bg_run/status/logs/kill 与进程恢复
    todo.ts               # TaskCreate/List/Get/Update、Document 与依赖校验
    compaction.ts         # Compact 模型 Hook 与默认模型回退
    context.ts            # AGENTS.md 与 skills 发现、System Prompt 注入
  plugin-config.ts        # 内置插件元数据、启停与持久化
  runtime-settings.ts     # Retry 与 Compact 运行策略
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
    providers/            # Provider 编辑、模型同步与勾选添加
    plugins/              # 内置插件卡片、Retry 与 Compact 设置
    settings/             # DSH 设置面板
    session/              # Durable Client model 与 DTO 映射
  vendor/dsh/             # 按需复制的 DSH primitives、Slots、Store 和许可
```

## 当前边界

- 面向单用户、单活动工作区、单 Host；可添加多个工作区并切换，但不用于公网、多租户或多写者部署。切换会停止当前 Host 的后台任务，历史仍分别保存。
- 所有插件是受信任的本地代码，不是隔离沙箱。默认“允许全部”会让模型直接执行工具；工具在工作区以当前 OS 用户权限执行，需要逐次确认时请切换“执行前审批”。
- `pi-durable@1.4.0` 为 Experimental，已按实际发布包 API 实现；升级前需重跑恢复测试。
- 流式回答和工具进度使用 deferred commit，崩溃时可能丢失默认约 1 秒尾部进度；业务输入、Todo 与审批使用即时提交。
- unsafe 工具与后台 Shell 恢复显示 interrupted，不猜测外部副作用是否发生，也不自动重放。Shell 与文件工具不宣称 exactly-once。
- 当前未实现自动 Worktree、插件市场、远程插件沙箱、Child Ask、多工作区并行 Host 和公网认证。
- Skills 发现不读取 pi 的自定义 `skills` 配置目录与 `.gitignore`；AGENTS.md 在 Host 打开时读取，修改后需重载工作区（或重启）。

## 设计与许可

- [`DESIGN.md`](DESIGN.md)：运行时与持久化设计。
- [`docs/ui-architecture.md`](docs/ui-architecture.md)：DSH 风格 UI 分层。
- [`docs/plugin-architecture.md`](docs/plugin-architecture.md)：Host 与 Browser 插件装配。

DeepSeek Harness 源码为 MIT，复制内容保留于 `src/vendor/dsh/`。对应版权、MIT License、第三方说明和 Montserrat 字体许可随源码保留。界面复用 DSH 组件但使用独立品牌；本项目是独立的 Durable 适配，不暗示 DeepSeek 官方背书。
