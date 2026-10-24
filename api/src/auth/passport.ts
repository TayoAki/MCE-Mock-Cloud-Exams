import passport from 'passport';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { config } from '../config.js';
import { User, type UserRecord } from '../models/index.js';
import { JWT_AUDIENCE, JWT_ISSUER, type TokenClaims } from './tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Passport attaches the authenticated profile as req.user.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends UserRecord {}
  }
}

passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.JWT_SECRET,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    },
    (claims: TokenClaims, done: (err: unknown, user?: UserRecord | false) => void) => {
      User.findById(claims.sub)
        .lean<UserRecord>()
        .then((user) => {
          // A bumped tokenVersion revokes every token issued before it.
          if (!user || user.deletedAt || user.tokenVersion !== claims.tv) return done(null, false);
          return done(null, user);
        })
        .catch((err) => done(err));
    },
  ),
);

export { passport };
