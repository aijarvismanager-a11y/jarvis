import type { ImageProvider, ImageGenerateOptions, ImageResult } from './provider.ts';

type OpenAIImagesResponse = {
  data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
};

/**
 * OpenAI image generation (gpt-image-1 / dall-e-3). Always requests b64_json
 * so the caller gets bytes directly rather than a short-lived signed URL.
 */
export class OpenAIImageProvider implements ImageProvider {
  name = 'openai-image';
  private apiKey: string;
  private defaultModel: string;
  private baseUrl: string;

  constructor(apiKey: string, defaultModel = 'gpt-image-1', baseUrl = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async generate(prompt: string, options: ImageGenerateOptions = {}): Promise<ImageResult> {
    const model = options.model ?? this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: options.n ?? 1,
      size: options.size ?? '1024x1024',
    };
    // dall-e-3 accepts response_format; gpt-image-1 always returns b64_json
    // and rejects the field, so only send it for the legacy model.
    if (model.startsWith('dall-e')) {
      body.response_format = 'b64_json';
      if (options.quality) body.quality = options.quality;
    }

    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI Images API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as OpenAIImagesResponse;
    return {
      model,
      images: data.data.map((d) => {
        if (!d.b64_json) {
          throw new Error('OpenAI Images API returned a URL instead of base64 data (unexpected response_format).');
        }
        return { b64: d.b64_json, media_type: 'image/png', revised_prompt: d.revised_prompt };
      }),
    };
  }

  async listModels(): Promise<string[]> {
    return ['gpt-image-1', 'dall-e-3', 'dall-e-2'];
  }
}
