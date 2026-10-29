# Durable Workbench UI 架构与模块设计

> 以 DeepSeek Harness（DSH）`f3803c96974ad4a94195fb97e5c637e9c2a3afe3` 的 Web Client 为参考。本文约束原型与正式实现；当前 `src/App.tsx` 仅是视觉草图，不作为最终结构。

## 1. 目标与边界

采用 DSH 的浏览器侧 Cordis 插件、Client model、Session adapter、Conversation target、Slots、Store 和 Renderer 分层。复用 DSH UI 基础设施；Host 权威状态来自 pi-durable，不引入 DSH Agent Loop、Session Log 或 Typert 业务协议。

- **参考其架构，不伪造兼容。** DSH `SessionEvent` 与 Durable `Entry + Document` 是不同协议，由 durable adapter 显式转换。
- **保持扩展边界。** 功能包通过 service face、Slot 和 declaration merging 协作，不跨包导入运行时实现。
- **不建第二份业务真相。** 浏览器 model 是 Host 最新快照的投影，React 不持有独立会话状态。
- **先静态组合，后动态加载。** V1 保留 `dsh.client` manifest、inject 与 roster-ready mount 语义，以 Vite ESM 组合受信任模块；不实现插件市场、pnpm 安装器或完整 lazy-CJS/HMR。

## 2. 分层

```text
Node Host（权威状态与 mutation）
  pi-durable / SQLite / Provider credentials / tool policy
                         │ HTTP command + WS snapshot/delta
                         ▼
client/connection（物理连接）
  认证、generation、fetch、WS、取消，不解释业务 Entry
                         ▼
api/durable-controller/client（Client model）
  DurableClient → ConversationManager → ConversationModel
  snapshot hydration、delta、分页、requestId、命令、identity
                         ▼
client/ui-session（UI adapter）
  ConversationReference/Provider、标准 scope hooks、访问与 pending 状态
                         ▼
client/ui-conversation（target-neutral assembly）
  Definition registry、逐会话 binding、View registry、共享 shell/input
                         ▼
client/ui-chat / ui-trajectory（target-owned projection）
  自己的 Definition、ViewModel、renderer；没有跨 target 的最终模型
                         ▼
client/ui-layout + feature plugins（Slots 组合）
  ui-todo / ui-subagent / ui-approval / ui-settings-providers
                         ▼
client/ui-renderer（唯一 React 订阅与 root mount）
                         ▼
client/ui-primitives / ui-theme（无业务展示）
```

命令反向流动：

```text
Presentation callback
  → entry inject face / slot owner
  → narrowed Client service
  → Host command（schema 校验、访问策略、requestId）
  → Durable commit
  → watch snapshot/delta
  → Client model → target source → renderer
```

## 3. 依赖红线

1. **Presentation 不接收 Cordis `ctx`、transport、Harness 或 React hook factory。** 组件只接收推导出的 owner props、标准 hooks、entry inject、store actions 和 locale。
2. **只有 `ui-renderer` 将裸 observable 转为 React hooks。** 功能组件不直接调用 `useSyncExternalStore`，不订阅 WebSocket。
3. **功能包之间仅允许 `import type`。** 运行时使用 Cordis service；跨包 UI 使用 Slots；共享值放到职责单一的 primitives/util/protocol 包。
4. **Client model 不依赖 React。** Store 只保存 view state，例如当前 Tab、折叠状态、草稿和主题，不复制 Durable Entry、Todo 或审批事实。
5. **Cordis service 不返回 JSX。** Slot registration 才拥有 component；child slot 由渲染它的 owner 声明，其他包用 `ctx.slots.inject()` 等待生命周期。
6. **UI domain 只传 JSON-compatible data 与 callback。** 例外是 injection `hooks` 中的裸 observable source；ReactNode 只能通过 Slot/owner props 传递。
7. **Target 独立。** Chat 与 Trajectory 可以读取同一 Durable Entry，但不得导入对方 Definition 或最终 ViewModel。
8. **设置与密钥隔离。** Browser 只能获得 redacted Provider DTO；write-only key 经专用 command 提交，不进入 Provider 列表、快照、日志或 localStorage。

## 4. 包与目录

```text
apps/
├── server/                         # Node Host 组合入口，不属于浏览器 UI
└── web/
    ├── src/main.ts                 # boot DOM、创建 Client Context、激活 roster
    ├── src/composition.ts          # 显式受信任模块清单与顺序
    └── package.json
packages/
├── protocol/                       # 共享 wire DTO/schema；无 Cordis、无 React
├── client/
│   ├── connection/                 # generation、HTTP/WS、取消与恢复
│   ├── store/                      # 复用/适配 DSH observable store
│   ├── durable-controller/         # Host 对应的 Client face + Client model
│   ├── ui-session/                 # Conversation scope 与标准 hooks
│   ├── ui-conversation/            # Definition/View registry、共享 shell/input
│   ├── ui-layout/                  # root AppFrame、三栏、drawer、布局 Slots
│   ├── ui-chat/                    # Chat Definition、ChatView、message Slots
│   ├── ui-trajectory/              # Trajectory Definition、ledger、record inspector
│   ├── ui-todo/                    # app.todos model hook、Todo dock、管理面板
│   ├── ui-subagent/                # roster、lineage、agent navigation/operations
│   ├── ui-approval/                # approval cards、decision command、tool detail
│   ├── ui-settings/                # 设置 shell、分类导航、modal/overlay Slots
│   ├── ui-settings-providers/      # Provider list/editor/model rows/write-only key
│   ├── ui-primitives/              # DSH Button/Modal/StateDot/Markdown/icons...
│   ├── ui-theme/                   # DSH tokens、字体、明暗、focus、icon sprite
│   ├── ui-slots/                   # DSH SlotCore 与类型协议
│   └── ui-renderer/                # DSH renderer + SessionProvider 绑定
└── vendor/deepseek-harness/         # 需要源码适配的 DSH 包，保留许可与出处
```

包可以目录模块化，但不必为每个目录立即发布 npm 包。依赖由 `package.json` 和 tsconfig paths 明确，禁止从 `src` 深路径绕过公开 `/client` 出口。

## 5. 模块职责

### 5.1 Boot 与组合

参考 DSH `client/web`：

- `composition.ts` 声明模块 id、`inject`、`immediately` 与 export。
- `main.ts` 创建共享 React/Cordis/service identity，等待所有 entry settled，再调用一次 `ctx.uiRenderer.mount()`。
- `root` 只由 `ui-layout` 占用，其他插件不得覆盖。
- V1 不复制 `window.__DSH_BOOT__` 和动态图加载器；未来增加时 manifest 是唯一模块描述来源。

### 5.2 Connection

参考 DSH `client/connection`，但 wire 使用本项目的 Durable protocol：

- `generation` 表示一次可用 Host 连接；每次重连先建立新 generation，再重开 logical subscription。
- `fetch()` 负责 unary command/cancel/error envelope，不理解 Todo 或 Chat。
- `subscribe()` 输出 `snapshot | delta | end | error`，使用 `subscriptionId + frameId + epoch`，不把网络 frameId 当 Storage Seq。
- 普通 forwarded notification 不保证 replay；所有状态型 stream 必须 snapshot-first。

### 5.3 Durable Controller / Client model

对应 DSH `api/session-controller/client`，拆为三个稳定身份：

- `DurableClient`：Conversation catalog、Provider catalog、Host state、reference retain/release。
- `ConversationManager`：按 ID 懒建 model，处理拉取与后到增量、重连 replacement、命令回执、全局 roster。
- `ConversationModel`：一个 `ConversationView + ConversationTranscript` 投影、独立 Document subscriptions、分页/gap repair、提交/停止/Continue 命令。

公开 readonly snapshot 与 narrowed command，不公开 transport。Entry 保留不可变 identity；Document 采用独立 source，多个 watch 合并页面时不声称跨 watch 原子帧。

### 5.4 UI Session

对应 DSH `ui-session`：

- 将 `ConversationModel` 转为 `session-maybe/session` Slot source 和标准 hooks。
- `ConversationProvider` 支持继承外围 binding，也支持显式绑定 Subagent，不为整个 body 设置 key。
- 标准 props 包括 `conversationId`、`useConversationStatus`、`useDocument`、`useAccess`、`useUsage`；只有确定需要的字段进入标准集合。
- 处理 pending interaction 和完成提醒；访问 UI 只是反馈，Host 始终执行真实授权。

### 5.5 UI Conversation

对应 DSH `ui-conversation` 的职责，保留 target-neutral registry 与共享 shell：

- `events.register(Definition)`：从不可变 Entry、live tool slot、Document update 提取稳定 `(kind,id)`。
- `views.register(ViewDefinition)`：为 chat/trajectory 物化独立 target source。
- 每个 Conversation 只有一个 assembler/binding；shell 选择 target，target 第一次订阅时执行完整 replace。
- `pi.live` 是完整 current state，不是追加 token 日志；重复 frame 必须幂等。Entry 流与 live 快照分别处理，不能把 Chord Delta 当业务事件猜测关联。
- 共享 Conversation header、content Factory、composer、queue dock、Todo dock 和 view navigation。
- Composer 每会话保存草稿；Enter 与 Ctrl/Cmd+Enter 对应互补投递；提交带 requestId，Host 接纳后清草稿，失败保留。
- V1 使用 textarea，不引入 Lexical 全部能力；模块接口仍与 shell 分离，未来替换编辑器不影响 target。

### 5.6 Chat 与 Trajectory

- `ui-chat` 注册 user/assistant/tool-call/compaction/system 等自己的 Definition 与 `conversation.chat.node` keyed renderer。
- `ui-trajectory` 注册独立 Definition、request/system/tool detail 模型、虚拟化表格和检查器。
- Tool inspect 通过 target-neutral `toolCallFocus(callId)` 协议定位；Chat 不扫描 Trajectory rows，Trajectory 不读 Chat nodes。
- Markdown、JSON、Diff、Icon 等只来自 `ui-primitives`。

### 5.7 Feature Plugins

| 包 | 权威数据 | 主要 contribution |
| --- | --- | --- |
| `ui-todo` | `app.todos` Document | `conversation.input.dock(id=todo)`、inspector Todo、todo_write renderer |
| `ui-subagent` | roster + owner edge + pi.live/task graph | tree/lineage、catalog、child ConversationProvider、Steer/Stop |
| `ui-approval` | `app.approvals` + tool task identity | tool approval card、decision action、pending interaction；不拦截 Host 执行 |
| `ui-settings` | settings shell view state | settings overlay、category Slots |
| `ui-settings-providers` | redacted Provider catalog | provider list、editor、model rows、credential write-only action |

所有模块通过 `ctx.slots.inject()` 注册，不在 `App.tsx` 直接 import 彼此组件。

### 5.8 Provider 设置

参考 DSH `ui-settings-models` 的 `ProviderEditor/CustomProviderCard/ApiKeyInput/ModelListEditor` 分层：

- `ProvidersSection`：分类 owner，只组合列表和添加入口。
- `ProviderCard`：redacted 展示、启停、编辑。
- `ProviderEditor`：endpoint/protocol/display name 的 draft、校验、提交。
- `CustomProviderCard`：新 route，不让 ID 与现有 Provider 冲突。
- `ApiKeyInput`：write-only、默认 masked、可显示当前未保存 draft；已有 key 永不读入。
- `ModelListEditor`：模型 ID、能力、contextWindow/maxTokens/reasoning；不增加 provider 级 reasoning 选项。
- `ProviderOperations`：保存 profile、保存 credential、测试连接分开；profile 成功而 key 失败时，重试只写 key，不重复创建 Provider。

协议首版支持 pi-ai 已支持的 API；没有自定义协议需求时，不开发 provider extension SDK。

## 6. Slot 契约

沿用 DSH 的 kind/scope 与 owner 语义，首版只开放实际需要的区域：

```text
root [AppFrame]
├─ shell.overlay [list/root]
├─ sidebar.panellist [list/root]
├─ main [keyed/root]
│  └─ key=conversation [ConversationRoot]
│     ├─ conversation.header.leading [list/session-maybe]
│     ├─ conversation.session.header.lineage [list/session]
│     ├─ conversation.session.header.actions [list/session]
│     ├─ conversation.session.header.utilities [list/session]
│     ├─ conversation.session.header.views.actions [list/session]
│     └─ conversation.content Factory
│        ├─ conversation.view [keyed/session]
│        │  ├─ key=chat → conversation.chat.node [keyed/session]
│        │  └─ key=trajectory → trajectory.record.renderer [keyed/session]
│        ├─ conversation.composer [chain/session-maybe]
│        ├─ conversation.input.dock [list/session]
│        ├─ conversation.input.left/right [list/session]
│        └─ conversation.inspector.tabs [list/session]
└─ settings.sections [list/root]
   └─ id=providers [ProvidersSection]
```

- `single` 和已有 `keyed` cell 是有意的替换点；普通扩展新增 list id 或新 key。
- 只有声明 owner 可以渲染 child slot；owner 卸载时，子声明和贡献按同一生命周期撤销。
- Slot store 用于 tabs/collapse/draft，不用于 Provider、Todo、审批等 Host 状态。

## 7. Durable → Conversation 映射

| Durable | Client 输入 | 处理原则 |
| --- | --- | --- |
| `pi.user` | `user` Entry | 按 entryId 建 node；requestId 关联本地回显 |
| `pi.assistant` | assistant Entry | 文本/thinking/tool calls 按内容块和 callId 关联 |
| `pi.tool-result` | tool result Entry | 按 toolCallId 关联；不根据 result 猜测 Todo 成功 |
| `pi.system` | system Entry | 保存实际 sections/tools snapshot，供检查器展开 |
| `pi.compaction/reset` | context marker | 原始历史仍在，active context 与展示分开 |
| `pi.live` | current live snapshot | 幂等替换 generation/tools/nestedTools/runFailure，不追加为 Entry |
| `app.todos` | 独立 Document | Todo target 订阅，历史用 rewindable snapshot |
| `app.approvals` | 独立 Document | 按 taskId+callId 关联，decision 只由 Host 判定 |
| TaskGraph/owner edge | task/roster 状态 | live 与历史归属分开；终态 child 不从树消失 |

## 8. 原型到正式实现的步骤

1. **原型模块骨架**：建立上述包边界和静态 roster；`durable-controller` 先实现 `FixtureTransport`，只替换 transport，不改变 UI 组件接口。
2. **截图评审**：检查三栏、Chat/Trajectory、审批、Todo、Provider 设置、375/768/1440 与明暗主题。
3. **真实 Client/Host**：用 HttpWsTransport 替换 FixtureTransport，接 pi-durable；不修改 Presentation。
4. **领域交付**：Todo、Subagent、Approval 分插件完成；Provider 配置与凭证服务端保存。
5. **恢复测试**：模型/工具/审批/队列中断后，Client model 以新 snapshot 收敛，不在组件里做恢复逻辑。

## 9. 评审清单

- 是否存在一个巨型 `App.tsx` 直接知道所有 service、transport 和业务组件？最终答案必须是否。
- Chat/Trajectory 是否拥有各自 Definition 与 ViewModel，而不是共用一个通用 message array？
- 是否只有 renderer 把 observable 绑定 React，Presentation 不含 `ctx`？
- 跨包运行时是否只走 service/Slots，没有 import 其他功能包组件？
- Todo/审批/Provider 是否只有一份权威状态，Slot store 没有复制它？
- 是否存在 API Key 回显、localStorage 持久化或日志泄漏路径？必须全部没有。
- Provider profile 成功而 credential 失败时，是否可以只重试 credential？
- 新功能是否可以通过注册 Slot 添加，而无需修改 shell 的条件分支？

## 10. 参考

- DSH `docs/subsystems/web-client.zh.md`：分层、Client model、UI adapter 与包边界。
- DSH `docs/subsystems/slots.zh.md`：Slot 所有权、输入与扩展规则。
- DSH `docs/subsystems/conversation.zh.md`：Definition、target 与增量组装。
- DSH `packages/client/ui-session`、`ui-conversation`、`ui-renderer`、`store`。
- DSH `packages/client/ui-settings-models`：Provider 编辑和 write-only credential 组件边界。
