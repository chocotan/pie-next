import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

const model = z.object({ provider: z.string().min(1), modelId: z.string().min(1) })
const schema = z.object({
  retry: z.object({
    enabled: z.boolean(),
    maxRetries: z.number().int().min(0).max(20),
    baseDelayMs: z.number().int().min(0).max(60_000),
    maxAgentDelayMs: z.number().int().min(0).max(600_000),
  }),
  compaction: z.object({ enabled: z.boolean() }),
  compactModel: model.nullish(),
})
export type RuntimeSettings = {
  retry: { enabled: boolean; maxRetries: number; baseDelayMs: number; maxAgentDelayMs: number }
  compaction: { enabled: boolean }
  compactModel?: { provider: string; modelId: string }
}
export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 60_000 },
  compaction: { enabled: true },
}

export class RuntimeSettingsStore {
  static async open(dataDir: string): Promise<RuntimeSettingsStore> {
    const path = resolve(dataDir, 'runtime.json')
    let state = structuredClone(DEFAULT_RUNTIME_SETTINGS)
    try {
      state = normalize(schema.parse(JSON.parse(await readFile(path, 'utf8'))))
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    return new RuntimeSettingsStore(path, state)
  }
  private constructor(private readonly path: string, private current: RuntimeSettings) {}
  get state(): RuntimeSettings { return structuredClone(this.current) }
  async save(input: unknown): Promise<RuntimeSettings> {
    const next = normalize(schema.parse(input))
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
    await rename(temporary, this.path)
    this.current = next
    return this.state
  }
}
function normalize(input: z.infer<typeof schema>): RuntimeSettings {
  return { retry: input.retry, compaction: input.compaction, ...(input.compactModel ? { compactModel: input.compactModel } : {}) }
}
