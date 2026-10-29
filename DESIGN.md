# Durable Workbench 方案与设计

> 状态：设计稿，尚未实现。目标是单用户、单工作区、可崩溃恢复的本地 Agent Web 工作台，而不是重写一套 DeepSeek Harness。
>
> 调研基线：pi-durable `1.4.0`，pi 源码 `e65b3b88c08412bb8ffbd21fb5dc5756064a6e5a`；DeepSeek Harness（DSH）源码 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`。pi-durable 标注为 Experimental，依赖应锁定精确版本，升级先跑恢复测试。

## 1. 结论

原方案的核心判断正确：Conversation、Commit、Document、Task、Registry 很适合作为 DSH 风格工作台的底座。建议保留这个方向，但做三项收敛：

1. **复用 DSH 的 React 组件与 Slots，不复用它的 Cordis 后端和 Session 协议。** 增加很薄的 Durable ViewModel 适配层即可，不让两套 Agent 内核同时存在。
2. **V1 先做完整闭环，不做通用插件平台。** 对话/轨迹、Todo、前后台 Subagent、持久审批、断线重连和崩溃恢复是验收主线；插件市场、远程 UI、Worktree 自动管理和 Child Ask 延后。
3. **不把“工具可重放”误当成“副作用恰好一次”。** 默认按外部副作用可能已发生来设计；Todo 是纯内部状态，可用调用 ID 去重，文件和 shell 工具默认不重放。

## 2. 对原方案的必要修正

| 原设想 | 核实结果与设计调整 |
| --- | --- |
| `defineDocument` / `systemPrompt` | 当前是 `defineDoc`，Prompt 用 `section()`；Document 必须有 `kind/version/scope/history/fork/initial/checkpointWhen`。 |
| `tx.updateDocument()` | 使用可撤销草稿：`const doc = await tx.doc(Todos, conversationId); doc.items = ...`。 |
| 所有 UI 状态来自 `Conversation.watch()` | 它只挂载 Entry 与 `pi.agent/live/inbox/provider/usage`。Todo、审批等第三方文档必须单独 `watchDoc()`。 |
| Todo 文档和工具结果天然同一事务 | 不是。工具内可原子提交 Todo 与 task-scoped 去重凭据；内核在 `execute()` 返回后另行提交 Tool Result。Todo 用稳定的 `taskId` 识别重放，返回已保存结果。 |
| `replay: "safe"` 表示幂等 | 只表示允许恢复时重跑。纯读取或具有应用级去重的操作才可声明 safe。内置工具未显式声明 safe，默认 unsafe。 |
| 后台子 Agent 直接 `submit()` 后返回 | 采用官方 Anchor + Reporter 两个 durable Task，父子关系、结果回报和 requestId 去重必须持久化。 |
| 任意 `submit()` 都能 Steer | 忙碌时默认 follow-up；干预当前运行必须 `whenBusy: "steer"`。 |
| `beforeTool` 可作为等待审批的原语 | 它只能改写参数或 block。审批在 Tool Wrapper 中持久等待；决定经 `memo` 固定后才执行。恢复不会重新执行 `beforeTool`。 |
| Fork 继承 Prompt Cache | 只继承 Entry 与指定语义的 Document，并获得新的 provider session identity；不能保证 provider cache 命中。 |
| Registry 支持热替换，所以全栈插件也能热插拔 | 内核支持 Extension 替换，但新旧前后端协议、运行中资源和 UI 组件仍需宿主协调。V1 提供受控注册与重启加载，不宣称安全热插拔。 |
| 所有显示内容先落盘 | 普通事实如此；流式回答和工具进度是 deferred commit，默认最多约 1 秒延迟落盘，崩溃可丢失尾部。 |
| Todo 的 `checkpointWhen: () => false` 可直接长期使用 | 会导致 delta 链无界增长；采用周期性完整 base。 |
| Git Worktree 是 pi-durable 内置能力 | 不是；需要宿主创建、配置 `cwd`、处理生命周期和清理。它不是安全沙箱。 |

## 3. V1 范围

### 必须有

- 打开一个本地工作区，选择已配置的模型，发送消息、流式显示回答。
- 展开工具调用，查看参数、结果、详情、诊断、耗时、失败和中断。
- Todo 的模型更新与人工编辑，状态与 Conversation 持久关联。
- 前台等待和后台并行 Subagent；切换观察、发送 steer/follow-up、停止。
- 高危工具的一次性批准/拒绝，刷新或服务重启后请求仍在。
- 停止当前工作；失败后的 Continue；排队消息显示与撤回。
- WebSocket 断开重连、历史向上分页、窗口遗漏补页。
- 进程被强杀后重开 SQLite，恢复可恢复工作，不重复已提交输入。
- 内置功能用同一插件接口装配，并支持受信任的本地 UI Slots。

### 明确不做

- 多用户、多租户、权限账号体系、公网部署。
- 多工作区进程管理、Electron/Tauri、移动端 App。
- 插件市场、远程 URL 组件、第三方插件沙箱、声明式全栈热更新。
- 自动 Worktree、自动合并代码、Child Ask、多 Agent 群聊。
- 另一套事件溯源数据库、Redis、消息队列、服务端前端状态副本。
- 通用低代码面板设计器、复杂图表与装饰性动画。

## 4. 总体架构

```text
┌───────────────────────────────────────────────────────────────┐
│ Browser：React 18 + TypeScript + Vite                         │
│ DSH UI primitives / Slots / Trajectory 展示组件                │
│ DurableViewModel adapter · applyImmutable · local UI state    │
└───────────────────────────┬───────────────────────────────────┘
                            │ 同源 HTTP RPC + WebSocket
┌───────────────────────────▼───────────────────────────────────┐
│ 单个 Node Host（绑定 127.0.0.1）                              │
│ RPC 参数校验 · 认证/Origin 检查 · SubscriptionHub             │
│ Plugin loader（受信任本地模块） · 工作区生命周期/进程锁         │
├───────────────────────────────────────────────────────────────┤
│ @earendil-works/pi-durable                                    │
│ Conversation / Task / Registry                                │
│ app.todos · app.subagents · app.approvals + watchDoc           │
│ pi.agent/live/inbox/usage + Conversation.watch                 │
├───────────────────────────────────────────────────────────────┤
│ SQLite：一个工作区一个文件，一个进程独占                       │
│ NodeExecutionEnv：工具在工作区 cwd 执行                        │
└───────────────────────────────────────────────────────────────┘
```

- 启动命令建议 `durable-workbench [workspace]`，V1 一个进程服务一个工作区。
- 数据放在用户数据目录下按工作区绝对路径哈希命名的目录中，不直接污染项目；数据库备份、迁移、删除由宿主管理。
- 在 `Harness.open()` 前使用 Chord 已提供的 `processLock()` 获取工作区锁；不要让两个 Host 打开同一数据库。
- 启动顺序：加载内置及本地插件 → 获取锁 → 打开 SQLite/Harness → 恢复 root → `harness.resume()` → 开放 RPC/WS。
- `harness.closed` 若为 failed：先停止接受新 RPC、关闭订阅和 WebSocket，再串行重开；不在旧实例上重试写入。
- 关闭顺序相反：先停止外部访问和订阅，再 `harness.close()`，等待全部任务代码退出后释放锁。
- Node 22.19+ 即可；团队已有 Node 24 时统一用 Node 24。无需为了 SQLite 强制 Node 24。

## 5. DSH 复用策略

### 直接复用或 vendor 后小改

| DSH 资产 | 用法 |
| --- | --- |
| `packages/client/ui-primitives` | 按钮、图标、Markdown、代码块、JSON Tree、状态点等，优先直接依赖其公开构建；保持 React 18。 |
| `packages/client/ui-theme` | 复用字体、颜色 token、焦点样式、滚动条、明暗主题，不重新发明一套紫色 AI 皮肤。 |
| `packages/client/ui-slots` + `ui-renderer` | 复用声明式 Slots、注册冲突检查和 disposal 语义；不引入 DSH 的 Cordis Agent 运行时。 |
| `ui-trajectory/TrajectoryTable` 及模型 | 将 Durable Entry 映射成 `TrajectoryTurnModel/TrajectoryCellProps`，复用虚拟列表、检查器、搜索、展开和滚动逻辑。 |
| `ui-tool` 的 Todo/ToolRow 呈现、`ui-conversation/TodoPanel` | 优先复用行组件和纯函数；历史来源换成 rewindable Document，不复刻 DSH Session 投影。DSH TodoPanel 是只读面板，人工编辑由我们补充。 |

### 必须适配或重写薄层

- `ConversationNodeDefinition`、DSH Session projection、`dsh-client-connection/store`：属于 DSH 数据协议，不搬到新内核。
- Chat Composer、会话/Agent Tree、Todo 侧栏、审批卡、宿主 RPC：按 DSH 视觉和交互方式实现少量应用组件。
- `apps/web` 整壳、插件市场、桌面端和 DSH CLI 后端：不复用。

建议第一阶段做一个构建验证：让真实 DSH primitives + TrajectoryTable 消费 Durable fixture，再决定是否 vendor 少量源码。若依赖传递迫使引入完整 DSH Client，只 vendor MIT 许可的展示组件及 NOTICE，不为一个组件搬整个框架。

## 6. 状态模型

### 6.1 内核已有状态

| UI | Durable 数据源 |
| --- | --- |
| 对话与原始轨迹 | `Conversation.watch().entries`，长历史用 `ConversationTranscript` |
| 流式回答、工具运行、失败、重试 | `docs["pi.live"]` |
| 排队输入 | `docs["pi.inbox"]` |
| 模型、工具、cwd、扩展选择 | `docs["pi.agent"]`，解析后的可用项用 `conversation.agent()` |
| Token/费用 | `docs["pi.usage"]`；全局汇总用 `harness.usage()` |
| 父子关系 | `ConversationRecord.parent`（fork）与 `owner`（任务持有），不可混为一谈 |
| 活跃任务 | `harness.watchTaskGraph()`；终态子 Agent 的归属仍读 Conversation owner edge |

### 6.2 Todo

```ts
type TodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  assignedConversationId?: number;
};

type TodoState = {
  items: TodoItem[];
  updatedAt: number;
};

type TodoWriteReceipt = {
  applied: boolean;
  output: string;
};
```

- `defineDoc<TodoState>`：`kind: "app.todos"`、`scope: "conversation"`、`history: "rewindable"`、`fork: "asOf"`，让 Fork 获得 Fork 点的 Todo，而非误用最新值。
- `checkpointWhen: (_v, _ops, info) => info.deltasSinceBase >= 31`，避免无限 delta。
- 另设 task-scoped `app.todo-write-receipt`。`todo_write` 采用完整列表替换，输入通过 TypeBox 校验；一个 `api.commit()` 原子检查/更新 Todo 与 Receipt。重放发现当前 `api.taskId` 已 applied 时返回原 output，不再次改变列表。任务终结后 Receipt 自动退休，而终态任务不会再执行。
- 不单独用 provider `callId` 去重：规范不保证它在 Session 内唯一。`api.memo()` 是独立事务，也不能与 Todo 更新合并。
- `todo_read` 是 safe；`todo_write` 只有上述去重成立后才标记 safe。若业务写入已成功、结果尚未提交时任务为 unsafe，恢复会显示 interrupted，业务写入不会回滚。
- Prompt Section 读取当前 Todo，无内容则省略；不包含时间戳，避免无意义的 Prompt Delta 和缓存失效。
- 人工 UI 编辑走 RPC 的同一 Document 写路径，不启动模型。需要关联子 Agent 时跳转 `assignedConversationId`，不用 Todo 文本推断关系。
- Todo 历史对比使用 `snapshotAsOf()` 或加载历史时的 Document 状态，不从 Tool Result 反推“已成功”。

### 6.3 Subagent

直接以官方 `21-subagent-foreground.ts` 和 `22-subagent-background.ts` 为产品实现起点：

- **前台**：`replay: "safe"` 的工具在 `api.commit()` 中通过 `ownerTaskId` 查找或创建 task-owned child，配置后使用 `requestId: subagent:<taskId>` 提交并等待。父工具/Generation 的所有权关系负责取消和等待。
- **后台**：主会话 Document 保存 name → conversationId 和 Reporter ID；Anchor 持有 child，Reporter 负责消息投递与答案回报。Anchor/Reporter 均为 background，防止主 Agent 普通 Stop/idle 误停后台工作。
- 子 Agent 默认从父 Agent 的配置副本派生，再按角色精简模型和工具；有已存储 Extension 数组时，从解析后的父 Extension 列表计算子列表，不能错误地套用 host 默认选择。
- 所有 child 都保留 Subagent roster 文档；工具结果 `details.conversationId` 供 UI 跳转。子 Agent 默认禁止再次无限 Spawn，后续确有需求再开放受控深度。
- UI 发消息：忙碌时可选 Steer 或 Follow-up，分别显式传 `whenBusy`；空闲 steer 使用 `whenIdle: "reject"`，避免意外开启新 Run。
- “停止当前回答”与“停止全部后台工作”是两个按钮：后者明确调用 `abort({ background: true })`，并提示会终止哪些子树。
- 子 Agent 费用不从父工具 result 再报一次，避免重复统计；树汇总时按 Conversation 各自 `pi.usage` 求和。
- V1 只共享 cwd；需并行写代码时给出提示。Worktree 管理作为独立后续功能验收，不在 V1 暗中做半成品。

### 6.4 持久审批

`beforeTool` 只做不可等待的策略拒绝。需要批准的写操作使用 `wrapTool()` 包装实际执行，确保恢复后也经过同一决策：

```text
工具 intent 已由内核持久化
  → Wrapper 创建/读取 app.approvals[taskId] = pending + 调用摘要
  → 等待该 Document 中的人工决定（进程内等待，不占用模型请求）
  → 用户 RPC 原子写入 approved/denied
  → Wrapper 用 api.memo("approval:decision", decision) 固定决定
  → approved：执行原工具；denied：返回 isError，不调用原工具
  → 崩溃恢复：replay-safe 调用沿用 memo 中的决定；没有则继续读取/等待持久请求
  → unsafe 调用不自动重跑，返回 interrupted 并保留“可能已执行”的语义
```

这是“审批数据持久化 + 可恢复的原工具调用”，不是调度器级 parked：等待期间仍有进程内 invocation 和 watch；它必须响应取消与关闭。若未来要求长期无 invocation 停驻，应改为审批后创建自定义执行 Task，而不是假装 `beforeTool` 已支持。

- 请求关联内核 `taskId/callId`，绑定工具名和最终参数；一次性批准不自动提升为永久规则。
- 在创建 pending 前再次校验宿主策略；审批不是安全边界，参数、路径和调用权限仍由原工具及宿主验证。
- UI 的“等待审批”来自审批 Document，不能仅根据 `pi.live.tools.status` 猜测。
- 请求完成或取消后按一致规则清理/归档；不允许旧 taskId 的批准被新调用复用。
- 默认 V1 只提供 Approve once / Deny；Allow always 和规则编辑器后置。
- shell/文件工具默认 unsafe：审批后若进程强杀，恢复显示“可能已执行”，不盲目再执行一次。

## 7. 插件协议

插件是受信任、随应用构建或从明确本地路径加载的代码，拥有与 Host 相同权限；不是网页上下载即装的沙箱插件。

```ts
interface WorkbenchPlugin {
  id: string;
  version: string;
  extension: Extension;                    // pi-durable 原语，不另造 Agent 抽象
  documents?: Record<string, AnyDocToken>; // RPC/WS 可订阅的稳定公开 key
  commands?: Record<string, {
    input: TSchema;
    execute(args: unknown, ctx: CommandContext): Promise<JsonValue>;
  }>;
  ui?: () => Promise<{
    slots: Array<{ name: string; key?: string; component: ComponentType<any> }>;
  }>;
}
```

- 内置 Coding、Todo、Subagent、Approval 都用这个接口装配；审批 Guard 由 Host 强制选中，UI 不允许关闭。
- 插件文档 key 到 token 的映射由服务端静态配置；浏览器不能提交任意 Document kind 或伪造 task/conversation 权限。
- 每个插件 action 必须验证输入，错误以稳定 code 返回；不能在事务中等待网络、人类或其他任务。
- UI Slots 保留 `single/list/keyed/chain` 和注册 disposer；V1 固定 `session.sidebar`、`message.renderer`、`session.actions` 三类，避免任意区域注入。
- 插件 UI 和后端版本一起加载，加载失败显示可诊断错误并阻止不一致的工作区启动。
- V1 对第三方修改采用重启加载。未来再做 Host/API 版本协商、HMR 与资源 disposal，不把 `registry.install()` 单独包装成“全栈热更新”。

## 8. RPC 与实时协议

### 8.1 原则

- HTTP 负责命令和分页，WebSocket 负责订阅；不用 SSE + 轮询拼两套推送。
- Durable 是事实源，浏览器只保存投影和 UI 偏好。Zustand 可选，不是必需依赖。
- Conversation 首次发送 `watch.value` 快照，之后发送 decoded Chord `ops`，浏览器用 `applyImmutable()` 应用。
- 小型 Document 可先发送完整 value；流量变大后再优化，不必让所有面板都实现 Delta。
- 每个订阅带服务端 `subscriptionId`、单调 `frameId` 和 `epoch`；重连重新取快照，旧 socket 的帧因 epoch/subscriptionId 不匹配被丢弃。
- 初始快照先于 start 后的增量，严格遵循 Watch 生命周期；watch 回调串行发送，不能把慢客户端 Promises 放进内核事务。
- 一个服务端 SubscriptionHub 向多个客户端 fan-out，客户端断开后释放无消费者的 watch；设置 WebSocket backpressure 上限，慢客户端转为重连快照，而非无限缓存。

### 8.2 订阅

| stream | 内容 |
| --- | --- |
| `conversation:{id}` | snapshot + Chord Delta + `ConversationTranscript` 合并/缺口信息 |
| `tasks` | Task Graph snapshot + Delta |
| `doc:{publicKey}:{conversationId}` | 经插件注册的 Todo、审批、Subagent 等自定义 Document |
| `host` | Host readiness、重开、致命存储错误、已安装插件和连接状态 |

历史接口接受 cursor，不接受浏览器构造任意 Storage 查询。向上翻页和 `fillGap` 使用 `ConversationTranscript`；Entry ID 不连续，不能通过 ID 加减推断范围。

### 8.3 命令（示意）

```text
POST /api/session/input       { conversationId, requestId, content, whenBusy, whenIdle? }
POST /api/session/abort       { conversationId, background }
POST /api/session/continue    { conversationId }
POST /api/session/compact     { conversationId, instructions? }
POST /api/session/config      { conversationId, model?, thinkingLevel? }
POST /api/plugin/:id/:command { ...validated payload }
GET  /api/session/:id/entries?cursor=...&limit=50
GET  /api/models
```

- 浏览器为每次输入生成 UUID requestId；超时或重连用同值，服务端不重复提交。
- RPC 返回已接纳的 submissionId，不长时间等待最终回答。
- 所有 ID、枚举、字符串长度、参数大小、附件大小均验证；模型生成的 Tool 参数仍由 pi-durable 再验证。
- V1 不支持任意 Extension 开关，避免用户误关 Guard。配置面板只展示实际解析出的模型和工具。

## 9. UI/UX 设计

### 9.1 桌面布局

```text
┌──────────────────────────────────────────────────────────────────┐
│ Workspace / 模型与连接状态 / Context、费用 / Settings             │
├───────────────┬──────────────────────────────────┬───────────────┤
│ Conversation  │ [Chat] [Trajectory]              │ Inspector     │
│ + Agent Tree  │                                  │ Todo / Agents │
│               │ 对话或 Trajectory                 │ Usage / 插件   │
│ Root          │ 工具调用可展开；点选打开详情       │               │
│  ├ scout      │ 审批、失败、重试、排队清晰显示      │ 工具详情可临时 │
│  └ editor     │                                  │ 替换此区域     │
│               ├──────────────────────────────────┤               │
│               │ Composer + Steer/Follow-up + Stop│               │
└───────────────┴──────────────────────────────────┴───────────────┘
```

- 左栏约 240–280px、右栏约 320–400px，均可折叠；中栏 `minmax(0, 1fr)`，不允许代码块撑破页面。
- 首屏直接进入上次会话，不做营销式 Hero。界面以内容和高信息密度为主，沿用 DSH token，不额外引入紫色渐变。
- Chat 是默认视图，Trajectory 是同一会话的调试视图，两者共享选中的 toolCall；切换不清空草稿和滚动位置。
- Agent Tree 显示真实 owner/fork 关系及状态：生成中、工具中、等待审批、空闲、等待、失败、已停止。图标配合文字，不只靠颜色。
- 点击 child 只切换中栏观察对象；后台任务继续运行。Composer 顶部明确“正在向 Root/scout 发送”。
- Todo 侧栏有进度、状态筛选、手工编辑与关联 Agent 跳转；变更后不自动触发模型。
- Usage 展示当前 Conversation 与全局汇总，明确树汇总是否含 Subagent。
- 插件面板通过 Slots 注入右栏和工具渲染器，不能覆盖审批 Guard 与全局错误区。

### 9.2 关键反馈

- **流式**：最多约 100ms 更新，用户位于底部时跟随；向上阅读时不抢滚动位置。长列表使用 DSH 虚拟化。
- **Steer**：忙碌时 Composer 提供“插入当前运行”和“下轮跟进”两种选择，队列项显示模式并可撤回未放置项。
- **审批**：中栏工具行与右栏同时突出待审批卡，展示工具、参数摘要、cwd；操作后禁用按钮并显示“正在提交决定”，防双击。
- **失败**：显示 `runFailure` 人类可读原因，保留原始详情；idle 且可 Continue 时显示 Continue，不自动无限重试。
- **恢复**：Host 重开期间显示离线横幅和最后同步时间；恢复后重新 hydration，不伪造一条“全部成功”消息。
- **历史**：顶部“加载更早”，中间缺口“加载缺失”，加载上方内容保持当前视觉锚点。
- **可访问性**：正文至少 14–16px、文本对比度 4.5:1、可见 focus ring、键盘操作和 aria-label；触控目标至少 44px。动效 150–200ms，并尊重 reduced-motion。

### 9.3 响应式

- ≥1280px 三栏；768–1279px 左栏可折叠、Inspector 为 drawer。
- <768px 单栏，Agent Tree 与 Inspector 为全高抽屉，Composer 固定底部；代码块在自身容器横向滚动，而不是页面横滚。
- V1 优化桌面键鼠，移动端保证可用，不承诺完整移动 Agent 管理能力。

## 10. 安全与持久化边界

- 默认仅 `127.0.0.1`；启动生成随机 CLI token，页面交换为 `HttpOnly + SameSite=Strict` session cookie。WebSocket 校验同源 Origin 和 cookie，不依赖“本地端口别人猜不到”。
- API key 只从环境变量或权限为 0600 的本地凭据配置加载，不写 SQLite、RPC、日志或浏览器存储。
- NodeExecutionEnv 和插件拥有本机用户权限；审批不是容器，Worktree 也不是安全隔离。远程使用建议 SSH tunnel，不能直接暴露到公网。
- 所有 RPC 在边界验证，服务端校验会话归属和公开 Document key；日志默认不记录 Prompt、密钥、完整工具输出。
- 普通用户输入、Todo、审批、Submission、Task checkpoint 即时持久化；流式 progress 明确允许默认约 1 秒尾部丢失。
- SQLite WAL `synchronous=NORMAL` 防普通进程崩溃；主机掉电时最近提交仍可能丢失，不能宣称绝对零数据丢失。
- Fork/reset/compaction 不删除原始历史；Todo 的回溯一致性由 rewindable Document 决定，不是全局时间旅行。
- 数据格式和插件 Document 都需 `version + migrate`；升级遇到缺失或不兼容任务时 UI 显示 blocked，不静默丢弃。

## 11. 工程组织

不预先建立十几个空包；一个 pnpm workspace、三个实际边界即可：

```text
durable-workbench/
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── main.ts             # CLI、锁、生命周期、静态资源
│   │       ├── host.ts             # Harness 与恢复
│   │       ├── rpc.ts              # HTTP + WS + SubscriptionHub
│   │       └── plugins.ts          # 受信任插件加载与公开状态注册
│   └── web/
│       └── src/
│           ├── adapter/            # Durable → DSH ViewModel
│           ├── components/         # Workbench、Tree、Todo、Approval、Composer
│           └── slots/              # 内置面板注册
├── packages/
│   ├── core-plugins/
│   │   └── src/{coding,todo,subagent,approval}.ts
│   └── protocol/
│       └── src/index.ts            # 共享 DTO/schema/公开状态类型
├── vendor/                         # 仅在公开包无法独立复用时 vendor DSH 组件
├── tests/                          # 跨端恢复与 Playwright 场景
├── package.json
└── pnpm-workspace.yaml
```

优先 npm 公开包；vendor 时保留 DeepSeek MIT License/版权及对应 THIRD_PARTY_NOTICES，不复制无关后端。

## 12. 实施顺序与验收

### M0：技术验证（先拆最大风险）

- 用锁定版本运行 faux model + SQLite；验证 stream、watch、Todo watchDoc、前后台 Subagent。
- 构建 DSH primitives/TrajectoryTable 的最小页面，证明能脱离 DSH Agent Session 运行。
- 交付：一个 Durable fixture 驱动的 Trajectory 页面和 API 验证记录；不先搭完整插件系统。

### M1：持久对话闭环

- Host 生命周期、模型配置、RPC/WS、Chat/Trajectory、停止/排队/Continue、历史分页。
- 验收：发送→工具→回答完整可用；断线不重放消息；刷新恢复当前状态；强杀 Host 后输入和最终回答不重复。

### M2：Todo 与 Subagent

- rewindable Todo、人工编辑、Todo Prompt Section、前后台 child、Agent Tree、Steer/Stop。
- 验收：Fork 点 Todo 正确；后台 child 在主 Agent 回答后继续；恢复后 Reporter 不重复回报；停止父子树符合 ownership 语义。

### M3：审批、插件与产品化

- Wrapper 持久审批、内置插件 Slots、认证、错误与恢复横幅、响应式与可访问性。
- 验收：pending 审批跨重启；approve 只执行一次；deny 不执行；关闭/替换 UI 不错误释放仍在使用的后端资源。

### M4（后续，不阻塞 V1）

- Worktree 隔离与清理、Child Ask、受控全栈 HMR、多工作区 launcher、插件包管理。

## 13. 必测场景

1. **Todo**：同一 taskId 恢复不重复变更；Tool Result 提交前强杀后结果一致；Fork 的 asOf 值正确；Document delta 周期性 checkpoint。
2. **后台子 Agent**：主会话 Stop 不跨 background；显式 Stop all 能跨；Reporter 在两次 submit 前后分别强杀，消息和回报至多一次接纳。
3. **审批**：请求创建后、决定写入后、memo 后、外部副作用后分别强杀；unsafe 工具不自动重跑，拒绝不能因恢复被绕过。
4. **输入**：同 requestId 重试、Steer/Follow-up 顺序、失败队列 Continue、停止未开始工具。
5. **实时协议**：watch 初始快照+增量、慢客户端、重连 epoch、窗口 gap、历史 prepend 滚动锚点。
6. **插件**：重复 Slot 冲突、Document 公开 key 白名单、action schema、卸载 disposal、强制 Guard 不可移除。
7. **UI**：1440/1024/768/375px，长工具参数与输出、键盘、明暗主题、reduced-motion；浏览器端不持有模型密钥。

## 14. 参考源码

- [pi-durable README](https://github.com/earendil-works/pi/blob/e65b3b88c08412bb8ffbd21fb5dc5756064a6e5a/packages/durable/README.md)：Watching、Tools、Abort/Subagents、Your Own State、Storage。
- [pi-durable normative spec](https://github.com/earendil-works/pi/blob/e65b3b88c08412bb8ffbd21fb5dc5756064a6e5a/packages/durable/docs/spec.md)：§3 Documents、§5 Tasks、§7.2–7.5、§8.2–8.4、§9、§12。
- [Todo 官方示例](https://github.com/earendil-works/pi/blob/e65b3b88c08412bb8ffbd21fb5dc5756064a6e5a/packages/durable/test/examples/10-extension-state.ts)。
- [后台 Subagent 官方示例](https://github.com/earendil-works/pi/blob/e65b3b88c08412bb8ffbd21fb5dc5756064a6e5a/packages/durable/test/examples/22-subagent-background.ts)。
- [DSH UI Slots](https://github.com/deepseek-ai/deepseek-harness/tree/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/client/ui-slots) 与 [ui-renderer](https://github.com/deepseek-ai/deepseek-harness/tree/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/client/ui-renderer)。
- [DSH TrajectoryTable](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/client/ui-trajectory/src/client/TrajectoryTable.tsx) 与 [Todo 历史投影](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/client/ui-tool/src/client/tool/models/todo-history.ts)。
