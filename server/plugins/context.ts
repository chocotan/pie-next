import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { defineExtension, section } from '@earendil-works/pi-durable'
import { z } from 'zod'
import type { HostPlugin } from '../plugin-runtime.ts'

export type SkillInfo = { name: string; description: string; path: string }
export type ContextInfo = { agents: Array<{ path: string; content: string }>; skills: SkillInfo[] }

const AGENT_FILES = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']
const MAX_SKILLS = 200
const MAX_AGENT_FILE_BYTES = 128 * 1024

function readAgentFile(dir: string): { path: string; content: string } | undefined {
  for (const name of AGENT_FILES) {
    const path = join(dir, name)
    try {
      if (!existsSync(path) || !statSync(path).isFile()) continue
      const content = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
      // shortcut: oversized instruction files are truncated; add summarization if a project needs full fidelity.
      return { path, content: content.length > MAX_AGENT_FILE_BYTES ? `${content.slice(0, MAX_AGENT_FILE_BYTES)}\n\n[truncated]` : content }
    } catch { /* Unreadable files are skipped like pi's loader. */ }
  }
  return undefined
}

function frontmatter(text: string): { data: Record<string, string>; body: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!block) return { data: {}, body: text }
  const data: Record<string, string> = {}
  for (const line of block[1]!.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match) data[match[1]!] = match[2]!.replace(/^["']|["']$/g, '').trim()
  }
  return { data, body: text.slice(block[0].length) }
}

function loadSkill(file: string): SkillInfo | undefined {
  try {
    const { data, body } = frontmatter(readFileSync(file, 'utf8'))
    const name = data.name || (basename(file) === 'SKILL.md' ? basename(dirname(file)) : basename(file).replace(/\.md$/i, ''))
    const description = data.description || body.trim().split(/\r?\n/).find(line => line.trim())?.slice(0, 200) || name
    return { name, description, path: file }
  } catch { return undefined }
}

function scanSkills(root: string, found: SkillInfo[]): void {
  if (found.length >= MAX_SKILLS) return
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return }
  const skillFile = entries.find(entry => entry.isFile() && entry.name === 'SKILL.md')
  if (skillFile) {
    const skill = loadSkill(join(root, skillFile.name))
    if (skill) found.push(skill)
    return
  }
  for (const entry of entries) {
    if (found.length >= MAX_SKILLS) return
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') scanSkills(join(root, entry.name), found)
    else if (entry.isFile() && entry.name.endsWith('.md')) {
      const skill = loadSkill(join(root, entry.name))
      if (skill) found.push(skill)
    }
  }
}

export function loadContext(cwd: string, agentDir = join(homedir(), '.agents'), homeDir = homedir()): ContextInfo {
  const agents: ContextInfo['agents'] = []
  const seen = new Set<string>()
  const add = (file: { path: string; content: string } | undefined): void => {
    if (!file || seen.has(file.path)) return
    seen.add(file.path)
    agents.push(file)
  }
  add(readAgentFile(agentDir))
  add(readAgentFile(join(homeDir, '.pie')))
  const ancestors: Array<{ path: string; content: string }> = []
  let dir = resolve(cwd)
  for (;;) {
    const file = readAgentFile(dir)
    if (file && !seen.has(file.path)) { seen.add(file.path); ancestors.unshift(file) }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  agents.push(...ancestors)

  const skills: SkillInfo[] = []
  for (const root of [join(homeDir, '.agents', 'skills'), join(homeDir, '.pie', 'skills'), join(resolve(cwd), '.agents', 'skills'), join(resolve(cwd), '.pie', 'skills')]) scanSkills(root, skills)
  const unique = [...new Map(skills.map(skill => [skill.name, skill])).values()]
  return { agents, skills: unique }
}

const escapeXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function formatContext(context: ContextInfo): string | undefined {
  const parts: string[] = []
  if (context.agents.length) parts.push(`Project and user instructions:\n\n${context.agents.map(file => `## ${file.path}\n\n${file.content}`).join('\n\n')}`)
  if (context.skills.length) parts.push(['The following skills provide specialized instructions for specific tasks.', "Use the read tool to load a skill's file when the task matches its description.", 'When a skill file references a relative path, resolve it against the skill directory.', '', '<available_skills>', ...context.skills.map(skill => `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n    <location>${escapeXml(skill.path)}</location>\n  </skill>`), '</available_skills>'].join('\n'))
  return parts.length ? parts.join('\n\n') : undefined
}

export function createContextPlugin(cwd: string, agentDir?: string): HostPlugin {
  return {
    id: 'context',
    register(ctx) {
      // shortcut: discovery runs at host open; editing AGENTS.md needs a workspace reload until a watcher is added.
      const info = loadContext(cwd, agentDir)
      const prompt = formatContext(info)
      if (prompt) ctx.extension(defineExtension({ name: 'app.context', sections: [section('context', async () => prompt)] }))
      ctx.command('context.list', z.object({}), async () => info)
    },
  }
}
