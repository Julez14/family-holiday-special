export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body && typeof options.body === 'string'
        ? { 'content-type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });
  const data = (await response.json()) as T & { message?: string; code?: string };
  if (!response.ok)
    throw new ApiError(
      data.message ?? 'Something went wrong. Please try again.',
      response.status,
      data.code ?? 'unknown',
    );
  return data;
}
