import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/http';
import { requireCustomer } from '../../middleware/auth';
import { checkoutLimiter, trackingLimiter } from '../../middleware/security';
import { validate } from '../../middleware/validate';
import * as c from './order.controller';
import { checkoutSchema, orderNumberParam, quoteSchema, trackSchema } from './order.schemas';

export const orderRoutes = Router();

const tokenBody = z.object({ token: z.string().trim().max(100).optional() });

orderRoutes.get('/checkout/options', ah(c.checkoutOptions));
orderRoutes.post('/cart/quote', validate(quoteSchema), ah(c.quote));
orderRoutes.post('/checkout', checkoutLimiter, validate(checkoutSchema), ah(c.checkout));
orderRoutes.get('/orders/track', trackingLimiter, validate(trackSchema, 'query'), ah(c.track));
orderRoutes.get('/orders/:orderNumber', trackingLimiter, validate(orderNumberParam, 'params'), ah(c.getOrder));
orderRoutes.post('/orders/:orderNumber/verify-payment', trackingLimiter, validate(orderNumberParam, 'params'), validate(tokenBody), ah(c.verifyPayment));
orderRoutes.post('/orders/:orderNumber/retry-payment', checkoutLimiter, validate(orderNumberParam, 'params'), validate(tokenBody), ah(c.retry));
orderRoutes.get('/me/orders', requireCustomer, ah(c.myOrders));
