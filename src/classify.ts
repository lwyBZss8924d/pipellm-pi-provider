export type Verdict = 'PASSTHROUGH' | 'SUBSTITUTED' | 'ERROR';

export function promptTokens(usage: Record<string, unknown> | undefined): number | undefined {
  const values = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
    .map((key) => usage?.[key])
    .filter((value) => value !== undefined);
  if (
    !values.length ||
    values.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
  )
    return undefined;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}

function errorMessage(response: any): string {
  return String(response?.error?.message ?? response?.error ?? '');
}

export function retryForcedToolChoice(status: number, response: unknown): boolean {
  const message = errorMessage(response);
  return (
    status === 400 &&
    /not supported|not support|unsupported|not allowed|reject/i.test(message) &&
    (/tool_choice/i.test(message) || (/\btool\b/i.test(message) && /\bany\b/i.test(message)))
  );
}

export function isTransientError(status: number, response: unknown): boolean {
  return (
    status === 0 ||
    status === 429 ||
    status >= 500 ||
    (status === 400 && /not available for channel program accounts/i.test(errorMessage(response)))
  );
}

export function classifyResponse(
  status: number,
  requestedTools: readonly string[],
  response: any,
): Verdict {
  if (status !== 200 || !Array.isArray(response?.content)) return 'ERROR';
  return response.content.some(
    (block: any) => block?.type === 'tool_use' && !requestedTools.includes(block.name),
  )
    ? 'SUBSTITUTED'
    : 'PASSTHROUGH';
}

export function classifySize(
  small: Record<string, unknown>,
  large: Record<string, unknown>,
): Exclude<Verdict, 'ERROR'> | 'UNKNOWN' {
  const before = promptTokens(small),
    after = promptTokens(large);
  if (before === undefined || after === undefined) return 'UNKNOWN';
  return after > before + 500 ? 'PASSTHROUGH' : 'SUBSTITUTED';
}
