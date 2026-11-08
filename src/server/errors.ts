export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 503,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const unavailable = () =>
  new AppError(
    503,
    'unavailable',
    'Generation is taking a holiday break. Your setup is saved. Please try again later.',
  );
export const errorMessage = (code: string | null) =>
  ({
    budget:
      'This cartoon reached the demo’s spending limit. Your successful scenes have been saved.',
    safety:
      'The generation service couldn’t accept this request. Please start again with different photos or descriptions.',
    technical:
      'One scene couldn’t finish within the automatic recovery limit. Your completed artwork is saved.',
    submission_unknown:
      'We couldn’t confirm one request with the generation service. We stopped to avoid charging twice.',
    timeout: 'The generation service didn’t finish in time. Your completed artwork is saved.',
    render: 'We couldn’t put the final video together. Your completed artwork is saved.',
    processing:
      'Media processing is temporarily unavailable. Your completed artwork is saved; we stopped further generation.',
  })[code ?? ''] ?? 'This cartoon couldn’t finish. Your completed artwork is saved.';
