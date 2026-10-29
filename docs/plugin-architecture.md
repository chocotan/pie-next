# 全栈插件架构

> 与 `docs/ui-architecture.md` 配套。目标是参考 DeepSeek Harness 的 Cordis 与 pi/pi-durable 的 Extension 模型，让业务功能在 Host 和 Browser 都以插件交付，而不是让 Shell 认识所有功能。

## 1. 原则

1. **一切皆插件不等于没有内核。** pi-durable 是持久化内核；应用只保留 composition、协议和基础设施接口，所有产品能力经注册接入。
2. **双端同manifest、各自实现。** Host 代码不能在浏览器执行，Browser component 不能进入 Node。共享的是插件声明、wire schema 和版本，不共享运行环境。
3. **两个注册系统各做擅长的事。** Cordis 负责 service dependency、event 与可逆生命周期；pi-durable Registry 负责工具、Prompt Section、Hook、Wrapper、Task 的 Agent 解析与恢复。
4. **功能不通过跨包运行时 import 组合。** Host 用 Cordis service/event + Durable Extension；Browser 用 Cordis service + Slots。只有 `import type` 可以跨功能包。
5. **插件是受信任代码。** 默认同进程、同 OS 权限；插件化不是安全沙箱。不可信插件不在 V1 范围内。
6. **先可逆注册，后热更新。** V1 静态 roster + 启动加载；所有注册都有 disposer，但不在没有协议版本与资源回收保证时宣称全栈 HMR。

## 2. 插件包形态

```text
@durable-workbench/plugin-todo/
├── package.json               # manifest 唯一来源
├── src/
│   ├── host.ts                # Node：Durable Extension、Document、RPC command
│   ├── client.ts              # Browser：Cordis service、Definition、Slot registration
│   ├── components/            # 纯 Presentation；只能由本插件 client entry 安装
│   ├── protocol.ts            # 公开 DTO/schema；双端 import type/安全 schema
│   └── index.ts               # 类型与纯常量出口，不转发双端实现
└── README.md
```

```json
{
  "name": "@durable-workbench/plugin-todo",
  "version": "0.1.0",
  "exports": {
    ".": "./dist/index.js",
    "./host": "./dist/host.js",
    "./client": "./dist/client.js"
  },
  "durableWorkbench": {
    "apiVersion": 1,
    "host": { "export": "./host", "inject": ["durable", "rpc"] },
    "client": {
      "export": "./client",
      "platform": "web",
      "inject": ["slots", "uiConversation", "durableDocuments"]
    }
  }
}
```

```ts
// host.ts：只做 Host contribution，不返回 JSX。
export const inject = ['durable', 'rpc', 'documents'] as const
export function apply(ctx: HostContext): void {
  ctx.effect(() => {
    const disposeDoc = ctx.documents.register('todos', TodoDoc, TodoReceipt)
    const disposeRpc = ctx.rpc.register('todo.update', TodoUpdateSchema, updateTodos)
    ctx.durable.install(TodoExtension) // effect 撤销时 uninstall 同一 token
    return () => { disposeRpc(); disposeDoc() }
  }, 'plugin-todo: host')
}

// client.ts：不 import host.ts，也不 import其他功能包的 component。
export const inject = ['slots', 'uiConversation', 'durableDocuments'] as const
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'todo', order: 0 },
    TodoDock,
  ))
  ctx.uiConversation.events.register(todoDefinition)
}
```

`apply` 的世界只负责注册。组件不接收 `ctx`，所需数据与 callback 通过标准 hooks 或 entry `inject` 投影。

## 3. Host 插件体系

### 3.1 基础设施服务

| Cordis service | Owner | 插件可用能力 |
| --- | --- | --- |
| `ctx.durable` | `plugin-durable-host` | 安装/卸载 Extension；不公开任意 Storage 写 |
| `ctx.documents` | `plugin-document-gateway` | 注册公开 token/key；产生 watchDoc subscription |
| `ctx.rpc` | `plugin-rpc-host` | 注册带 schema 的 command、取消与错误映射 |
| `ctx.providers` | `plugin-provider-runtime` | redacted catalog、profile/credential 分离操作、模型解析 |
| `ctx.policy` | `plugin-approval` | 高危操作判定、审批请求与决定；默认拒绝未知风险 |
| `ctx.subagents` | `plugin-subagent` | roster、Anchor/Reporter、child command |
| `ctx.hostLifecycle` | `plugin-durable-host` | open/resume/closing/reopen 事件与状态 |

基础设施也是插件，但 `durable`、存储、认证和强制审批策略属于保留能力，普通插件不能替换或卸载。Extension/Document/Task 的注册顺序由 `inject` 依赖表达，不靠数组中偶然的 import 顺序。

### 3.2 Durable Extension 注册

`ctx.durable.install(extension)` 调用真实 `registry.install()`，effect disposal 对同一 Extension token 调 `registry.uninstall()`。安装失败不发布半个插件；同一插件的 RPC、Document 与 UI 注册在同一插件生命周期内回滚。

- Conversation 仍只在 `pi.agent` 中保存 Extension 名称；运行中的 phase 按 pi-durable 原语义保留代码快照。
- 插件卸载不能立即释放仍被运行中工具使用的资源；资源由插件引用计数或 Host 生命周期统一回收。
- 自定义 Task 必须在 `resume()` 前注册，版本变化提供 `migrate`，blocked 状态显示在 UI。
- `pi.*` 保留给内核；插件 kind、entry、task、RPC 均以 `app.<plugin>.*` 命名。

### 3.3 Document 与 RPC Gateway

浏览器不能传任意 Document kind 或执行 Host 方法，只能使用插件公开协议：

- `documents.register(publicKey, token, scopePolicy)` 将稳定 public key 映射到真实 token，Host 校验 conversation scope 后 watchDoc。
- `rpc.register(name, inputSchema, handler)` 是 command 唯一入口；插件自己的 handler 负责参数、资源归属、错误码和 mutation。
- Conversation 内建命令走同一 registry（`session.input`、`session.abort` 等），不另开硬编码旁路。
- Credential command 与普通 Provider profile command 分开，日志 redaction 属于 transport 强制策略。
- Host 不在 Session transaction 中等待插件网络、人类、工具或另一个 Session。

## 4. Browser 插件体系

沿用 DSH：

- `inject` 决定 Cordis service 就绪顺序，manifest module graph 只决定模块可否加载。
- `ctx.effect()`/`ctx.on()`/`ctx.slots.register()` 都返回或关联 disposer；卸载插件同时移除 UI、Definition、subscription 和私有资源。
- `ctx.slots.inject()` 跟随 slot owner 的声明生命周期；插件不能渲染未声明区域。
- `uiConversation.events/views` 注册 Definition，Chat/Trajectory 各自拥有 target 数据。
- `ui-renderer` 等 roster 全部 settled 后一次 mount；插件加载失败显示所属插件与依赖错误，不渲染半套装配。

Browser 插件只能依赖公开 Client service face，例如 `durableDocuments`、`conversationCommands`、`providerCommands`，不能 import Node `host.ts` 或 transport implementation。

## 5. 内置插件 roster

| 插件 | Host contribution | Browser contribution |
| --- | --- | --- |
| `durable-host` | SQLite、Harness、恢复、锁、TaskGraph watch | Host connection state |
| `connection` | HTTP/WS、认证、Origin、stream gateway | generation、fetch、subscription |
| `conversation` | input/abort/continue/config/entries commands | ui-session、ui-conversation、Chat、Composer |
| `trajectory` | 无专属 Host 业务；复用 Entry reads | Trajectory Definition、View、record inspector |
| `layout` | 无 | root AppFrame、responsive drawer、inspector Slots |
| `coding-tools` | read/write/edit/bash、ExecutionEnv | 通用 ToolCall renderer、diff/output/details |
| `todo` | app.todos、receipt、todo tools、Prompt Section、update command | Todo dock、inspector、todo_write renderer |
| `subagent` | roster、Anchor/Reporter、spawn/send/stop/status | tree、lineage、catalog、child scope |
| `approval` | mandatory Tool Wrapper、app.approvals、decision command | approval card、pending interaction、结果反馈 |
| `usage` | pi.usage 聚合 query | usage inspector |
| `settings` | 非敏感 Host preferences | settings overlay/category Slots |
| `providers` | profile catalog、credentials、test connection、pi-ai models | Provider list/editor/model rows/write-only key |
| `theme` | 无 | DSH tokens、theme preference、icon sprite |

Shell 不包含 `if (todo)`、`if (approval)`、`if (provider)` 的业务分支；这些区域是否存在由 Slot roster 决定。

## 6. Provider 作为全栈插件

- `providers` Host 插件拥有 pi-ai Models、redacted DTO 与 credential vault。
- 每个兼容 Provider 的声明通过统一 `ProviderContribution` 注册：id、displayName、api、defaultBaseURL、model metadata、credential policy。
- 自定义协议若确有需要，作为独立 Provider 插件向 pi-ai 注册完整 Provider；不通过 UI 注入任意 JavaScript。
- `ui-settings-providers` 只依赖 `providerCommands` service；添加/编辑卡片不决定请求协议实现。
- Provider profile 和 credential 两次 mutation 分开，允许单独重试 credential；启停 Provider 不删除密钥。
- 配置变更由 Host 的 Models getter 在下次模型解析时生效；进行中的请求保持原选择，不盲目重启 Harness。

## 7. 事件与扩展选择

- Cordis event 用于 Host/Browser 应用插件协作，例如 `host/reopened`、`provider/changed`、`approval/requested`；不自动作为模型历史。
- Durable Entry/Document 才是需要恢复、回放、模型可见或分支一致的权威事实。
- pi-durable `beforeTool/afterTool/sections/wrapTool` 用于 Agent 执行管线，不能用 Browser Cordis listener 代替。
- Approval Guard 强制加入每个 Conversation 的 Extension 解析；普通插件和用户配置不得将其移除。需要更严格授权时在 ExecutionEnv 再做宿主策略。

## 8. 生命周期与失败

```text
解析 roster → 校验 API 版本/inject/冲突
→ 激活 Host 基础设施 → 激活 Host 功能插件
→ 安装 Durable Extensions → 获取工作区锁并打开 Harness → resume
→ 开放 RPC/WS → 激活 Browser roster → renderer.mount
```

关闭或重开：

```text
停止新命令/订阅 → 关闭 Browser subscriptions → 停止 Host RPC
→ Harness.close（等待运行中代码）→ 释放插件资源/锁
```

- 启动失败回滚当前插件已注册副作用，错误包含 plugin id 和缺失 inject。
- 单个 Presentation 错误由 Slot error boundary 隔离；Durable 恢复和 Host mutation 不依赖该组件存活。
- Storage failure 是 Host 级事件，不在插件内各自重试；由 `durable-host` 串行 reopen。
- V1 插件代码变更重启进程。未来 HMR 必须同时处理 Host/Client API 版本、pending task migration、旧 UI disposal 和 in-flight resource ownership。

## 9. 验收

1. 从 roster 移除 Todo 插件后，Todo 工具、RPC、Document、dock、inspector 和 Prompt Section 全部消失，Shell 无需修改。
2. 重复 public Document key、Slot key、RPC name 或 Provider id 在启动时失败并指出插件。
3. 卸载插件不留下定时器、watch、RPC、Subscription、Slot 或事件监听器。
4. Approval Guard 不能被普通插件或 UI 配置关闭；Provider 密钥不出现在任何 Browser snapshot。
5. 功能包之间没有运行时 component import；`App.tsx` 不包含各领域业务条件分支。
