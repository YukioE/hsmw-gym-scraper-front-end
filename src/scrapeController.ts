import { Request, Response } from "express";
import { getBrowser } from "./browser.js";
import bcrypt from "bcrypt";
import fs from "fs";
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
    const clientEmail = req.cookies.email;

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
            const timeslots = await scrapeWeek(weekLink, clientPassword, clientEmail);
            return {
                link: weekLink,
                editLink: await getEditLink(weekLink, clientEmail),
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
    clientEmail: string
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
        await page.waitForSelector("table.results");
    }

    // extract timeslot headers and datetime from the table head
    const timeslots = await page.$$eval("table.results thead th", (headers) => {
        return Array.from(headers)
            .map((header) => {
                const id = header.getAttribute("id");
                const title = header.getAttribute("title");
                if (!id || !title) return null;
                return {
                    id,
                    datetime: title,
                    available: false,
                    selected: false,
                };
            })
            .filter(Boolean);
    });

    // extract timeslot availability from the table body
    const updatedTimeslots = await page.$$eval(
        "table.results tbody td",
        (cells, slots) => {
            return slots.map((slot) => {
                const cell = Array.from(cells).find((c) => c.getAttribute("headers") === slot.id);
                if (!cell) return slot;
                const isAvailable = cell.querySelector("li.yes") !== null;
                return {
                    ...slot,
                    available: isAvailable,
                };
            });
        },
        timeslots // pass to browser context
    );

    const selectedTimeslots = await getSelectedTimeslots(weekURL, password, clientEmail);

    const updatedTimeslotsWithSelection = updatedTimeslots.map((slot) => {
        if (selectedTimeslots && selectedTimeslots.includes(slot.id)) {
            return { ...slot, selected: true };
        }
        return slot;
    });

    await page.close();
    return updatedTimeslotsWithSelection;
};

const getEditLink = async (weekURL: string, clientEmail: string): Promise<string | null> => {
    const filename = weekURL.split("/").pop();

    if (!filename) {
        console.error("Invalid week URL:", weekURL);
        return null;
    }

    const editLinksJSON: string = await fs.promises.readFile(`./links/${filename}.json`, "utf8").catch((err) => {
        console.error("Error reading file:", err);
        return null;
    });

    const editLinks = JSON.parse(editLinksJSON || "{}");
    const editLink = editLinks[clientEmail];

    if (!editLink) {
        console.error("No edit link found for email:", clientEmail);
        return null;
    }

    return editLink;
};

const getSelectedTimeslots = async (weekURL: string, password: string, clientEmail: string): Promise<string[]> => {
    const editLink = await getEditLink(weekURL, clientEmail);

    if (!editLink) {
        console.error("No edit link found for email:", clientEmail);
        return [];
    }

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(editLink);

    // type password if input is present
    const passwordInput = await page.$("#password");
    if (passwordInput) {
        await page.type("#password", password);
        await page.click(".btn-success");
        await page.waitForSelector("table.results");
    }

    const selectedTimeslots = await page.$$eval("table.results tbody td", (cells) => {
        return cells
            .map((cell) => {
                const header = cell.getAttribute("headers");
                const yesInput = cell.querySelector("li.yes input[type=radio]") as HTMLInputElement | null;
                const isChecked = yesInput?.checked === true;
                return isChecked && header ? header : null;
            })
            .filter(Boolean);
    });
    console.log("Selected timeslots:", selectedTimeslots);

    await page.close();
    return selectedTimeslots;
};

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
                    const innerhtml = el.innerHTML;
                    return { href, innerhtml };
                })
                .filter(
                    ({ href }) =>
                        // https://terminplaner4.dfn.de/AZaz09AAZZaazz09
                        href !== null &&
                        href?.match(/^https:\/\/terminplaner4\.dfn\.de\/([A-Za-z0-9]*)$/) !== null
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
};

export const submitTimeSlots = async (req: Request, res: Response): Promise<void> => {
    const { PASSWORD: envHash, URL: url } = process.env;
    const clientPassword = req.cookies.password;
    const clientEmail = req.cookies.email;

    if (!url) {
        res.status(500).json({ error: "URL is not set in .env file" });
        return;
    }

    if (!clientPassword) {
        res.status(400).json({ error: "Password is missing" });
        return;
    }

    const correctPassword = await bcrypt.compare(clientPassword, envHash);

    if (!correctPassword) {
        res.status(403).json({ error: "Password is incorrect" });
        return;
    }

    const { weekLink, ids } = req.body as { weekLink: string; ids: string[] };

    if (!weekLink || !ids || ids.length === 0) {
        res.status(400).json({ error: "Week link or timeslot IDs are missing" });
        return;
    }

    // TODO: implement input of credentials and selected timeslots
};
