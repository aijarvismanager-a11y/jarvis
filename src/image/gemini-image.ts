import type { ImageProvider, ImageGenerateOptions, ImageResult } from './provider.ts';

type ImagenPredictResponse = {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
};

/**
 * Google Imagen via the Generative Language API's `:predict` endpoint.
 * Same auth convention as GeminiProvider (src/llm/gemini.ts): API key on the
 * query string, no bearer header.
 */
export class GeminiImageProvider implements ImageProvider {
  name = 'gemini-image';
  private apiKey: string;
  private defaultModel: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(apiKey: string, defaultModel = 'imagen-3.0-generate-002') {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async generate(prompt: string, options: ImageGenerateOptions = {}): Promise<ImageResult> {
    const model = options.model ?? this.defaultModel;
    const url = `${this.baseUrl}/models/${model}:predict?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: options.n ?? 1 },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini Images API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as ImagenPredictResponse;
    const predictions = data.predictions ?? [];
    if (predictions.length === 0) {
      throw new Error('Gemini Images API returned no predictions (likely blocked by safety filters).');
    }

    return {
      model,
      images: predictions.map((p) => {
        if (!p.bytesBase64Encoded) {
          throw new Error('Gemini Images API prediction missing bytesBase64Encoded.');
        }
        return { b64: p.bytesBase64Encoded, media_type: p.mimeType ?? 'image/png' };
      }),
    };
  }

  async listModels(): Promise<string[]> {
    return ['imagen-3.0-generate-002', 'imagen-3.0-fast-generate-001'];
  }
}
