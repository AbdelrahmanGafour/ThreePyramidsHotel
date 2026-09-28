import { Router } from 'express';
import { submitContactInquiryHandler } from './contact.controller';

export const contactRouter = Router();

contactRouter.post('/', submitContactInquiryHandler);
