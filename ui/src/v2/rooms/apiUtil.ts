/** Extracts a `{error}` message from a failed fetch Response, falling back to the HTTP status. */
export async function parseErrorMessage(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* fall through */
  }
  return `HTTP ${resp.status}`;
}
