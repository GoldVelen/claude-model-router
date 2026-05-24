export function sanitizeForDeepseek(body: string): string {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;

    delete data.thinking;

    const tc = data.tool_choice as { type?: string } | undefined;
    if (tc?.type === 'any') {
      data.tool_choice = { type: 'auto' };
    }

    return JSON.stringify(data);
  } catch {
    return body;
  }
}
