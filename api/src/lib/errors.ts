export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (code: string, message: string, details?: Record<string, unknown>) =>
  new HttpError(403, code, message, details);
export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new HttpError(409, code, message, details);

/** Plus features return 403 plus_required so clients can show the preview offer. */
export const plusRequired = (feature: string) =>
  forbidden('plus_required', 'This needs CertPath Plus. Your free plan keeps daily lessons and reviews.', {
    feature,
  });

export function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
