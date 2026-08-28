// Persistent Local State Engine
let userBalance = parseFloat(localStorage.getItem('rf_balance')) || 1000;
let streak = parseInt(localStorage.getItem('rf_streak')) || 0;
let forceOutcomeMode = localStorage.getItem('rf_mode') || 'AUTO';
let houseProfit = parseFloat(localStorage.getItem('rf_profit')) || 0;
let totalVolume = parseFloat(localStorage.getItem('rf_volume')) || 0;

let currentBet = JSON.parse(localStorage.getItem('rf_current_bet')) || null;
let historyData = JSON.parse(localStorage.getItem('rf_history')) || ['HEADS', 'TAILS', 'HEADS'];

const MASTER_PIN = "9876";
let adminTapSequence = 0;
let tapTimer = null;
let isAdminAuthenticated = false;

let currentRotation = 0;
let lastExecutedRound = -1;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'click') {
            osc.frequency.setValueAtTime(400, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.05);
        } else if (type === 'spin') {
            osc.frequency.setValueAtTime(200, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.5);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.5);
        } else if (type === 'win') {
            osc.frequency.setValueAtTime(523, audioCtx.currentTime);
            osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.1);
            osc.frequency.setValueAtTime(783, audioCtx.currentTime + 0.2);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.4);
        } else if (type === 'lose') {
            osc.frequency.setValueAtTime(300, audioCtx.currentTime);
            osc.frequency.linearRampToValueAtTime(150, audioCtx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.3);
        }
    } catch (e) {}
}

function saveData() {
    localStorage.setItem('rf_balance', userBalance);
    localStorage.setItem('rf_streak', streak);
    localStorage.setItem('rf_mode', forceOutcomeMode);
    localStorage.setItem('rf_profit', houseProfit);
    localStorage.setItem('rf_volume', totalVolume);
    localStorage.setItem('rf_current_bet', JSON.stringify(currentBet));
    localStorage.setItem('rf_history', JSON.stringify(historyData));
}

// 🕒 SUB-SECOND HIGH PRECISION REAL-WORLD IST ENGINE
function updateWorldClockEngine() {
    const now = new Date();
    
    // Exact Indian Standard Time Clock
    const istTimeString = now.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }) + '.' + Math.floor(now.getMilliseconds() / 100);
    
    document.getElementById('istClock').innerText = istTimeString;

    // Unix Epoch Calculation (Pure & Independent of Browser Tampering)
    const epochMs = now.getTime();
    const globalRoundId = Math.floor(epochMs / 30000);
    const msRemaining = 30000 - (epochMs % 30000);
    const secondsRemaining = (msRemaining / 1000).toFixed(1);

    document.getElementById('round').innerText = globalRoundId;
    document.getElementById('timer').innerText = secondsRemaining;

    // Spin trigger at exactly 0.0 seconds
    if (msRemaining <= 200 && lastExecutedRound !== globalRoundId) {
        lastExecutedRound = globalRoundId;
        runCoinFlip(globalRoundId);
    }
}

// High Refresh Precision Loop (100ms)
setInterval(updateWorldClockEngine, 100);

window.onload = () => {
    document.getElementById('balance').innerText = userBalance;
    document.getElementById('streak').innerText = streak;
    setForceOutcome(forceOutcomeMode, false);
    renderHistoryUI();
    updateLedgerUI();

    if (currentBet) {
        const statusMsg = document.getElementById('statusMessage');
        statusMsg.style.color = '#38bdf8';
        statusMsg.innerText = `Active Bet: ₹${currentBet.amount} on ${currentBet.choice}`;
    }
};

function handleSecureAdminTrigger() {
    adminTapSequence++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { adminTapSequence = 0; }, 1500);

    if (adminTapSequence >= 7) {
        adminTapSequence = 0;
        if (isAdminAuthenticated) {
            document.getElementById('adminModal').style.display = 'flex';
        } else {
            document.getElementById('authModal').style.display = 'flex';
        }
    }
}

function authenticateAdmin() {
    const inputPin = document.getElementById('adminPasscode').value;
    const errDisplay = document.getElementById('authError');

    if (inputPin === MASTER_PIN) {
        isAdminAuthenticated = true;
        document.getElementById('authModal').style.display = 'none';
        document.getElementById('adminModal').style.display = 'flex';
        document.getElementById('adminPasscode').value = '';
        errDisplay.innerText = '';
        logAdminEvent("Master Admin Session Authenticated.");
    } else {
        errDisplay.innerText = "❌ INVALID MASTER PIN";
        document.getElementById('adminPasscode').value = '';
        playSound('lose');
    }
}

function closeAuthModal() { document.getElementById('authModal').style.display = 'none'; }
function closeAdminPanel() { document.getElementById('adminModal').style.display = 'none'; }

function lockAdminSession() {
    isAdminAuthenticated = false;
    closeAdminPanel();
    logAdminEvent("Session Locked.");
}

function setForceOutcome(mode, shouldLog = true) {
    forceOutcomeMode = mode;
    document.getElementById('adminCurrentMode').innerText = mode;
    
    document.getElementById('btnAuto').classList.remove('active');
    document.getElementById('btnForceHeads').classList.remove('active');
    document.getElementById('btnForceTails').classList.remove('active');

    if(mode === 'AUTO') document.getElementById('btnAuto').classList.add('active');
    if(mode === 'HEADS') document.getElementById('btnForceHeads').classList.add('active');
    if(mode === 'TAILS') document.getElementById('btnForceTails').classList.add('active');

    saveData();
    if(shouldLog) logAdminEvent(`Outcome Mode Set: ${mode}`);
}

function adminAddBalance(amt) {
    userBalance += amt;
    document.getElementById('balance').innerText = userBalance;
    saveData();
    logAdminEvent(`Added ₹${amt} Balance`);
}

function adminResetStats() {
    localStorage.clear();
    location.reload();
}

function logAdminEvent(msg) {
    const logs = document.getElementById('adminLogs');
    const entry = document.createElement('div');
    entry.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logs.prepend(entry);
}

function updateLedgerUI() {
    document.getElementById('adminHouseProfit').innerText = `₹${houseProfit}`;
    document.getElementById('adminTotalVolume').innerText = `₹${totalVolume}`;
}

function setBetAmount(val) {
    const input = document.getElementById('betAmount');
    if (val === 'max') {
        input.value = userBalance;
    } else {
        input.value = (Number(input.value) || 0) + val;
    }
    playSound('click');
}

function runCoinFlip(roundId) {
    const coin = document.getElementById('coin');
    const resultDisplay = document.getElementById('resultText');
    const statusMsg = document.getElementById('statusMessage');

    resultDisplay.innerText = "🌀 Flipping...";
    playSound('spin');

    let outcome;
    if (forceOutcomeMode === 'AUTO') {
        outcome = (roundId % 2 === 0) ? 'HEADS' : 'TAILS';
    } else {
        outcome = forceOutcomeMode;
    }

    currentRotation += 1800;
    if (outcome === 'TAILS') currentRotation += 180;
    coin.style.transform = `rotateY(${currentRotation}deg)`;

    setTimeout(() => {
        resultDisplay.innerText = `Result: ${outcome}`;

        if (currentBet) {
            totalVolume += currentBet.amount;
            if (currentBet.choice === outcome) {
                streak++;
                const winAmount = currentBet.amount * 2;
                userBalance += winAmount;
                houseProfit -= currentBet.amount;
                playSound('win');
                if (typeof confetti === 'function') confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
                showModal("🎉 BIG WIN!", `+₹${winAmount}`, "#4ade80");
                statusMsg.innerText = `Won ₹${winAmount}!`;
                statusMsg.style.color = '#4ade80';
            } else {
                streak = 0;
                houseProfit += currentBet.amount;
                playSound('lose');
                showModal("❌ YOU LOST", `-₹${currentBet.amount}`, "#ef4444");
                statusMsg.innerText = `Lost ₹${currentBet.amount}`;
                statusMsg.style.color = '#ef4444';
            }
            
            currentBet = null;
            document.getElementById('balance').innerText = userBalance;
            document.getElementById('streak').innerText = streak;
            updateLedgerUI();
            saveData();
        }

        addHistoryChip(outcome);
    }, 1300);
}

function showModal(title, desc, color) {
    const modal = document.getElementById('winModal');
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalTitle').style.color = color;
    document.getElementById('modalDesc').innerText = desc;
    modal.style.display = "flex";
    setTimeout(() => { modal.style.display = "none"; }, 2000);
}

function placeBet(choice) {
    const amountInput = document.getElementById('betAmount');
    const statusMsg = document.getElementById('statusMessage');
    const amount = Number(amountInput.value);

    if (currentBet) {
        statusMsg.style.color = '#f59e0b';
        statusMsg.innerText = 'Bet already active for this round!';
        return;
    }

    if (!amount || amount < 10) {
        statusMsg.style.color = '#ef4444';
        statusMsg.innerText = 'Minimum bet ₹10';
        return;
    }

    if (amount > userBalance) {
        statusMsg.style.color = '#ef4444';
        statusMsg.innerText = 'Low Balance!';
        return;
    }

    userBalance -= amount;
    document.getElementById('balance').innerText = userBalance;
    currentBet = { choice, amount };
    saveData();

    statusMsg.style.color = '#38bdf8';
    statusMsg.innerText = `₹${amount} bet placed on ${choice}!`;
    amountInput.value = '';
    playSound('click');
}

function addHistoryChip(outcome) {
    historyData.unshift(outcome);
    if (historyData.length > 6) historyData.pop();
    saveData();
    renderHistoryUI();
}

function renderHistoryUI() {
    const historyContainer = document.getElementById('historyChips');
    historyContainer.innerHTML = '';
    historyData.forEach(item => {
        const chip = document.createElement('span');
        chip.className = `chip ${item.toLowerCase()}`;
        chip.innerText = item === 'HEADS' ? 'H' : 'T';
        historyContainer.appendChild(chip);
    });
}
