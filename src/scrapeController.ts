import { Request, Response } from "express";
import { getBrowser } from "./browser.js";

export const scrapeTimeSlots = async (req: Request, res: Response) => {
    const url = process.env.URL;
    const envPassword = process.env.PASSWORD;
    const { password } = req.body;

    if (!url) {
        res.status(500).json({ error: "URL is not set in .env file" });
        return;
    }

    if (!password) {
        res.status(500).json({ error: "Password is missing" });
        return;
    }

    // TODO: implement safety against brute force attacks
    if (envPassword !== password) {
        res.status(500).json({ error: "Password is incorrect" });
        return;
    }

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
    const weeks: Record<number, string> = await page.$$eval(".ext_link", (elements) => {
        const weeks: Record<number, string> = {};
        const weekLinks = elements
            .map((el) => {
                const href = el.getAttribute("href");
                const title = el.getAttribute("title");
                const innerhtml = el.innerHTML
                return { href, title, innerhtml };
            })
            .filter(({ href, title }) => href?.includes("terminplaner") && title?.includes("Zur Trainingsanmeldung"))

        weekLinks.forEach(({ href, innerhtml, }) => {
            const weekNumber = parseInt(innerhtml.split(" ")[1]);
            weeks[weekNumber] = href;
        });

        return weeks;
    });

    // return if no weeks are currently available
    if (Object.keys(weeks).length == 0) {
        res.status(500).json({ error: "No weeks found" });
        return;
    }

    // scrape each week and store the results in the timeslots Record (e.g. { 1: ["slot1", "slot2"], 2: ["slot3", "slot4"] })
    const timeslotEntries = await Promise.all(
        Object.entries(weeks).map(async ([weekNumber, weekURL]) => {
            const slots = await scrapeWeek(weekURL);
            return [Number(weekNumber), slots] as const;
        })
    );
    const timeslots: Record<number, string[]> = Object.fromEntries(timeslotEntries);

    // close page and send the results as JSON to the client
    await page.close();
    const data = JSON.stringify(timeslots, null, 2);
    res.status(200).send(data);
    return;
};

const scrapeWeek = async (weekURL: string): Promise<string[]> => {

    // open new page and navigate to the week URL
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(weekURL);

    // type password if input is present
    const passwordInput = await page.$("#password");
    if (passwordInput) {
        await page.type("#password", process.env.PASSWORD);
        await page.click(".btn-success");
        await page.waitForSelector(".results");
    }

    // Extract all headers with IDs and titles
    const slotMap = await page.$$eval(".results thead th", (ths) => {
        const map: Record<string, string> = {};
        ths.forEach((el) => {
            const id = el.getAttribute("id");
            const title = el.getAttribute("title");
            if (id && title) {
                map[id] = title;
            }
        });
        return map;
    });

    // Remove headers that have no "yes" slot in their corresponding td
    const usedHeaders = await page.$$eval(".results tbody td", (tds) => {
        const headersToKeep = new Set<string>();
        tds.forEach((td) => {
            const headers = td.getAttribute("headers");
            if (!headers) return;
            const hasYes = td.innerHTML.includes('class="yes"');
            if (hasYes) headersToKeep.add(headers);
        });
        return [...headersToKeep];
    });

    // filter out not available slots
    const filteredSlots = usedHeaders.map((header) => slotMap[header]).filter(Boolean);

    await page.close();

    return filteredSlots;
};
