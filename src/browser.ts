import puppeteer, { Browser } from "puppeteer";

let browserInstance: Browser | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);

    idleTimer = setTimeout(async () => {
        console.log("🕒 Closing browser due to inactivity...");
        if (browserInstance) {
            await browserInstance.close();
            browserInstance = null;
        }
    }, IDLE_TIMEOUT_MS);
};

export const getBrowser = async (): Promise<Browser> => {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/google-chrome',
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            ignoreHTTPSErrors: true,
        });
        console.log("🚀 Browser launched.");
    }

    resetIdleTimer();

    return browserInstance;
};
