import { $, getCookie, setCookie } from "./utils.js";

export class UIManager {
    constructor() {
        this.init();
    }

    public init() {
        this.autoLogin();
        this.initLoginForm();
        this.initLogoutButton();
        this.scrapeTimeSlots();
    }

    private initLoginForm() {
        const loginForm = $<HTMLFormElement>(".login-form");
        const usernameInput = $<HTMLInputElement>("#username");
        const emailInput = $<HTMLInputElement>("#email");
        const passwordInput = $<HTMLInputElement>("#password");
        const submitButton = $<HTMLButtonElement>("#submit-button");
        const logoutButton = $<HTMLButtonElement>("#logout-button");

        submitButton.addEventListener("click", async (event) => {
            if (!loginForm.checkValidity()) {
                return;
            }

            event.preventDefault();
            const username = usernameInput.value;
            const email = emailInput.value;
            const password = passwordInput.value;

            if (!email.includes("hs-mittweida")) {
                alert("Please use your hs-mittweida email address.");
                return;
            }

            setCookie("username", username);
            setCookie("email", email);
            setCookie("password", password);

            [...loginForm.children].forEach((child) => {
                child.classList.add("hidden");
            });

            logoutButton.classList.remove("hidden");
            usernameInput.classList.remove("hidden");
            usernameInput.readOnly = true;
        });
    }

    private autoLogin() {
        const username = getCookie("username");
        const email = getCookie("email");

        if (username && email) {
            const usernameInput = $<HTMLInputElement>("#username");
            const emailInput = $<HTMLInputElement>("#email");

            usernameInput.value = username;
            emailInput.value = email;
        }
    }

    private initLogoutButton() {
        const logoutButton = $<HTMLButtonElement>("#logout-button");
        const loginForm = $<HTMLFormElement>(".login-form");
        const usernameInput = $<HTMLInputElement>("#username");
        const emailInput = $<HTMLInputElement>("#email");
        const passwordInput = $<HTMLInputElement>("#password");

        logoutButton.addEventListener("click", () => {
            [...loginForm.children].forEach((child) => {
                child.classList.remove("hidden");
            });

            usernameInput.readOnly = false;
            usernameInput.value = "";
            emailInput.value = "";
            passwordInput.value = "";

            logoutButton.classList.add("hidden");

            setCookie("username", "");
            setCookie("email", "");
            setCookie("password", "");
        });
    }

    private scrapeTimeSlots() {
        const button = document.createElement("button");
        const output = $<HTMLDivElement>(".week-container");
        button.textContent = "Scrape Data";

        button.addEventListener("click", async () => {
            output.innerHTML = "";
            const fetchOptions = {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            };

            const response = await fetch("/api/", fetchOptions);

            if (!response.ok) {
                output.innerHTML = "Error: " + response.statusText;
                return;
            }

            const data = (await response.json()) as Record<
                number,
                Record<string, boolean>
            >;

            Object.entries(data).forEach(([_, weekData]) => {
                const weekTable = document.createElement("table");
                const weekBody = document.createElement("tbody");
                weekTable.innerHTML = `<thead><tr><th>Slot</th><th>yes</th><th>no</th></tr></thead>`;

                Object.entries(weekData).forEach(([slot, isTaken]) => {
                    const row = document.createElement("tr");
                    row.innerHTML = `<td>${slot}</td>
                                     <td><input type="checkbox" ${isTaken ? "checked" : ""}></td>
                                     <td><input type="checkbox" ${!isTaken ? "checked" : ""}></td>`;
                    weekBody.appendChild(row);
                });

                weekTable.appendChild(weekBody);
                output.appendChild(weekTable);
            });
        });

        output.after(button);
    }
}
