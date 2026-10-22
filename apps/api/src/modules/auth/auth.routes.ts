import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/authentication/authenticate';
import * as authController from './auth.controller';

export const authRouter = Router();

// Rate limiting for auth endpoints (protective against brute force while permitting normal clinic usage)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Too many authentication attempts. Please try again later.', data: null },
  standardHeaders: true,
  legacyHeaders: false,
});

authRouter.post('/signup', authLimiter, authController.signup);
authRouter.post('/login', authLimiter, authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', authenticate, authController.getMe);
authRouter.put('/me/password', authenticate, authController.changePassword);
