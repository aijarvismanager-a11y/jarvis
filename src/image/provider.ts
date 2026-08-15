/**
 * Image generation provider contract (spec section 33, "Image Agent").
 * Deliberately kept SEPARATE from LLMProvider (src/llm/provider.ts) even
 * though it mirrors that interface's shape - image generation isn't a chat
 * turn, has its own request/response envelope, and shouldn't be reachable
 * through the tier system. See docs/AI_MANAGER_ARCHITECTURE_AUDIT.md Phase 8.
 */

export { classifyHttpStatus, classifyErrorString } from '../llm/provider.ts';
export type { LLMErrorCode as ImageErrorCode } from '../llm/provider.ts';

export type ImageSize = '256x256' | '512x512' | '1024x1024' | '1024x1536' | '1536x1024' | '1792x1024' | '1024x1792';

export type ImageGenerateOptions = {
  model?: string;
  /** Number of images to generate. Defaults to 1; providers may cap this. */
  n?: number;
  size?: ImageSize;
  /** Free-text style/quality hint. Providers that don't support it ignore it. */
  quality?: 'standard' | 'hd';
};

export type GeneratedImage = {
  /** Base64-encoded image bytes (no data: URI prefix). */
  b64: string;
  media_type: string; // e.g. "image/png"
  /** Provider-rewritten prompt, when the provider expands/safety-rewrites input. */
  revised_prompt?: string;
};

export type ImageResult = {
  images: GeneratedImage[];
  model: string;
};

export interface ImageProvider {
  name: string;
  generate(prompt: string, options?: ImageGenerateOptions): Promise<ImageResult>;
  listModels(): Promise<string[]>;
}
