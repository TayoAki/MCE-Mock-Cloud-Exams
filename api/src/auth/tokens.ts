import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';

export const JWT_ISSUER = 'certpath-api';
export const JWT_AUDIENCE = 'certpath-clients';

export interface TokenClaims {
  sub: string;
  tv: number;
}

export function signToken(user: { _id: string; tokenVersion: number }): string {
  return jwt.sign({ tv: user.tokenVersion } satisfies Omit<TokenClaims, 'sub'>, config.JWT_SECRET, {
    subject: user._id,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256',
    expiresIn: config.JWT_TTL as SignOptions['expiresIn'],
  });
}
