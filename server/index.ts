import { openHost } from './host.ts'
import { startRpcServer } from './rpc.ts'
import { ConversationPlugin } from './plugins/conversation.ts'
import { ProviderPlugin } from './plugins/providers.ts'
import { ApprovalPlugin } from './plugins/approval.ts'
import { SubagentPlugin } from './plugins/subagent.ts'

const workspace = process.argv[2] ?? process.cwd()
const host = await openHost(workspace, [ConversationPlugin, ProviderPlugin, ApprovalPlugin, SubagentPlugin])
const rpc = await startRpcServer(host, Number(process.env.PORT ?? 4174))
console.log(`Durable Workbench: ${rpc.url}/#token=${rpc.token}`)

const close = async (): Promise<void> => {
  await rpc.close()
  await host.close()
  process.exit(0)
}
process.once('SIGINT', () => { void close() })
process.once('SIGTERM', () => { void close() })
