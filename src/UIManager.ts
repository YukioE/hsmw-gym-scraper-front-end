import { $, $$, getCookie, setCookie, WeekResult } from "./utils.js";

export class UIManager {
    constructor() {
        this.init();
    }

    public init() {
        this.autoLogin();
        this.initLoginForm();
        this.initLogoutButton();
        this.scrapeTimeSlots();
        this.initSubmitSelectionButton();
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
            setCookie("password", password, new Date(Date.now() + 30 * 60 * 1000)); // 30 minutes expiration

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
        const output = $<HTMLDivElement>(".weeks-container");
        button.textContent = "Scrape Data";

        button.addEventListener("click", async () => {
            output.innerHTML = "scraping...";
            const fetchOptions = {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            };

            const response = await fetch("/scrape/", fetchOptions);

            if (!response.ok) {
                output.innerHTML = "Error: " + response.statusText;
                return;
            }

            const data = (await response.json()) as WeekResult[];

            if (data.length === 0) {
                output.innerHTML = "No weeks found.";
                return;
            }

            // create week select options
            const weekSelect = $<HTMLSelectElement>(".week-select");
            weekSelect.innerHTML = "";
            data.forEach((week) => {
                // TODO: start and end dates
                const option = document.createElement("option");
                option.value = week.link.split("/").pop() || "";
                option.textContent = `Week ${week.weekNumber}`;
                weekSelect.appendChild(option);
            });

            // add event listener to week select, call populateWeekContainer on change
            weekSelect.addEventListener("change", (event) => {
                const selectedWeek = (event.target as HTMLSelectElement).value;
                output.innerHTML = "";
                const weekData = data.find((week) => week.link.endsWith(selectedWeek));
                if (weekData) {
                    this.populateWeekContainer(weekData);
                } else {
                    output.innerHTML = "No data found for the selected week.";
                }
            });

            weekSelect.dispatchEvent(new Event("change"));
        });

        output.after(button);
    }

    private populateWeekContainer(data: WeekResult) {
        const output = $<HTMLDivElement>(".weeks-container");
        output.innerHTML = `<h2>Week ${data.weekNumber}</h2>`;

        const link = document.createElement("div");
        link.className = "week-link hidden";
        link.innerHTML = `${data.link}`;
        output.appendChild(link);

        // output the current edit link if it exists
        const editLink = document.createElement("div");
        editLink.className = "edit-link";
        editLink.innerHTML = `<p>Link: <a href="${data.editLink}" target="_blank">${data.editLink}</a></p>`;
        output.appendChild(editLink);

        const timeslotContainer = document.createElement("div");
        timeslotContainer.className = "timeslot-container";

        // create checkboxes for each timeslot
        data.timeslots.forEach((slot) => {
            const slotDiv = document.createElement("div");
            slotDiv.className = "timeslot";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.id = slot.id;
            checkbox.checked = slot.selected;
            checkbox.disabled = !slot.available && !slot.selected;

            const label = document.createElement("label");
            label.htmlFor = slot.id;
            label.textContent = `${slot.datetime}`;

            slotDiv.appendChild(checkbox);
            slotDiv.appendChild(label);
            timeslotContainer.appendChild(slotDiv);
        });

        output.appendChild(timeslotContainer);
    }

    private initSubmitSelectionButton() {
        const button = $<HTMLButtonElement>(".submit-selection");

        button.addEventListener("click", async () => {
            const selectedSlots = $$(".timeslot input[type='checkbox']:checked");
            if (selectedSlots.length === 0) {
                alert("Please select at least one timeslot.");
                return;
            }

            const selectedTimeslots = selectedSlots.map((slot) => ({
                id: slot.id,
            }));

            // TODO: send post request to server on /submit with selectedTimeslots id array
            button.innerHTML = "Submitting...";
            const fetchOptions = {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ ids: selectedTimeslots }),
            };

            const response = await fetch("/submit/", fetchOptions);

            if (!response.ok) {
                button.innerHTML = "Error: " + response.statusText;
                return;
            }

            alert("Selection submitted successfully!");
            button.innerHTML = "Submit";
        });
    }
}
