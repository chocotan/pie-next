import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadContext, formatContext } from '../server/plugins/context.ts'

async function fixture(): Promise<{ root: string; home: string; project: string }> {
  const root = await mkdtemp(join(tmpdir(), 'durable-context-'))
  const home = join(root, 'home')
  const project = join(root, 'project')
  await mkdir(join(home, '.agents', 'skills', 'global-skill'), { recursive: true })
  await mkdir(join(home, '.pie'), { recursive: true })
  await mkdir(join(project, 'sub'), { recursive: true })
  await mkdir(join(project, '.agents', 'skills', 'project-skill'), { recursive: true })
  await writeFile(join(home, '.agents', 'AGENTS.md'), 'global rules')
  await writeFile(join(home, '.agents', 'skills', 'global-skill', 'SKILL.md'), '---\nname: global-skill\ndescription: Global helper\n---\n\nBody.')
  await writeFile(join(project, 'AGENTS.md'), 'root rules')
  await writeFile(join(project, 'sub', 'AGENTS.md'), 'sub rules')
  await writeFile(join(project, '.agents', 'skills', 'project-skill', 'SKILL.md'), '---\nname: project-skill\ndescription: Project helper\n---\n\nBody.')
  return { root, home, project }
}

test('context loads global and ancestor AGENTS.md in root-to-leaf order', async () => {
  const { root, home, project } = await fixture()
  try {
    const info = loadContext(project, join(home, '.agents'), home)
    assert.deepEqual(info.agents.map(file => file.content), ['global rules', 'root rules'])
    assert.deepEqual(info.skills.map(skill => skill.name), ['global-skill', 'project-skill'])
    const nested = loadContext(join(project, 'sub'), join(home, '.agents'), home)
    assert.deepEqual(nested.agents.map(file => file.content), ['global rules', 'root rules', 'sub rules'])
    const prompt = formatContext(info) ?? ''
    assert.match(prompt, /<available_skills>/)
    assert.match(prompt, /<name>project-skill<\/name>/)
    assert.match(prompt, /Project helper/)
    assert.match(prompt, /AGENTS\.md/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('project skills override a global skill with the same name', async () => {
  const { root, home, project } = await fixture()
  try {
    await writeFile(join(project, '.agents', 'skills', 'project-skill', 'SKILL.md'), '---\nname: global-skill\ndescription: Project override\n---\n')
    const info = loadContext(project, join(home, '.agents'), home)
    assert.equal(info.skills.filter(skill => skill.name === 'global-skill').length, 1)
    assert.match(info.skills.find(skill => skill.name === 'global-skill')?.description ?? '', /Project override/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('context is omitted when no instructions or skills exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-context-empty-'))
  try {
    const info = loadContext(root, join(root, '.agents'), root)
    assert.deepEqual(info, { agents: [], skills: [] })
    assert.equal(formatContext(info), undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})
