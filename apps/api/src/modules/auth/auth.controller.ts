import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from './auth.service';
import { sendSuccess, sendCreated } from '../../utils/response';
import { ValidationError } from '../../middleware/errors/errorHandler';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const signupSchema = z.object({
  clinicName: z.string().min(2, 'Clinic name must be at least 2 characters').max(200),
  email: z.string().email('Invalid email address'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  timezone: z.string().max(50).optional(),
  phone: z.string().max(30).optional(),
  country: z.string().max(50).optional(),
  state: z.string().max(50).optional(),
  city: z.string().max(100).optional(),
  currency: z.string().max(10).optional(),
  postalCode: z.string().max(20).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export async function signup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = signupSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Validation failed', result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })));
    }

    const data = await authService.signupClinic(result.data as any);
    sendCreated(res, data, 'Clinic account created successfully');
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Validation failed', result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })));
    }

    const data = await authService.loginUser(result.data as any);
    sendSuccess(res, data, 'Signed in successfully');
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = refreshSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Validation failed', result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })));
    }

    const data = await authService.refreshAccessToken(result.data.refreshToken);
    sendSuccess(res, data, 'Token refreshed');
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = refreshSchema.safeParse(req.body);
    if (result.success) {
      await authService.logoutUser(result.data.refreshToken);
    }
    sendSuccess(res, null, 'Signed out successfully');
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getMe(req.user!.userId);
    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = changePasswordSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Validation failed', result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })));
    }

    await authService.changePassword(
      req.user!.userId,
      result.data.currentPassword,
      result.data.newPassword
    );
    sendSuccess(res, null, 'Password changed successfully');
  } catch (err) {
    next(err);
  }
}
