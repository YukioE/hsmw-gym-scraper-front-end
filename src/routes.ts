import { Router } from "express";
import { scrapeTimeSlots, submitTimeSlots, setEditLink } from "./scrapeController.js";

const router = Router();

router.post("/scrape/", scrapeTimeSlots);
router.post("/submit/", submitTimeSlots);
router.post("/set-edit-link/", setEditLink);

export default router;
