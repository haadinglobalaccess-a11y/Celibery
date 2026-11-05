import { z } from 'zod';

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const email = z.string().trim().toLowerCase().email().max(200);
export const saudiPhone = z
  .string()
  .trim()
  .regex(/^(\+?966|0)?5\d{8}$/, 'Enter a valid Saudi mobile number (05XXXXXXXX)');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  phone: saudiPhone.optional().or(z.literal('')),
  password,
  lang: z.enum(['ar', 'en']).default('ar'),
  marketingOptIn: z.boolean().optional().default(false),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const forgotSchema = z.object({ email, lang: z.enum(['ar', 'en']).optional() });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
