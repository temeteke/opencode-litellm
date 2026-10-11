import { describe, expect, it } from 'vitest'
import { requiresResponsesAPI } from '../src/utils/transport'
import type { LiteLLMModel } from '../src/types'

function model(id: string, mode?: string): LiteLLMModel {
  return { id, object: 'model', mode }
}

describe('requiresResponsesAPI', () => {
  it('routes models LiteLLM reports with mode "responses"', () => {
    expect(requiresResponsesAPI(model('any-model', 'responses'))).toBe(true)
    expect(requiresResponsesAPI(model('any-model', 'Responses'))).toBe(true)
    expect(requiresResponsesAPI(model('any-model', '  responses  '))).toBe(true)
  })

  it('keeps chat and other modes on Chat Completions', () => {
    expect(requiresResponsesAPI(model('any-model', 'chat'))).toBe(false)
    expect(requiresResponsesAPI(model('any-model', 'completion'))).toBe(false)
    expect(requiresResponsesAPI(model('any-model'))).toBe(false)
  })

  it('does not guess from the model id alone', () => {
    // An alias that merely looks like a reasoning model may still be served
    // through Chat Completions; only the proxy's reported mode decides.
    expect(requiresResponsesAPI(model('gpt-5.4-pro'))).toBe(false)
    expect(requiresResponsesAPI(model('o3-mini'))).toBe(false)
  })
})
