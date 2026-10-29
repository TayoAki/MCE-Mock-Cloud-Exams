import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { HttpError, isDuplicateKey } from './errors.js';
import { uuid } from './ids.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = uuid();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

/** Metadata-only access log: never bodies, answers, emails or tokens. */
export const accessLog: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        request_id: req.requestId,
        method: req.method,
        route,
        status: res.statusCode,
        ms: Math.round(ms),
        user: req.user?._id,
      }),
    );
  });
  next();
};

export function parseBody<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new HttpError(400, 'validation_failed', 'The request body is invalid', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) {
    throw new HttpError(400, 'validation_failed', 'The query string is invalid', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ code: 'route_not_found', message: 'No such endpoint', request_id: req.requestId });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message, request_id: req.requestId, ...(err.details && { details: err.details }) });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ code: 'invalid_json', message: 'Malformed JSON body', request_id: req.requestId });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ code: 'payload_too_large', message: 'Request body too large', request_id: req.requestId });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({ code: 'validation_failed', message: err.message, request_id: req.requestId });
    return;
  }
  if (isDuplicateKey(err)) {
    res.status(409).json({ code: 'conflict', message: 'A conflicting record already exists', request_id: req.requestId });
    return;
  }
  console.error(JSON.stringify({ t: new Date().toISOString(), request_id: req.requestId, error: String(err?.stack ?? err) }));
  res.status(500).json({ code: 'internal_error', message: 'Something went wrong', request_id: req.requestId });
};

export const uuidParam = z.uuid();
export const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Path IDs that are not UUIDs cannot exist, so they are a 404 rather than a 400. */
export function idParam(req: Request, name = 'id'): string {
  const value = req.params[name];
  const parsed = uuidParam.safeParse(value);
  if (!parsed.success) throw new HttpError(404, 'not_found', 'Not found');
  return parsed.data;
}
