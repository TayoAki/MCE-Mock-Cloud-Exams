import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { passport } from './auth/passport.js';
import { config, corsOrigins } from './config.js';
import { accessLog, errorHandler, notFoundHandler, requestId } from './lib/http.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { circlesRouter } from './routes/circles.js';
import { learnerRouter } from './routes/learner.js';
import { meRouter } from './routes/me.js';
import { sessionsRouter } from './routes/sessions.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestId);
  if (config.NODE_ENV !== 'test') app.use(accessLog);
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, allowedHeaders: ['Authorization', 'Content-Type'], maxAge: 600 }));
  app.use(express.json({ limit: '64kb' }));
  app.use(passport.initialize());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const v1 = express.Router();
  v1.use(authRouter, learnerRouter, sessionsRouter, meRouter, circlesRouter, adminRouter);
  app.use('/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
