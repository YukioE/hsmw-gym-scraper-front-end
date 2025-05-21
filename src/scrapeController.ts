import { Request, Response } from "express";
import { getBrowser } from "./browser.js";
import bcrypt from "bcrypt";
import { Timeslot, WeekResult } from "./utils.js";

/**
 * api route to scrape the time slots
 *
 * 1. scrape the main page for all weeks links
 * 2. scrape each week for the time slots
 * 3. return the results as JSON
 *
 * @param req - express request object
 * @param res - express response object
 * @returns {Promise<void>} - void
 */
export const scrapeTimeSlots = async (req: Request, res: Response): Promise<void> => {
    const { PASSWORD: envHash, URL: url } = process.env;
    const clientPassword = req.cookies.password;

    if (!url) {
        res.status(500).json({ error: "URL is not set in .env file" });
        return;
    }

    if (!clientPassword) {
        res.status(400).json({ error: "Password is missing" });
        return;
    }

    const correctPassword = await bcrypt.compare(clientPassword, envHash);

    // TODO: implement safety against brute force attacks
    if (!correctPassword) {
        res.status(403).json({ error: "Password is incorrect" });
        return;
    }

    const weeks = await getWeeks(url);

    // return if no weeks are currently available
    if (Object.keys(weeks).length == 0) {
        res.status(404).json({ error: "No weeks found" });
        return;
    }

    const results: WeekResult[] = await Promise.all(
        Object.entries(weeks).map(async ([weekNumber, weekLink]) => {
            const timeslots = await scrapeWeek(weekLink, clientPassword);
            return {
                link: weekLink,
                weekNumber: parseInt(weekNumber),
                timeslots,
            } satisfies WeekResult;
        })
    );

    // send the results as JSON to the client
    const data = JSON.stringify(results, null, 2);
    res.status(200).send(data);
    return;
};

const scrapeWeek = async (
    weekURL: string,
    password: string,
): Promise<Timeslot[]> => {
    // open new page and navigate to the week URL
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(weekURL);

    // type password if input is present
    const passwordInput = await page.$("#password");
    if (passwordInput) {
        await page.type("#password", password);
        await page.click(".btn-success");
        await page.waitForSelector(".results");
    }

    // id, datetime, available, selected
    const timeslots: Timeslot[] = [];

    // Extract all headers with IDs and titles
    await page.$$eval(".results thead th"

        // returns all the slots that are taken
        await page.$$eval(".results tbody td",



        await page.close();
    return slots;
};

const getSelectedTimeslots = async (weekURL: string): Promise<boolean[]> => {
    return null;
}


const getWeeks = async (url: string): Promise<Record<number, string>> => {
    // goto main url and wait for the page to load
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(url);

    //check if cookie banner is present and accept it
    const cookieBanner = await page.$("#privacySettingsModal");
    if (cookieBanner && !cookieBanner.boxModel()) {
        await page.click("#hsmwPrivacyAcceptAllButton");
    }

    await page.waitForSelector(".hsmw-main");

    // extract the week number and the corresponding link from the page
    const weeks: Record<number, string> = await page.$$eval(
        ".ext_link",
        (elements) => {
            const weeks: Record<number, string> = {};
            const weekLinks = elements
                .map((el) => {
                    const href = el.getAttribute("href");
                    const title = el.getAttribute("title");
                    const innerhtml = el.innerHTML;
                    return { href, title, innerhtml };
                })
                .filter(
                    ({ href, title }) =>
                        href?.includes("terminplaner") &&
                        title?.includes("Zur Trainingsanmeldung"),
                );

            weekLinks.forEach(({ href, innerhtml }) => {
                const weekNumber = parseInt(innerhtml.split(" ")[1]);
                weeks[weekNumber] = href;
            });

            return weeks;
        },
    );
    page.close();
    return weeks;
}
