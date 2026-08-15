/**
 * Wires image providers into an ImageManager from encrypted keychain secrets
 * (src/vault/keychain.ts), same convention as GitHub's `github_token`
 * (src/github/api.ts) rather than the full config.yaml/DB provider-map
 * machinery LLM providers use - image generation doesn't need per-tier
 * routing, so a lighter credential story is enough for Phase 8. Secret names
 * follow the `image.provider.<name>.api_key` shape already used for LLM
 * keychain overrides (see src/daemon/api-routes.ts).
 */

import { getSecret, setSecret } from '../vault/keychain.ts';
import type { ImageManager } from './manager.ts';
import { OpenAIImageProvider } from './openai-image.ts';
import { GeminiImageProvider } from './gemini-image.ts';

export type ImageProviderName = 'openai-image' | 'gemini-image';

function secretKey(name: string): string {
  return `image.provider.${name}.api_key`;
}

export function getImageProviderKey(name: ImageProviderName): string | null {
  return getSecret(secretKey(name));
}

export function setImageProviderKey(name: ImageProviderName, apiKey: string): void {
  setSecret(secretKey(name), apiKey);
}

/**
 * Register every image provider that has a configured key. Returns the
 * number of providers registered so callers can warn when none are
 * available, same pattern as registerLLMProviders' `hasProvider` bool.
 */
export function registerImageProviders(manager: ImageManager): number {
  let count = 0;

  const openaiKey = getImageProviderKey('openai-image');
  if (openaiKey) {
    manager.registerProvider(new OpenAIImageProvider(openaiKey));
    count++;
  }

  const geminiKey = getImageProviderKey('gemini-image');
  if (geminiKey) {
    manager.registerProvider(new GeminiImageProvider(geminiKey));
    count++;
  }

  if (count > 1) {
    manager.setFallbackChain(manager.getProviderNames().slice(1));
  }

  return count;
}
