(() => {
    const clock = document.getElementById('liveClock');
    const dates = document.querySelectorAll('.live-date');
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const updateClock = () => {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const date = `${String(now.getDate()).padStart(2, '0')} ${monthNames[now.getMonth()]} ${now.getFullYear()}`;

        if (clock) {
            clock.textContent = `${hours}:${minutes}:${seconds}`;
        }

        dates.forEach((dateElement) => {
            dateElement.textContent = date;
        });
    };

    updateClock();
    setInterval(updateClock, 1000);
})();
