import puppeteer, { Browser } from "puppeteer";

let browserInstance: Browser | null = null;

export const getBrowser = async (): Promise<Browser> => {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            headless: false,
            args: ["--disable-setuid-sandbox"],
            ignoreHTTPSErrors: true,
        });
    }
    return browserInstance;
};
