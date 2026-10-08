export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Bluekite-Request': '1',
        ...options.headers,
      },
    });
    if (
      response.status === 401 &&
      path !== '/api/login' &&
      !path.startsWith('/api/passkeys/login/')
    )
      window.dispatchEvent(new Event('session-expired'));
    const body = response.headers.get('Content-Type')?.includes('application/json')
      ? await response.json().catch((error) => {
          if (controller.signal.aborted) throw error;
          return null;
        })
      : null;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new ApiError(
        '서버 응답을 확인하지 못했습니다. 페이지를 새로고침해 주세요.',
        response.status || 502,
      );
    if (!response.ok) {
      const detail = (body as { error?: unknown }).error;
      throw new ApiError(
        typeof detail === 'string'
          ? detail
          : '요청을 처리하지 못했습니다. 잠시 후 다시 시도할 수 있습니다.',
        response.status,
      );
    }
    return body as T;
  } catch (error) {
    if (timedOut) throw new ApiError('연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.', 0);
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('연결을 확인한 뒤 다시 시도할 수 있습니다.', 0);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '잠시 후 다시 시도할 수 있습니다.';
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}
