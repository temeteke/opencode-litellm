import type { LiteLLMModel } from '../types'

/**
 * Decide whether a model must be invoked through the OpenAI Responses API
 * (`/v1/responses`) instead of `/v1/chat/completions`.
 *
 * The plugin registers every discovered model through the provider's runtime
 * package. That package is chosen once per provider, so a model that targets a
 * different API surface needs to be routed explicitly. LiteLLM reports this on
 * `/v1/model/info` as `mode: "responses"` for deployments configured with the
 * Responses API (for example `use_responses_api: true`).
 *
 * Only the explicit `mode` signal is used. Model-id heuristics (`gpt-5*`,
 * `o1/o3/o4*`) are deliberately not applied: an alias that merely looks like a
 * reasoning model may still be served through Chat Completions by the proxy,
 * and misrouting it would break a deployment the proxy reports as `chat`.
 */
export function requiresResponsesAPI(model: LiteLLMModel): boolean {
  return model.mode?.trim().toLowerCase() === 'responses'
}
