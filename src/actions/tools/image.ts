/**
 * Image Agent tools (spec section 33, Phase 8). Generates images through
 * ImageManager (src/image/manager.ts) and writes them to disk under
 * ~/.jarvis/images so the result is a stable file path other tools/agents
 * can reference, in addition to returning the bytes inline as an image
 * content block (same shape desktop_screenshot uses) so the calling model
 * can see what it made without a second tool round-trip.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult } from './registry.ts';
import type { ImageManager } from '../../image/manager.ts';
import type { ImageSize } from '../../image/provider.ts';
import { createImageGeneration } from '../../vault/image-generations.ts';

const IMAGES_DIR = join(homedir(), '.jarvis', 'images');

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Set once by the daemon at startup (mirrors how browser.ts's controller and
 * other singleton-backed tools are wired). Null until then, in which case
 * the tool reports a clear "not configured" error instead of throwing.
 */
let imageManager: ImageManager | null = null;

export function setImageManager(manager: ImageManager): void {
  imageManager = manager;
}

export const imageGenerateTool: ToolDefinition = {
  name: 'image_generate',
  description: 'Generate one or more images from a text prompt and save them to disk. Requires an image provider (OpenAI or Gemini) to be configured with an API key.',
  category: 'image',
  parameters: {
    prompt: { type: 'string', description: 'Description of the image to generate.', required: true },
    provider: { type: 'string', description: "Image provider to use ('openai-image' or 'gemini-image'). Defaults to the configured primary.", required: false },
    model: { type: 'string', description: 'Provider-specific model override.', required: false },
    n: { type: 'number', description: 'Number of images to generate (default 1).', required: false },
    size: { type: 'string', description: "Image size, e.g. '1024x1024'. Ignored by providers that don't support it.", required: false },
  },
  execute: async (params) => {
    if (!imageManager || !imageManager.hasProviders()) {
      return 'Error: no image providers configured. Set an OpenAI or Gemini API key for image generation first.';
    }

    const result = await imageManager.generate(params.prompt as string, {
      provider: params.provider as string | undefined,
      model: params.model as string | undefined,
      n: params.n as number | undefined,
      size: params.size as ImageSize | undefined,
    });

    mkdirSync(IMAGES_DIR, { recursive: true });

    const savedPaths: string[] = [];
    const content: ToolResult['content'] = [];
    for (const image of result.images) {
      const ext = EXT_BY_MIME[image.media_type] ?? 'png';
      const filePath = join(IMAGES_DIR, `${randomUUID()}.${ext}`);
      writeFileSync(filePath, Buffer.from(image.b64, 'base64'));
      savedPaths.push(filePath);
      content.push({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.b64 } });
    }

    const summaryLines = [
      `Generated ${result.images.length} image(s) with ${result.model}:`,
      ...savedPaths.map((p) => `  ${p}`),
    ];
    const revised = result.images.find((i) => i.revised_prompt)?.revised_prompt;
    if (revised) summaryLines.push(`Revised prompt: ${revised}`);

    try {
      createImageGeneration(params.prompt as string, result.provider, result.model, savedPaths, {
        revised_prompt: revised ?? null,
      });
    } catch (err) {
      console.warn('[image_generate] Failed to record generation history:', err);
    }

    content.unshift({ type: 'text', text: summaryLines.join('\n') });
    return { content } satisfies ToolResult;
  },
};

export const IMAGE_TOOLS: ToolDefinition[] = [imageGenerateTool];
