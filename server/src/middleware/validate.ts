import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from '../lib/errors';

type Part = 'body' | 'query' | 'params';

/** Validates and replaces req[part] with the parsed (typed, stripped) value. */
export const validate =
  (schema: ZodTypeAny, part: Part = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(badRequest('VALIDATION_ERROR', 'Some fields are invalid', result.error.flatten()));
    }
    if (part === 'query') {
      // req.query is a getter in some Express versions; store parsed copy instead.
      (req as unknown as { validatedQuery: unknown }).validatedQuery = result.data;
    } else {
      (req as unknown as Record<string, unknown>)[part] = result.data;
    }
    next();
  };

export function q<T extends ZodTypeAny>(req: Request, _schema?: T): z.infer<T> {
  return (req as unknown as { validatedQuery: z.infer<T> }).validatedQuery;
}
