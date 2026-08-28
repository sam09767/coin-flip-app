async function updateStatus() {
    try {
        const res = await fetch('/api/game-status');
        const data = await res.json();
        document.getElementById('round').innerText = data.round;
        if (data.lastOutcome) {
            document.getElementById('coin').innerText = data.lastOutcome;
        }
    } catch (err) {
        console.error(err);
    }
}

async function placeBet(choice) {
    const amount = document.getElementById('betAmount').value;
    if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    try {
        const res = await fetch('/api/place-bet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ choice, amount: Number(amount) })
        });
        const data = await res.json();
        document.getElementById('statusMessage').innerText = data.message;
    } catch (err) {
        document.getElementById('statusMessage').innerText = 'Error placing bet';
    }
}

setInterval(updateStatus, 3000);

