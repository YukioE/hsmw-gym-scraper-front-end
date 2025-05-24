import { Router } from "express";
import { scrapeTimeSlots, submitTimeSlots } from "./scrapeController.js";

const router = Router();

router.post("/scrape/", scrapeTimeSlots);
router.post("/submit/", submitTimeSlots);

export default router;
