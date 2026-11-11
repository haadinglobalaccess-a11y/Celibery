import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/http';
import { requireCustomer } from '../../middleware/auth';
import { checkoutLimiter, quoteLimiter, trackingLimiter } from '../../middleware/security';
import { validate } from '../../middleware/validate';
import * as c from './order.controller';
import { checkoutSchema, orderNumberParam, quoteSchema, trackSchema } from './order.schemas';
import { RETURN_REASONS } from '../../models/ReturnRequest';

export const orderRoutes = Router();

const tokenBody = z.object({ token: z.string().trim().max(100).optional() });

orderRoutes.get('/checkout/options', ah(c.checkoutOptions));
orderRoutes.post('/cart/quote', quoteLimiter, validate(quoteSchema), ah(c.quote));
orderRoutes.post('/checkout', checkoutLimiter, validate(checkoutSchema), ah(c.checkout));
orderRoutes.get('/orders/track', trackingLimiter, validate(trackSchema, 'query'), ah(c.track));
orderRoutes.get('/orders/:orderNumber', trackingLimiter, validate(orderNumberParam, 'params'), ah(c.getOrder));
orderRoutes.post('/orders/:orderNumber/verify-payment', trackingLimiter, validate(orderNumberParam, 'params'), validate(tokenBody), ah(c.verifyPayment));
orderRoutes.post('/orders/:orderNumber/retry-payment', checkoutLimiter, validate(orderNumberParam, 'params'), validate(tokenBody), ah(c.retry));
orderRoutes.get('/me/orders', requireCustomer, ah(c.myOrders));

// Customer return requests (owner, guest access token, or staff).
const returnCreate = tokenBody.extend({
  items: z.array(z.object({ productId: z.string().regex(/^[a-f0-9]{24}$/i), quantity: z.number().int().min(1).max(99) })).min(1, 'Choose at least one item').max(50),
  reason: z.enum(RETURN_REASONS),
  details: z.string().trim().max(1000).default(''),
});
const returnParam = orderNumberParam.extend({ returnNumber: z.string().trim().toUpperCase().regex(/^RET-\d{1,10}$/) });
orderRoutes.get('/orders/:orderNumber/returns', trackingLimiter, validate(orderNumberParam, 'params'), ah(c.orderReturns));
orderRoutes.post('/orders/:orderNumber/returns', checkoutLimiter, validate(orderNumberParam, 'params'), validate(returnCreate), ah(c.requestReturn));
orderRoutes.post('/orders/:orderNumber/returns/:returnNumber/cancel', checkoutLimiter, validate(returnParam, 'params'), validate(tokenBody), ah(c.cancelReturn));
