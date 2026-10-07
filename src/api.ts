export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Bluekite-Request': '1', ...options.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('연결을 확인한 뒤 다시 시도할 수 있습니다.', 0);
  }
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(body.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도할 수 있습니다.', response.status);
  }
  return body as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '잠시 후 다시 시도할 수 있습니다.';
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}
