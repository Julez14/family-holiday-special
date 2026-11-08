const moderationCodes = [
  'content_policy_violation',
  'model_moderated',
  'content_policy_violation:model_moderated',
] as const;
export const isModerationFailure = (code: string | null | undefined) =>
  moderationCodes.some((known) => known === code);

// Read machine codes only; never classify from an echoed prompt or free-form message.
export function providerFailureCategory(...errors: unknown[]): string {
  const found = new Set<string>();
  let remaining = 100;
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 6 || remaining-- <= 0) return;
    if (typeof value === 'string') {
      if (isModerationFailure(value)) value.split(':').forEach((code) => found.add(code));
      else if (value.length <= 65536 && /^[\s]*[\[{]/.test(value)) {
        try {
          visit(JSON.parse(value), depth + 1);
        } catch {
          /* Unknown error text. */
        }
      }
    } else if (Array.isArray(value)) {
      value.slice(0, 30).forEach((entry) => visit(entry, depth + 1));
    } else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      for (const key of [
        'type',
        'code',
        'error_type',
        'category',
        'categories',
        'detail',
        'error',
        'payload',
      ])
        visit(object[key], depth + 1);
    }
  };
  errors.forEach((error) => visit(error));
  return (
    ['content_policy_violation', 'model_moderated'].filter((code) => found.has(code)).join(':') ||
    'provider_rejected'
  );
}
