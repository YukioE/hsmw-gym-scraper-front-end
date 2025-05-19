export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) {
        throw new Error(`Element not found: ${selector}`);
    }
    return element;
}

export function $$<T extends HTMLElement = HTMLElement>(selector: string): T[] {
    const elements = document.querySelectorAll<T>(selector);
    if (elements.length === 0) {
        throw new Error(`No elements found for selector: ${selector}`);
    }
    return [...elements];
}

export function setCookie(cname: string, cvalue: string) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 100);
    const expires = "expires=" + d.toUTCString();
    document.cookie =
        cname + "=" + encodeURIComponent(cvalue) + ";" + expires + ";path=/";
}

export function getCookie(cname: string) {
    let name = cname + "=";
    let decodedCookie = decodeURIComponent(document.cookie);
    let ca = decodedCookie.split(";");
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == " ") {
            c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
            return c.substring(name.length, c.length);
        }
    }
    return "";
}
