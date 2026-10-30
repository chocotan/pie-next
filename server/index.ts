import { openHost } from './host.ts'
import { startRpcServer } from './rpc.ts'
import { ConversationPlugin } from './plugins/conversation.ts'
import { ProviderPlugin } from './plugins/providers.ts'
import { ApprovalPlugin } from './plugins/approval.ts'
import { WorkspaceManager } from './workspaces.ts'

const workspace = process.argv[2] ?? process.cwd()
const workspaces = await WorkspaceManager.open(workspace, path => openHost(path, [ConversationPlugin, ProviderPlugin, ApprovalPlugin]))
const rpc = await startRpcServer(workspaces, Number(process.env.PORT ?? 4174))
console.log(`pie-next: ${rpc.url}/#token=${rpc.token}`)

const close = async (): Promise<void> => {
  await rpc.close()
  await workspaces.close()
  process.exit(0)
}
process.once('SIGINT', () => { void close() })
process.once('SIGTERM', () => { void close() })
