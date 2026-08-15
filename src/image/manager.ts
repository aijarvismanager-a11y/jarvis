import type { ImageProvider, ImageGenerateOptions, ImageResult } from './provider.ts';
import { classifyErrorString } from './provider.ts';
import { recordUsage } from '../llm/usage.ts';

/**
 * Image-generation counterpart to LLMManager (src/llm/manager.ts), stripped
 * down to what image generation actually needs: no tiers (image requests
 * aren't tiered by conversational cost/quality), just a primary provider with
 * an ordered fallback chain and per-provider retry. Usage is still recorded
 * through the shared llm_usage table (subsystem-labeled) so cost tracking
 * covers image spend alongside chat spend without a parallel table.
 */
export class ImageManager {
  private providers: Map<string, ImageProvider> = new Map();
  private primaryProvider = '';
  private fallbackChain: string[] = [];
  private static readonly MAX_RETRIES_PER_PROVIDER = 2;

  registerProvider(provider: ImageProvider): void {
    this.providers.set(provider.name, provider);
    if (!this.primaryProvider) this.primaryProvider = provider.name;
  }

  setPrimary(name: string): void {
    if (!this.providers.has(name)) throw new Error(`Image provider '${name}' not registered`);
    this.primaryProvider = name;
  }

  setFallbackChain(names: string[]): void {
    for (const name of names) {
      if (!this.providers.has(name)) throw new Error(`Image provider '${name}' not registered`);
    }
    this.fallbackChain = names;
  }

  getProvider(name: string): ImageProvider | undefined {
    return this.providers.get(name);
  }

  getProviderNames(): string[] {
    return [...this.providers.keys()];
  }

  hasProviders(): boolean {
    return this.providers.size > 0;
  }

  private getProviderSequence(primaryOverride?: string | null): string[] {
    const primary = primaryOverride && this.providers.has(primaryOverride) ? primaryOverride : this.primaryProvider;
    return [primary, ...this.fallbackChain.filter((name) => name !== primary)].filter(Boolean);
  }

  /**
   * Generate images, trying the requested/primary provider then falling
   * through the configured chain. Records usage per attempt (subsystem
   * "image") so failed providers still show up in cost/reliability queries.
   */
  async generate(
    prompt: string,
    options?: ImageGenerateOptions & { provider?: string },
  ): Promise<ImageResult & { provider: string }> {
    const sequence = this.getProviderSequence(options?.provider ?? null);
    if (sequence.length === 0) {
      throw new Error('No image providers configured.');
    }

    const failures: string[] = [];
    for (const providerName of sequence) {
      const provider = this.providers.get(providerName);
      if (!provider) {
        failures.push(`Provider '${providerName}' not registered`);
        continue;
      }

      const errors: string[] = [];
      for (let attempt = 1; attempt <= ImageManager.MAX_RETRIES_PER_PROVIDER; attempt++) {
        const started = Date.now();
        try {
          const result = await provider.generate(prompt, options);
          recordUsage({
            tier: 'medium',
            resolved_tier: 'medium',
            subsystem: 'image',
            provider: provider.name,
            model: result.model,
            input_tokens: 0,
            output_tokens: 0,
            latency_ms: Date.now() - started,
          });
          return { ...result, provider: provider.name };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`attempt ${attempt}: ${errorMsg}`);
          recordUsage({
            tier: 'medium',
            resolved_tier: 'medium',
            subsystem: 'image',
            provider: provider.name,
            model: options?.model ?? '',
            input_tokens: 0,
            output_tokens: 0,
            latency_ms: Date.now() - started,
            error_code: classifyErrorString(errorMsg),
          });
        }
      }
      failures.push(`Provider '${providerName}' failed after ${errors.length} attempt(s):\n${errors.map((e) => `  ${e}`).join('\n')}`);
    }

    throw new Error(failures.join('\n\n'));
  }
}
