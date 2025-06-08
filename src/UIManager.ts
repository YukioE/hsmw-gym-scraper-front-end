import { $, $$, getCookie, setCookie, WeekResult } from "./utils.js";

export class UIManager {
    constructor() {
        this.init();
    }

    public init() {
        this.autoLogin();
        this.initLoginForm();
        this.initLogoutButton();
        this.initSubmitSelectionButton();
        this.initUpdateButton();
        // this.checkGDPRConsent();
    }

    private initLoginForm() {
        const loginForm = $<HTMLFormElement>(".login-form");
        const usernameInput = $<HTMLInputElement>("#username");
        const emailInput = $<HTMLInputElement>("#email");
        const passwordInput = $<HTMLInputElement>("#password");
        const submitButton = $<HTMLButtonElement>("#submit-button");
        const logoutButton = $<HTMLButtonElement>("#logout-button");
        const appContainer = $<HTMLDivElement>(".app-container");

        submitButton.addEventListener("click", async (event) => {
            if (!loginForm.checkValidity()) {
                return;
            }

            event.preventDefault();
            const username = usernameInput.value.trim() || null;
            const email = emailInput.value.trim().toLowerCase() || null;
            const password = passwordInput.value.trim() || null;

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

            appContainer.classList.remove("hidden");

            this.scrapeTimeSlots();
        });
    }

    private autoLogin() {
        const username = getCookie("username");
        const email = getCookie("email");
        const password = getCookie("password");

        if (username && email) {
            const usernameInput = $<HTMLInputElement>("#username");
            const emailInput = $<HTMLInputElement>("#email");

            usernameInput.value = username;
            emailInput.value = email;
        }
        if (password) {
            const passwordInput = $<HTMLInputElement>("#password");
            passwordInput.value = password;
        }
    }

    private initLogoutButton() {
        const logoutButton = $<HTMLButtonElement>("#logout-button");
        const loginForm = $<HTMLFormElement>(".login-form");
        const usernameInput = $<HTMLInputElement>("#username");
        const emailInput = $<HTMLInputElement>("#email");
        const passwordInput = $<HTMLInputElement>("#password");
        const appContainer = $<HTMLDivElement>(".app-container");

        logoutButton.addEventListener("click", () => {
            [...loginForm.children].forEach((child) => {
                child.classList.remove("hidden");
            });

            usernameInput.readOnly = false;
            usernameInput.value = "";
            emailInput.value = "";
            passwordInput.value = "";

            logoutButton.classList.add("hidden");
            appContainer.classList.add("hidden");

            setCookie("username", "");
            setCookie("email", "");
            setCookie("password", "");
        });
    }

    private initUpdateButton() {
        const updateButton = $<HTMLButtonElement>(".update");
        updateButton.addEventListener("click", async () => {
            await this.scrapeTimeSlots();
        });
    }

    private async scrapeTimeSlots() {
        const output = $<HTMLDivElement>(".weeks-container");

        output.innerHTML = "fetching data...";
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
    }

    private populateWeekContainer(data: WeekResult) {
        const output = $<HTMLDivElement>(".weeks-container");
        output.innerHTML = `<h2>Week ${data.weekNumber}</h2>`;

        const link = document.createElement("div");
        link.className = "week-link hidden";
        link.innerHTML = `${data.link}`;
        output.appendChild(link);

        this.appendEditableLink(output, data, async (newLink: string) => {
            const res = await fetch("/set-edit-link/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ editLink: newLink, weekLink: data.link }),
            });
            return res;
        });

        const timeslotContainer = document.createElement("div");
        timeslotContainer.className = "timeslot-container";

        // create checkboxes for each timeslot
        data.timeslots.forEach((slot, i) => {
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

            // append hr tag if the day changes
            const currentDay = slot.datetime.slice(0, 2);
            const nextSlot = data.timeslots[i + 1];
            const nextDay = nextSlot ? nextSlot.datetime.slice(0, 2) : null;

            if (currentDay !== nextDay) {
                const hr = document.createElement("hr");
                timeslotContainer.appendChild(hr);
            }
        });

        output.appendChild(timeslotContainer);
    }

    private initSubmitSelectionButton() {
        const button = $<HTMLButtonElement>(".submit-selection");

        button.addEventListener("click", async () => {
            let selectedSlots = $$(".timeslot input[type='checkbox']:checked") || [];

            const ids = selectedSlots.map((slot) => slot.id);

            button.innerHTML = "Submitting...";
            const fetchOptions = {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ weekLink: $(".week-link").textContent?.trim() || "", ids }),
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

    private checkGDPRConsent() {
        const gdprPopup = $<HTMLDivElement>("#gdpr-popup")!;
        const gdprOverlay = $<HTMLDivElement>("#gdpr-overlay")!;
        const acceptButton = $<HTMLButtonElement>("#gdpr-accept")!;

        const consent = getCookie("gdpr_consent");
        if (!consent) {
            gdprOverlay.classList.remove("hidden");
            gdprPopup.classList.remove("hidden");

            acceptButton.addEventListener("click", () => {
                const expiryDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days expiration
                setCookie("gdpr_consent", "accepted", expiryDate);
                gdprPopup.classList.add("hidden");
                gdprOverlay.classList.add("hidden");
            });
        }
    }

    private appendEditableLink(container: HTMLElement, data: WeekResult, onSave: (link: string) => Promise<Response>) {
        const regex = /^https:\/\/terminplaner4\.dfn\.de\/[A-Za-z0-9]+\/vote\/[A-Za-z0-9#]+$/;

        function createEditSection(currentLink: string) {
            const wrapper = document.createElement("div");
            wrapper.className = "edit-link";

            const label = document.createElement("label");
            label.textContent = "Enter your edit link:";
            label.setAttribute("for", "editLinkInput");

            const input = document.createElement("input");
            input.type = "url";
            input.id = "editLinkInput";
            input.placeholder = "https://terminplaner4.dfn.de/...";
            input.value = currentLink || "";

            const button = document.createElement("button");
            button.textContent = currentLink ? "Change" : "Set";

            const error = document.createElement("p");
            error.style.color = "red";
            error.style.display = "none";

            button.onclick = async () => {
                const link = input.value.trim();
                if (!regex.test(link)) {
                    error.textContent = "Invalid link format.";
                    error.style.display = "block";
                    return;
                }
                error.style.display = "none";

                try {
                    const res = await onSave(link); // async save
                    if (res.ok) {
                        showLink(link);
                        await this.scrapeTimeSlots();
                    } else {
                        error.textContent = "Failed to save link.";
                        error.style.display = "block";
                    }
                } catch (err) {
                    error.textContent = "Error connecting to server.";
                    error.style.display = "block";
                }
            };

            wrapper.appendChild(label);
            wrapper.appendChild(input);
            wrapper.appendChild(button);
            wrapper.appendChild(error);
            container.prepend(wrapper);
        }

        function showLink(link: string) {
            const div = document.createElement("div");
            div.className = "edit-link";
            div.innerHTML = `<p>Link: <a href="${link}" target="_blank">${link}</a></p>`;

            const changeButton = document.createElement("button");
            changeButton.textContent = "Change";
            changeButton.onclick = () => {
                container.innerHTML = "";
                createEditSection(link);
            };

            div.appendChild(changeButton);
            container.appendChild(div);
        }

        if (data.editLink) {
            showLink(data.editLink);
        } else {
            createEditSection("");
        }
    }
}
