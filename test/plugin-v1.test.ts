import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiteLLMPlugin } from '../src/plugin'
import { __resetOpenCodeAuthCacheForTests } from '../src/utils/opencode-auth'

interface ProviderConfig {
  npm?: string
  name?: string
  options?: Record<string, unknown>
  models?: Record<string, unknown>
}

interface OpenCodeConfig {
  provider: Record<string, ProviderConfig>
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe('OpenCode 1 config hook', () => {
  const originalFetch = globalThis.fetch
  let originalCacheHome: string | undefined
  let originalHome: string | undefined
  let originalLiteLLMApiKey: string | undefined
  let originalLiteLLMMasterKey: string | undefined
  let cacheDirectory: string
  let homeDirectory: string

  beforeEach(() => {
    originalCacheHome = process.env.XDG_CACHE_HOME
    originalHome = process.env.HOME
    originalLiteLLMApiKey = process.env.LITELLM_API_KEY
    originalLiteLLMMasterKey = process.env.LITELLM_MASTER_KEY
    delete process.env.LITELLM_API_KEY
    delete process.env.LITELLM_MASTER_KEY
    __resetOpenCodeAuthCacheForTests()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreEnv('XDG_CACHE_HOME', originalCacheHome)
    restoreEnv('HOME', originalHome)
    restoreEnv('LITELLM_API_KEY', originalLiteLLMApiKey)
    restoreEnv('LITELLM_MASTER_KEY', originalLiteLLMMasterKey)
    if (cacheDirectory) rmSync(cacheDirectory, { recursive: true, force: true })
    if (homeDirectory) rmSync(homeDirectory, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function useIsolatedState(): void {
    cacheDirectory = mkdtempSync(join(tmpdir(), 'opencode-litellm-v1-cache-'))
    homeDirectory = mkdtempSync(join(tmpdir(), 'opencode-litellm-v1-home-'))
    process.env.XDG_CACHE_HOME = cacheDirectory
    process.env.HOME = homeDirectory
  }

  function mockProxy(models: Array<{ id: string; mode?: string }>): void {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/model/info')) {
        return new Response(
          JSON.stringify({
            data: models.map((model) => ({
              model_name: model.id,
              model_info: { key: model.id, mode: model.mode ?? 'chat' },
            })),
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          data: models.map((model) => ({ id: model.id, object: 'model' })),
        }),
        { status: 200 },
      )
    })
  }

  async function runConfigHook(baseURL: string): Promise<OpenCodeConfig> {
    const input = { client: { app: { log: vi.fn(async () => {}) } } }
    const plugin = await LiteLLMPlugin(input as never)
    const config: OpenCodeConfig = {
      provider: {
        litellm: {
          npm: '@ai-sdk/openai-compatible',
          name: 'LiteLLM (proxy)',
          options: { baseURL, apiKey: 'example-key' },
          models: {},
        },
      },
    }
    await plugin.config!(config as never)
    return config
  }

  it('routes Responses models to a sibling provider, leaving chat models alone', async () => {
    useIsolatedState()
    const baseURL = 'http://127.0.0.1:45551/v1'
    mockProxy([
      { id: 'chat-model', mode: 'chat' },
      { id: 'responses-model', mode: 'responses' },
    ])

    const config = await runConfigHook(baseURL)

    expect(Object.keys(config.provider.litellm.models ?? {})).toEqual(['chat-model'])
    expect(config.provider.litellm.npm).toBe('@ai-sdk/openai-compatible')

    const sibling = config.provider['litellm-responses']
    expect(sibling).toBeDefined()
    expect(sibling.npm).toBe('@ai-sdk/openai')
    expect(sibling.options).toMatchObject({
      baseURL,
      apiKey: 'example-key',
    })
    expect(Object.keys(sibling.models ?? {})).toEqual(['responses-model'])
  })

  it('creates no sibling provider when no model needs the Responses API', async () => {
    useIsolatedState()
    const baseURL = 'http://127.0.0.1:45552/v1'
    mockProxy([
      { id: 'chat-model', mode: 'chat' },
      { id: 'completion-model', mode: 'completion' },
    ])

    const config = await runConfigHook(baseURL)

    expect(Object.keys(config.provider.litellm.models ?? {}).sort()).toEqual([
      'chat-model',
      'completion-model',
    ])
    expect(config.provider['litellm-responses']).toBeUndefined()
  })

  it('does not treat the Responses sibling as a chat provider on later passes', async () => {
    useIsolatedState()
    const baseURL = 'http://127.0.0.1:45553/v1'
    mockProxy([{ id: 'responses-model', mode: 'responses' }])

    const input = { client: { app: { log: vi.fn(async () => {}) } } }
    const plugin = await LiteLLMPlugin(input as never)
    const config: OpenCodeConfig = {
      provider: {
        litellm: {
          npm: '@ai-sdk/openai-compatible',
          name: 'LiteLLM (proxy)',
          options: { baseURL, apiKey: 'example-key' },
          models: {},
        },
      },
    }

    await plugin.config!(config as never)
    await plugin.config!(config as never)

    // A naive re-run would nest `litellm-responses-responses`.
    expect(Object.keys(config.provider).sort()).toEqual([
      'litellm',
      'litellm-responses',
    ])
    expect(Object.keys(config.provider['litellm-responses'].models ?? {})).toEqual([
      'responses-model',
    ])
  })

  it('does not duplicate a Responses model already curated on the chat side', async () => {
    useIsolatedState()
    const baseURL = 'http://127.0.0.1:45554/v1'
    mockProxy([{ id: 'responses-model', mode: 'responses' }])

    const input = { client: { app: { log: vi.fn(async () => {}) } } }
    const plugin = await LiteLLMPlugin(input as never)
    const config: OpenCodeConfig = {
      provider: {
        litellm: {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL, apiKey: 'example-key' },
          models: { 'responses-model': { name: 'Curated' } },
        },
      },
    }

    await plugin.config!(config as never)

    // The curated entry wins; the plugin leaves it where it is rather than
    // mirroring it into the sibling.
    expect(Object.keys(config.provider.litellm.models ?? {})).toContain('responses-model')
    expect(config.provider['litellm-responses']).toBeUndefined()
  })
})
