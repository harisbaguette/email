export interface Env {
  MFA_ENCRYPTION_KEY?: string;
  DB: D1Database;
  ASSETS: Fetcher;
  LOGIN_LIMITER: RateLimit;
  API_LIMITER: RateLimit;
  DOWNLOAD_LIMITER: RateLimit;
  MAIL_DOMAIN: string;
  PUBLIC_ORIGIN: string;
  TYPESAFE_API_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfter = 900) { super(message); }
}
