// Adapted from Pie background process-tree.ts, windows-taskkill.ts and child-process.ts.
// Upstream shell adaptation: pi-background-tasks, ISC. See PI_BACKGROUND_NOTICE.md.
import { spawn, type ChildProcess } from 'node:child_process'
import { open } from 'node:fs/promises'
import { win32 } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'

export async function stopProcessTree(child: ChildProcess, graceMs = 3000): Promise<void> {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    const soft = await runWindowsTaskkill(pid, false).catch(() => ({ exitCode: 1 }))
    if (soft.exitCode === 0 || soft.exitCode === 128) return
    await delay(graceMs)
    const forced = await runWindowsTaskkill(pid, true)
    if (forced.exitCode !== 0 && forced.exitCode !== 128) throw new Error(`Windows process tree ${pid} termination failed`)
    return
  }
  const signal = (value: NodeJS.Signals | 0): boolean => {
    try {
      if (!process.kill(-pid, value)) throw new Error(`Process group ${pid} signal returned false`)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw error
    }
  }
  if (!signal(0)) return
  let forced = false
  try {
    if (!signal('SIGTERM')) return
  } catch {
    if (!signal('SIGKILL')) return
    forced = true
  }
  if (!forced) {
    const deadline = Date.now() + graceMs
    while (Date.now() < deadline) {
      if (!signal(0)) return
      await delay(Math.min(20, Math.max(1, deadline - Date.now())))
    }
    if (!signal('SIGKILL')) return
  }
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    if (!signal(0)) return
    await delay(10)
  }
  throw new Error(`Process group ${pid} remained present after SIGKILL; descendants may have leaked`)
}

async function runWindowsTaskkill(pid: number, force: boolean): Promise<{ exitCode: number | null }> {
  const root = process.env.SystemRoot ?? process.env.windir
  if (!root || !win32.isAbsolute(root)) throw new Error('Cannot resolve trusted taskkill.exe')
  const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])]
  const child = spawn(win32.join(root, 'System32', 'taskkill.exe'), args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8192) })
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      waitForChildProcess(child).then(exitCode => ({ exitCode })),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Windows taskkill failed: ${stderr}`)) }, 5000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Wait for leader exit and inherited-pipe idleness, then release the streams. */
export function waitForChildProcess(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false, exited = false, exitCode: number | null = null
    let timer: NodeJS.Timeout | undefined
    let stdoutEnded = child.stdout === null, stderrEnded = child.stderr === null
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
      child.removeListener('close', onClose)
      child.stdout?.removeListener('end', onStdoutEnd)
      child.stderr?.removeListener('end', onStderrEnd)
      child.stdout?.removeListener('data', onData)
      child.stderr?.removeListener('data', onData)
    }
    const finalize = (code: number | null): void => {
      if (settled) return
      settled = true
      cleanup()
      child.stdout?.destroy()
      child.stderr?.destroy()
      resolve(code)
    }
    const arm = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => finalize(exitCode), 100)
    }
    const maybeFinalize = (): void => { if (exited && stdoutEnded && stderrEnded) finalize(exitCode) }
    const onData = (): void => { if (exited && !settled) arm() }
    const onStdoutEnd = (): void => { stdoutEnded = true; maybeFinalize() }
    const onStderrEnd = (): void => { stderrEnded = true; maybeFinalize() }
    const onError = (error: Error): void => { if (!settled) { settled = true; cleanup(); reject(error) } }
    const onExit = (code: number | null): void => { exited = true; exitCode = code; maybeFinalize(); if (!settled) arm() }
    const onClose = (code: number | null): void => { finalize(code) }
    child.stdout?.once('end', onStdoutEnd)
    child.stderr?.once('end', onStderrEnd)
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
    child.once('close', onClose)
  })
}

export interface TaskLogRead {
  text: string
  bytesRead: number
  totalBytes: number
  truncated: boolean
}

/** Pie registry.ts bounded positional read: never load the complete log into memory. */
export async function readTaskLogs(outputPath: string, maxBytes = 50 * 1024, tail = true): Promise<TaskLogRead> {
  maxBytes = Math.min(50 * 1024, Math.max(1, Math.floor(maxBytes)))
  const file = await open(outputPath, 'r')
  try {
    const totalBytes = (await file.stat()).size
    const buffer = Buffer.alloc(Math.min(totalBytes, maxBytes))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, tail ? Math.max(0, totalBytes - buffer.length) : 0)
    let start = 0
    if (tail && totalBytes > bytesRead) while (start < bytesRead && (buffer[start]! & 0xc0) === 0x80) start++
    const decoded = new TextDecoder().decode(buffer.subarray(start, bytesRead), { stream: totalBytes > bytesRead && !tail })
    return { text: sanitizeBinaryOutput(decoded), bytesRead, totalBytes, truncated: totalBytes > bytesRead }
  } finally {
    await file.close()
  }
}

function sanitizeBinaryOutput(value: string): string {
  return stripVTControlCharacters(value).replaceAll('\0', '�').replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/gu, '�')
}
