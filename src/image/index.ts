// Image Agent (Phase 8): ImageProvider interface + adapters, kept as its own
// provider family (see docs/AI_MANAGER_ARCHITECTURE_AUDIT.md Phase 8).

export type { ImageProvider, ImageGenerateOptions, ImageResult, GeneratedImage, ImageSize, ImageErrorCode } from './provider.ts';
export { ImageManager } from './manager.ts';
export { OpenAIImageProvider } from './openai-image.ts';
export { GeminiImageProvider } from './gemini-image.ts';
export { registerImageProviders, getImageProviderKey, setImageProviderKey } from './config-binding.ts';
export type { ImageProviderName } from './config-binding.ts';
