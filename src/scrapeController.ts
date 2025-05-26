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
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.goto(weekURL, { waitUntil: "networkidle2", timeout: 10000 });

        await typePassword(page, password);

        // Extract timeslot headers
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

        // Extract availability
        const updatedTimeslots = await page.$$eval(
            "table.results tbody td",
            (cells, slots) => {
                return slots.map((slot) => {
                    const cell = Array.from(cells).find((c) => c.getAttribute("headers") === slot.id);
                    const isAvailable = !!cell?.querySelector("li.yes");
                    return { ...slot, available: isAvailable };
                });
            },
            timeslots
        );

        // Get selected timeslots
        const selectedTimeslots = await getSelectedTimeslots(weekURL, password, clientEmail, page);

        // Merge selection info
        const updatedTimeslotsWithSelection = updatedTimeslots.map((slot) => ({
            ...slot,
            selected: selectedTimeslots.includes(slot.id),
        }));

        return updatedTimeslotsWithSelection;
    } catch (err) {
        console.error("scrapeWeek failed:", err);
        return [];
    } finally {
        try {
            await page.close();
        } catch (closeErr) {
            console.warn("Failed to close page:", closeErr);
        }
    }
};

const getEditLink = async (weekURL: string, clientEmail: string): Promise<string | null> => {
    try {
        const filename = weekURL.split("/").pop();

        if (!filename) {
            console.error("Invalid week URL (no filename found):", weekURL);
            return null;
        }

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);

        const linksDir = path.join(__dirname, "links");
        const filePath = path.join(linksDir, `${filename}.json`);

        if (!fs.existsSync(filePath)) {
            console.warn(`Link file does not exist: ${filePath}`);
            return null;
        }

        const fileContent = await fs.promises.readFile(filePath, "utf8");

        let editLinks: Record<string, string> = {};
        try {
            editLinks = JSON.parse(fileContent);
        } catch (jsonErr) {
            console.error("Failed to parse edit link JSON:", jsonErr);
            return null;
        }

        const editLink = editLinks[clientEmail];
        if (!editLink) {
            console.warn(`No edit link found for email: ${clientEmail}`);
            return null;
        }

        return editLink;
    } catch (err) {
        console.error("Unhandled error in getEditLink:", err);
        return null;
    }
};

const saveEditLink = async (
    weekURL: string,
    clientEmail: string,
    editLink: string
): Promise<void> => {
    const filename = weekURL.split("/").pop();

    if (!filename) {
        console.error("Invalid week URL:", weekURL);
        return;
    }

    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);

        const linksDir = path.join(__dirname, "links");
        await fs.promises.mkdir(linksDir, { recursive: true });

        const filePath = path.join(linksDir, `${filename}.json`);

        // read existing edit links or start with empty object
        let editLinks: Record<string, string> = {};
        try {
            const data = await fs.promises.readFile(filePath, "utf8");
            editLinks = JSON.parse(data);
        } catch (err) {
            // File might not exist or JSON might be invalid
            console.warn("No existing edit links found or failed to parse, creating a new file.");
        }

        // update the edit link for the client email
        editLinks[clientEmail] = editLink;

        // write the updated edit links back to the file
        await fs.promises.writeFile(filePath, JSON.stringify(editLinks, null, 2), "utf8");

    } catch (err) {
        console.error("Error saving edit link:", err);
    }
};

const getSelectedTimeslots = async (
    weekURL: string,
    password: string,
    clientEmail: string,
    page?: Page
): Promise<string[]> => {
    const editLink = await getEditLink(weekURL, clientEmail);
    if (!editLink) {
        return [];
    }

    const browser = await getBrowser();
    let ownPage = false;
    let currentPage: Page | undefined = page;

    try {
        if (!currentPage) {
            currentPage = await browser.newPage();
            ownPage = true;
            await currentPage.goto(editLink);
        }

        await typePassword(currentPage, password);

        const selectedTimeslots = await currentPage.$$eval("table.results tbody td", (cells) => {
            return cells
                .map((cell) => {
                    const header = cell.getAttribute("headers");
                    const yesInput = cell.querySelector("li.yes input[type=radio]") as HTMLInputElement | null;
                    const isChecked = yesInput?.checked === true;
                    return isChecked && header ? header : null;
                })
                .filter(Boolean);
        });

        return selectedTimeslots as string[];
    } catch (err) {
        console.error("Failed to get selected timeslots:", err);
        return [];
    } finally {
        if (ownPage && currentPage) {
            try {
                await currentPage.close();
            } catch (closeErr) {
                console.warn("Error closing Puppeteer page:", closeErr);
            }
        }
    }
};

const getWeeks = async (url: string): Promise<Record<number, string>> => {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.goto(url);

        await page.waitForSelector(".hsmw-main");

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
                            href !== null &&
                            /^https:\/\/terminplaner4\.dfn\.de\/[A-Za-z0-9]*$/.test(href)
                    );

                weekLinks.forEach(({ href, innerhtml }) => {
                    const weekNumber = parseInt(innerhtml.split(" ")[1]);
                    if (!isNaN(weekNumber)) {
                        weeks[weekNumber] = href!;
                    }
                });

                return weeks;
            }
        );

        return weeks;
    } catch (err) {
        console.error("Failed to get weeks from page:", err);
        return {};
    } finally {
        try {
            await page.close();
        } catch (closeErr) {
            console.warn("Error closing Puppeteer page:", closeErr);
        }
    }
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

const submitTimeslotsNormal = async (
    weekLink: string,
    ids: string[],
    clientUsername: string,
    clientEmail: string,
    password: string
): Promise<void> => {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.goto(weekLink);

        await typePassword(page, password);

        // Select timeslots
        await page.$$eval("table.results tbody td", (cells, ids) => {
            cells.forEach((cell) => {
                const header = cell.getAttribute("headers");
                if (header && ids.includes(header)) {
                    const yesInput = cell.querySelector("li.yes input[type=radio]") as HTMLInputElement | null;
                    if (yesInput) {
                        yesInput.setAttribute("checked", "");
                    }
                }
            });
        }, ids);

        // Fill in name/email
        const usernameInput = await page.$("#name");
        const emailInput = await page.$("#mail");
        if (usernameInput && emailInput) {
            await usernameInput.type(clientUsername);
            await emailInput.type(clientEmail);
        } else {
            console.warn("Username or email input not found");
        }

        // Click submit
        const submitButton = await page.$("table.results button[name='save']");
        if (submitButton) {
            await Promise.all([
                submitButton.click(),
                page.waitForNavigation({ waitUntil: "networkidle0", timeout: 10000 }).catch((e) =>
                    console.warn("Navigation timeout after clicking submit:", e)
                ),
            ]);
            console.log("Timeslots submitted successfully");
        } else {
            console.error("Submit button not found");
        }

        // Try to save the edit link
        const editLinkInput = await page.$("#email");
        const editLinkSubmitButton = await page.$("#send_edit_link_submit");

        let editLink: string | null = null;
        try {
            editLink = await page.$eval(
                ".alert-success div.input-group.input-group-sm input.form-control",
                (input) => (input as HTMLInputElement).value.trim()
            );
        } catch (e) {
            console.warn("Could not extract edit link:", e);
        }

        if (editLink && editLinkInput && editLinkSubmitButton) {
            await editLinkInput.type(clientEmail);
            await editLinkSubmitButton.click();
            await saveEditLink(weekLink, clientEmail, editLink);
        } else {
            console.warn("Missing fields to save edit link");
        }
    } catch (err) {
        console.error("submitTimeslotsNormal error:", err);
    } finally {
        try {
            await page.close();
        } catch (closeErr) {
            console.warn("Failed to close page:", closeErr);
        }
    }
};

const submitTimeslotsEditLink = async (
    weekLink: string,
    editLink: string,
    ids: string[],
    password: string,
    clientEmail: string
): Promise<void> => {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.goto(editLink);
        await typePassword(page, password);

        const selectedIDs = await getSelectedTimeslots(weekLink, password, clientEmail, page);

        // Deselect all currently selected timeslots
        await page.$$eval("table.results tbody td", (cells, selectedIDs) => {
            cells.forEach((cell) => {
                const header = cell.getAttribute("headers");
                if (header && selectedIDs.includes(header)) {
                    cell.querySelector("li.yes input[type=radio]")?.removeAttribute("checked");
                }
            });
        }, selectedIDs);

        const submitButton = await page.$("table.results button[name='save']");
        if (!submitButton) {
            throw new Error("Submit button not found on edit link page (deselect step)");
        }
        await submitButton.click();
        await page.waitForNavigation({ waitUntil: "networkidle0" });

        // Reload page and re-authenticate
        await page.goto(editLink);
        await typePassword(page, password);

        // Select the new timeslots
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
        if (!newSubmitButton) {
            throw new Error("Submit button not found on edit link page (select step)");
        }
        await newSubmitButton.click();
        await page.waitForNavigation({ waitUntil: "networkidle0" });

    } catch (error) {
        console.error("Error in submitTimeslotsEditLink:", error);
        throw error;
    } finally {
        await page.close();
    }
};
