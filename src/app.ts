document.addEventListener('DOMContentLoaded', () => {
    const button = document.createElement('button');
    const output = document.createElement('div');
    const passwordInput = document.getElementById('password') as HTMLInputElement | null;
    button.textContent = 'Scrape Data';

    button.addEventListener('click', async () => {
        output.innerHTML = 'Scraping...';

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ password: passwordInput.value }),
        };

        const response = await fetch('/api/', fetchOptions);

        if (!response.ok) {
            output.innerHTML = 'Error: ' + response.statusText;
            return;
        }

        const data = await response.json() as Record<number, string[]>;
        output.innerHTML = '';
        Object.entries(data).forEach(([weekNumber, slots]) => {
            const weekDiv = document.createElement('div');
            weekDiv.innerHTML = `<h3>Week ${weekNumber}</h3>`;
            const slotsList = document.createElement('ul');
            slots.forEach((slot) => {
                const slotItem = document.createElement('li');
                slotItem.textContent = slot;
                slotsList.appendChild(slotItem);
            });
            weekDiv.appendChild(slotsList);
            output.appendChild(weekDiv);
        });
    });

    document.body.appendChild(button);
    document.body.appendChild(output);
});

console.log(`${new Date().toLocaleString()}`);
