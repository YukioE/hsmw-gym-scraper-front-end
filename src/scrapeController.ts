import { Request, Response } from "express";
import { getBrowser } from "./browser.js";
import bcrypt from "bcrypt";

export const scrapeTimeSlots = async (req: Request, res: Response) => {
    const { PASSWORD: envPassword, URL: url } = process.env;
    const { password } = req.cookies;

    if (!url) {
        res.status(500).json({ error: "URL is not set in .env file" });
        return;
    }

    if (!password) {
        res.status(400).json({ error: "Password is missing" });
        return;
    }

    // TODO: implement safety against brute force attacks
    if (bcrypt.hash(envPassword, 12) !== password) {
        res.status(403).json({ error: "Password is incorrect" });
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
        res.status(404).json({ error: "No weeks found" });
        return;
    }

    // scrape each week and store the results in the timeslots Record (e.g. { KW: <slot, yes/no> })
    const timeslotEntries = await Promise.all(
        Object.entries(weeks).map(async ([weekNumber, weekURL]) => {
            const slots = await scrapeWeek(weekURL);
            return [Number(weekNumber), slots] as const;
        })
    );
    const timeslots: Record<number, Map<string, boolean>> = Object.fromEntries(timeslotEntries);

    const timeslotsRecord: Record<number, Record<string, boolean>> = {};

    for (const [week, map] of Object.entries(timeslots)) {
        timeslotsRecord[Number(week)] = Object.fromEntries(map);
    }

    // close page and send the results as JSON to the client
    await page.close();
    const data = JSON.stringify(timeslotsRecord, null, 2);
    res.status(200).send(data);
    return;
};

const scrapeWeek = async (weekURL: string): Promise<Map<string, boolean>> => {

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
    const idTitleMap = await page.$$eval(".results thead th", (ths) => {
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

    // returns all the slots that are taken
    const takenSlots: string[] = await page.$$eval(".results tbody td", (tds) => {
        const slots: string[] = [];
        tds.forEach((td) => {
            const headers = td.getAttribute("headers");
            if (!headers) return;
            const hasYes = td.innerHTML.includes('class="yes"');
            if (!hasYes) { slots.push(headers); }
        });
        return slots;
    });

    await page.close();

    const slots = new Map<string, boolean>();
    Object.entries(idTitleMap).forEach(([id, title]) => {
        const isTaken = takenSlots.includes(id);
        slots.set(title, isTaken);
    });

    return slots;
};
