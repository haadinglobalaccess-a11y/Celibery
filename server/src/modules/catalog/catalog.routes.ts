import { Router } from 'express';
import { ah } from '../../lib/http';
import { requireCustomer } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as c from './catalog.controller';
import { newsletterSchema, productListQuery, reviewSchema, slugParam } from './catalog.schemas';

export const catalogRoutes = Router();

catalogRoutes.get('/home', ah(c.home));
catalogRoutes.get('/settings/public', ah(c.settings));
catalogRoutes.get('/categories', ah(c.categories));
catalogRoutes.get('/categories/:slug', validate(slugParam, 'params'), ah(c.category));
catalogRoutes.get('/products', validate(productListQuery, 'query'), ah(c.products));
catalogRoutes.get('/products/:slug', validate(slugParam, 'params'), ah(c.product));
catalogRoutes.get('/products/:slug/reviews', validate(slugParam, 'params'), ah(c.productReviews));
catalogRoutes.post('/products/:slug/reviews', requireCustomer, validate(slugParam, 'params'), validate(reviewSchema), ah(c.submitReview));
catalogRoutes.get('/collections/:slug', validate(slugParam, 'params'), ah(c.collection));
catalogRoutes.get('/campaigns/:slug', validate(slugParam, 'params'), ah(c.campaign));
catalogRoutes.get('/pages/:slug', validate(slugParam, 'params'), ah(c.page));
catalogRoutes.post('/newsletter', validate(newsletterSchema), ah(c.newsletter));
