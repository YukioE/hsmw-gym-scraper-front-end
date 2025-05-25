import { Request, Response } from "express";
import { getBrowser } from "./browser.js";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import { Timeslot, typePassword, WeekResult } from "./utils.js";
import { Page } from "puppeteer";
import { fileURLToPath } from "url";

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
    await typePassword(page, password);

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

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const linksDir = path.join(__dirname, "links");
    const filePath = path.join(linksDir, `${filename}.json`);

    const editLinksJSON: string = await fs.promises.readFile(filePath, "utf8").catch((err) => {
        console.error("Error reading file:", err);
        return null;
    });

    const editLinks = JSON.parse(editLinksJSON || "{}");
    const editLink = editLinks[clientEmail];

    if (!editLink) {
        return null;
    }

    return editLink;
};

const saveEditLink = async (weekURL: string, clientEmail: string, editLink: string): Promise<void> => {
    const filename = weekURL.split("/").pop();

    if (!filename) {
        console.error("Invalid week URL:", weekURL);
        return;
    }

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const linksDir = path.join(__dirname, "links");
    await fs.promises.mkdir(linksDir, { recursive: true });

    // read existing edit links or create a new object
    let editLinks: Record<string, string> = {};
    const filePath = path.join(linksDir, `${filename}.json`);
    try {
        const data = await fs.promises.readFile(filePath, "utf8");
        editLinks = JSON.parse(data);
    } catch (err) {
        console.warn("No existing edit links found, creating a new file.");
    }

    // update the edit link for the client email
    editLinks[clientEmail] = editLink;

    // write the updated edit links back to the file
    await fs.promises.writeFile(filePath, JSON.stringify(editLinks, null, 2), "utf8");
};

const getSelectedTimeslots = async (weekURL: string, password: string, clientEmail: string, page?: Page): Promise<string[]> => {
    const editLink = await getEditLink(weekURL, clientEmail);

    if (!editLink) {
        return [];
    }

    const browser = await getBrowser();
    let ownPage = false;
    if (!page) {
        page = await browser.newPage();
        ownPage = true;
        await page.goto(editLink);
    }

    // type password if input is present
    await typePassword(page, password);

    // get all selected timeslot ids from the table ("C0", "C1", etc.)
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

    if (ownPage) {
        await page.close();
    }

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
    const clientUsername = req.cookies.username;
    const clientEmail = req.cookies.email;

    if (!clientUsername || !clientEmail) {
        res.status(400).json({ error: "Username or email is missing" });
        return;
    }

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

    if (!weekLink || !ids) {
        res.status(400).json({ error: "Week link or timeslot IDs are missing" });
        return;
    }

    const editLink = await getEditLink(weekLink, clientEmail);

    if (editLink) {
        await submitTimeslotsEditLink(weekLink, editLink, ids, clientPassword, clientEmail);
    } else {
        await submitTimeslotsNormal(weekLink, ids, clientUsername, clientEmail, clientPassword);
    }

    res.status(200).json({ message: "Timeslots submitted successfully" });
    return;
};

const submitTimeslotsNormal = async (weekLink: string, ids: string[], clientUsername: string, clientEmail: string, password: string): Promise<void> => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(weekLink);

    await typePassword(page, password);

    // select the new timeslots with the given ids
    await page.$$eval("table.results tbody td", (cells, ids) => {
        cells.forEach((cell) => {
            const header = cell.getAttribute("headers");
            if (header && ids.includes(header)) {
                const yesInput = cell.querySelector("li.yes input[type=radio]") as HTMLInputElement | null;
                if (yesInput) yesInput.setAttribute("checked", "");
            }
        });
    }, ids);

    const usernameInput = await page.$("#name");
    const emailInput = await page.$("#mail");

    if (usernameInput && emailInput) {
        await usernameInput.type(clientUsername);
        await emailInput.type(clientEmail);
    }

    const submitButton = await page.$("table.results button[name='save']");
    if (submitButton) {
        await submitButton.click();
        await page.waitForNavigation({ waitUntil: "networkidle0" });
        console.log("Timeslots submitted successfully");
    } else {
        console.error("Submit button not found on edit link page");
    }

    const editLinkInput = await page.$("#email");
    const editLinkSubmitButton = await page.$("#send_edit_link_submit");
    const editLink = await page.$eval(".alert-success div.input-group.input-group-sm input.form-control", (input) => (input as HTMLInputElement).value.trim());

    if (editLinkInput && editLinkSubmitButton) {
        await editLinkInput.type(clientEmail);
        await editLinkSubmitButton.click();
    }

    await saveEditLink(weekLink, clientEmail, editLink);

    await page.close();
};

const submitTimeslotsEditLink = async (weekLink: string, editLink: string, ids: string[], password: string, clientEmail: string): Promise<void> => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(editLink);

    await typePassword(page, password);

    const selectedIDs = await getSelectedTimeslots(weekLink, password, clientEmail, page);

    // deselect all selected timeslots
    await page.$$eval("table.results tbody td", (cells, selectedIDs) => {
        cells.forEach((cell) => {
            const header = cell.getAttribute("headers");
            if (header && selectedIDs.includes(header)) {
                cell.querySelector("li.yes input[type=radio]")?.removeAttribute("checked");
            }
        });
    }, selectedIDs);

    const submitButton = await page.$("table.results button[name='save']");
    if (submitButton) {
        await submitButton.click();
        await page.waitForNavigation({ waitUntil: "networkidle0" });
    } else {
        console.error("Submit button not found on edit link page");
    }

    // reload the page to ensure the changes are applied
    await page.goto(editLink);
    await typePassword(page, password);

    // select the new timeslots with the given ids
    await page.$$eval("table.results tbody td", (cells, ids) => {
        cells.forEach((cell) => {
            const header = cell.getAttribute("headers");
            if (header && ids.includes(header)) {
                const yesInput = cell.querySelector("li.yes input[type=radio]") as HTMLInputElement | null;
                if (yesInput) yesInput.setAttribute("checked", "");
            }
        });
    }, ids);

    const newSubmitButton = await page.$("table.results .btn-edit .btn-success");
    if (newSubmitButton) {
        await newSubmitButton.click();
        await page.waitForNavigation({ waitUntil: "networkidle0" });
    } else {
        console.error("Submit button not found on edit link page");
    }

    await page.close();
};
