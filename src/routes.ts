import { Router } from 'express';
import { scrapeTimeSlots } from './scrapeController.js';

const router = Router();

router.post('/api', scrapeTimeSlots);

export default router;
