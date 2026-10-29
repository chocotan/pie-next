import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context'
import { processLock } from '@earendil-works/chord/node'
import { Harness } from '@earendil-works/pi-durable'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { createRegistry } from '@earendil-works/pi-durable'
import { CodingTools } from '@earendil-works/pi-durable/tools'
import { ProviderStore } from './providers.ts'
import { PluginContext, type HostPlugin } from './plugin-runtime.ts'
import { TodoDoc, TodoExtension } from './plugins/todo.ts'
import { ApprovalDoc, reconcileApprovals } from './plugins/approval.ts'
import { SubagentPlugin, SubagentsDoc } from './plugins/subagent.ts'
import { BackgroundDoc, BackgroundPlugin, backgroundService } from './plugins/background.ts'
import { CompactionPlugin } from './plugins/compaction.ts'
import { createContextPlugin } from './plugins/context.ts'
import { PluginConfigStore } from './plugin-config.ts'
import { RuntimeSettingsStore } from './runtime-settings.ts'

export interface Host {
  context: PluginContext
  harness: Harness
  providers: ProviderStore
  plugins: PluginConfigStore
  runtime: RuntimeSettingsStore
  rootId: number
  close(context?: Context): Promise<void>
}

export async function openHost(workspace: string, plugins: HostPlugin[] = []): Promise<Host> {
  const cwd = resolve(workspace)
  const key = createHash('sha256').update(cwd).digest('hex').slice(0, 16)
  const dataDir = process.env.DURABLE_WORKSPACE_DATA ?? resolve(homedir(), '.durable-workbench', key)
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const releaseLock = await processLock(`durable-workbench:${cwd}`)
  let harness: Harness | undefined
  try {
    const providers = await ProviderStore.open(dataDir)
    const pluginConfig = await PluginConfigStore.open(dataDir)
    const runtime = await RuntimeSettingsStore.open(dataDir)
    const enabled = pluginConfig.state
    const registry = createRegistry()
    registry.install(CodingTools)
    const context = new PluginContext(registry, providers.createModels(), providers, runtime)
    if (enabled.todo) {
      context.extension(TodoExtension)
      context.document('todos', TodoDoc, 'todo')
    }
    const builtins = [enabled.background ? BackgroundPlugin : undefined, enabled.subagent ? SubagentPlugin : undefined, enabled.compaction ? CompactionPlugin : undefined, enabled.context ? createContextPlugin(cwd) : undefined].filter(plugin => plugin !== undefined)
    for (const plugin of [...builtins, ...plugins]) await plugin.register(context)
    const background = enabled.background ? backgroundService(context) : undefined
    harness = await Harness.open(await openNodeSqliteStorage(resolve(dataDir, 'session.sqlite')), {
      models: context.models,
      registry,
      settings: () => ({ retry: runtime.state.retry, compaction: { enabled: pluginConfig.state.compaction && runtime.state.compaction.enabled } }),
      env: ({ cwd: conversationCwd }) => new NodeExecutionEnv({ cwd: conversationCwd ?? cwd }),
      conversationCreated: async (tx, conversation) => {
        await tx.doc(TodoDoc, conversation.id)
        await tx.doc(ApprovalDoc, conversation.id)
        await tx.doc(SubagentsDoc, conversation.id)
        await tx.doc(BackgroundDoc, conversation.id)
      },
    }, BACKGROUND_CONTEXT)
    context.setHarness(harness)
    background?.bind(harness)
    const root = await harness.root(BACKGROUND_CONTEXT, { agent: { model: providers.defaultSelection(), cwd } })
    await root.commit(async tx => {
      await tx.doc(TodoDoc, root.id)
      await tx.doc(ApprovalDoc, root.id)
      await tx.doc(SubagentsDoc, root.id)
      await tx.doc(BackgroundDoc, root.id)
    }, BACKGROUND_CONTEXT)
    await background?.reconcile()
    await reconcileApprovals(harness)
    harness.resume()
    return { context, harness, providers, plugins: pluginConfig, runtime, rootId: root.id, close: async (closeContext = BACKGROUND_CONTEXT) => {
      await background?.close()
      await harness!.close(closeContext)
      await releaseLock()
    } }
  } catch (error) {
    if (harness) await harness.close(BACKGROUND_CONTEXT).catch(() => {})
    await releaseLock()
    throw error
  }
}
