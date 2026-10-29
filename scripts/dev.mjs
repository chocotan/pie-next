import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/index.ts'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit', env: process.env }),
]
const stop = () => {
  for (const child of children) child.kill('SIGTERM')
}
for (const child of children) child.once('exit', code => { if (code !== 0) { stop(); process.exitCode = code ?? 1 } })
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
