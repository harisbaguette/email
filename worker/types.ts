export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  LOGIN_LIMITER: RateLimit;
  MAIL_DOMAIN: string;
  PUBLIC_ORIGIN: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
