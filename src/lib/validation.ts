import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from './auth/password';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export const uuidField = z.string().regex(UUID_RE, 'معرّف غير صالح');

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('البريد الإلكتروني غير صحيح').max(254));

export const nameField = z.string().trim().min(2, 'الاسم قصير جداً').max(100, 'الاسم طويل جداً');

export const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `كلمة المرور يجب ألا تقل عن ${PASSWORD_MIN_LENGTH} أحرف`)
  .max(200, 'كلمة المرور طويلة جداً');

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'بيانات غير صحيحة';
}

export function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}
