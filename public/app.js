// Database State Retention
let currentUserId = localStorage.getItem('rf_active_uid') || 'User_' + Math.floor(1000 + Math.random() * 9000);
localStorage.setItem('rf_active_uid', currentUserId);

let usersDB = JSON.parse(localStorage.getItem('rf_users_db')) || {};
if (!usersDB[currentUserId]) {
    usersDB[currentUserId] = { balance: 1000, streak: 0, upi: '' };
}

let forceOutcomeMode = localStorage.getItem('rf_mode') || 'AUTO';
let houseProfit = parseFloat(localStorage.getItem('rf_profit')) || 0;
let totalVolume = parseFloat(localStorage.getItem('rf_volume')) || 0;
let withdrawalRequests = JSON.parse(localStorage.getItem('rf_withdrawals')) || [];

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
    localStorage.setItem('rf_users_db', JSON.stringify(usersDB));
    localStorage.setItem('rf_mode', forceOutcomeMode);
    localStorage.setItem('rf_profit', houseProfit);
    localStorage.setItem('rf_volume', totalVolume);
    localStorage.setItem('rf_withdrawals', JSON.stringify(withdrawalRequests));
    localStorage.setItem('rf_current_bet', JSON.stringify(currentBet));
    localStorage.setItem('rf_history', JSON.stringify(historyData));
}

// 🕒 SUB-SECOND HIGH PRECISION REAL-WORLD IST CLOCK ENGINE
function updateWorldClockEngine() {
    const now = new Date();
    
    const istTimeString = now.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }) + '.' + Math.floor(now.getMilliseconds() / 100);
    
    document.getElementById('istClock').innerText = istTimeString;

    const epochMs = now.getTime();
    const globalRoundId = Math.floor(epochMs / 30000);
    const msRemaining = 30000 - (epochMs % 30000);
    const secondsRemaining = (msRemaining / 1000).toFixed(1);

    document.getElementById('round').innerText = globalRoundId;
    document.getElementById('timer').innerText = secondsRemaining;

    if (msRemaining <= 200 && lastExecutedRound !== globalRoundId) {
        lastExecutedRound = globalRoundId;
        runCoinFlip(globalRoundId);
    }
}

setInterval(updateWorldClockEngine, 100);

window.onload = () => {
    updateUserUI();
    setForceOutcome(forceOutcomeMode, false);
    renderHistoryUI();
    refreshAdminDashboard();

    if (currentBet) {
        const statusMsg = document.getElementById('statusMessage');
        statusMsg.style.color = '#38bdf8';
        statusMsg.innerText = `Active Bet: ₹${currentBet.amount} on ${currentBet.choice}`;
    }
};

function updateUserUI() {
    const userData = usersDB[currentUserId];
    document.getElementById('balance').innerText = userData.balance;
    document.getElementById('streak').innerText = userData.streak;
}

// 👑 ADMIN MASTER CONTROL FUNCTIONS
function handleSecureAdminTrigger() {
    adminTapSequence++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { adminTapSequence = 0; }, 1500);

    if (adminTapSequence >= 7) {
        adminTapSequence = 0;
        if (isAdminAuthenticated) {
            refreshAdminDashboard();
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
        refreshAdminDashboard();
        document.getElementById('adminModal').style.display = 'flex';
        document.getElementById('adminPasscode').value = '';
        errDisplay.innerText = '';
        logAdminEvent("Master Admin Authenticated.");
    } else {
        errDisplay.innerText = "❌ INVALID PIN";
        document.getElementById('adminPasscode').value = '';
        playSound('lose');
    }
}

function closeAuthModal() { document.getElementById('authModal').style.display = 'none'; }
function closeAdminPanel() { document.getElementById('adminModal').style.display = 'none'; }
function lockAdminSession() { isAdminAuthenticated = false; closeAdminPanel(); }

function refreshAdminDashboard() {
    const userKeys = Object.keys(usersDB);
    document.getElementById('admTotalUsers').innerText = userKeys.length;
    document.getElementById('admActiveUsers').innerText = Math.floor(userKeys.length * 1.5) + 3;
    document.getElementById('onlineCount').innerText = Math.floor(userKeys.length * 1.5) + 3;
    
    document.getElementById('admTotalVolume').innerText = `₹${totalVolume}`;
    document.getElementById('admHouseProfit').innerText = `₹${houseProfit}`;
    document.getElementById('admCurrentMode').innerText = forceOutcomeMode;

    const pendingSum = withdrawalRequests.filter(r => r.status === 'PENDING').reduce((a, b) => a + b.amount, 0);
    document.getElementById('admPendingPayouts').innerText = `₹${pendingSum}`;

    // Populate User Dropdown
    const userSelect = document.getElementById('admUserSelect');
    userSelect.innerHTML = '';
    userKeys.forEach(uid => {
        const opt = document.createElement('option');
        opt.value = uid;
        opt.innerText = `${uid} (Balance: ₹${usersDB[uid].balance})`;
        userSelect.appendChild(opt);
    });

    loadTargetUserData();
    renderWithdrawalRequests();
}

function loadTargetUserData() {
    const selectedUid = document.getElementById('admUserSelect').value;
    if (selectedUid && usersDB[selectedUid]) {
        document.getElementById('admWalletAmount').value = usersDB[selectedUid].balance;
    }
}

function adminModifyWallet(action) {
    const selectedUid = document.getElementById('admUserSelect').value;
    const amt = parseFloat(document.getElementById('admWalletAmount').value);

    if (!selectedUid || isNaN(amt)) return;

    if (action === 'SET') usersDB[selectedUid].balance = amt;
    if (action === 'ADD') usersDB[selectedUid].balance += amt;
    if (action === 'SUB') usersDB[selectedUid].balance = Math.max(0, usersDB[selectedUid].balance - amt);

    saveData();
    updateUserUI();
    refreshAdminDashboard();
    logAdminEvent(`Wallet (${action}) for ${selectedUid}: ₹${amt}`);
}

function setForceOutcome(mode, shouldLog = true) {
    forceOutcomeMode = mode;
    document.getElementById('admCurrentMode').innerText = mode;
    
    document.getElementById('btnAuto').classList.remove('active');
    document.getElementById('btnForceHeads').classList.remove('active');
    document.getElementById('btnForceTails').classList.remove('active');

    if(mode === 'AUTO') document.getElementById('btnAuto').classList.add('active');
    if(mode === 'HEADS') document.getElementById('btnForceHeads').classList.add('active');
    if(mode === 'TAILS') document.getElementById('btnForceTails').classList.add('active');

    saveData();
    if(shouldLog) logAdminEvent(`Result Force Set: ${mode}`);
}

function requestWithdrawal() {
    const upi = document.getElementById('withdrawUpi').value;
    const amt = parseFloat(document.getElementById('withdrawAmt').value);
    const statusMsg = document.getElementById('statusMessage');

    if (!upi || !amt || amt < 100) {
        statusMsg.style.color = '#ef4444';
        statusMsg.innerText = 'Min Withdrawal ₹100 & valid UPI required!';
        return;
    }

    if (amt > usersDB[currentUserId].balance) {
        statusMsg.style.color = '#ef4444';
        statusMsg.innerText = 'Insufficient Balance!';
        return;
    }

    usersDB[currentUserId].balance -= amt;
    const req = { id: Date.now(), uid: currentUserId, upi, amount: amt, status: 'PENDING' };
    withdrawalRequests.push(req);

    saveData();
    updateUserUI();
    statusMsg.style.color = '#4ade80';
    statusMsg.innerText = 'Withdrawal Request Submitted!';
    document.getElementById('withdrawUpi').value = '';
    document.getElementById('withdrawAmt').value = '';
}

function renderWithdrawalRequests() {
    const list = document.getElementById('admPayoutList');
    list.innerHTML = '';

    const pending = withdrawalRequests.filter(r => r.status === 'PENDING');
    if (pending.length === 0) {
        list.innerHTML = `<p style="font-size:0.75rem; color:#64748b;">No pending requests</p>`;
        return;
    }

    pending.forEach(req => {
        const item = document.createElement('div');
        item.className = 'payout-item';
        item.innerHTML = `
            <div><strong>${req.uid}</strong> - ₹${req.amount} <br><small style="color:#38bdf8;">${req.upi}</small></div>
            <div class="payout-actions">
                <button class="btn-sm approve" onclick="processWithdrawal(${req.id}, 'APPROVE')">Approve</button>
                <button class="btn-sm reject" onclick="processWithdrawal(${req.id}, 'REJECT')">Reject</button>
            </div>
        `;
        list.appendChild(item);
    });
}

function processWithdrawal(reqId, action) {
    const reqIndex = withdrawalRequests.findIndex(r => r.id === reqId);
    if (reqIndex === -1) return;

    const req = withdrawalRequests[reqIndex];
    if (action === 'APPROVE') {
        req.status = 'APPROVED';
        logAdminEvent(`Payout Approved ₹${req.amount} for ${req.uid}`);
    } else {
        req.status = 'REJECTED';
        usersDB[req.uid].balance += req.amount; // Refund
        logAdminEvent(`Payout Rejected & Refunded ₹${req.amount} to ${req.uid}`);
    }

    saveData();
    updateUserUI();
    refreshAdminDashboard();
}

function adminCreateDummyUsers() {
    for (let i = 1; i <= 5; i++) {
        const dummyId = 'User_' + Math.floor(1000 + Math.random() * 9000);
        usersDB[dummyId] = { balance: Math.floor(Math.random() * 5000) + 100, streak: 0, upi: '' };
    }
    saveData();
    refreshAdminDashboard();
    logAdminEvent("Generated 5 Mock Users");
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

function setBetAmount(val) {
    const input = document.getElementById('betAmount');
    if (val === 'max') {
        input.value = usersDB[currentUserId].balance;
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

    let outcome = forceOutcomeMode === 'AUTO' ? ((roundId % 2 === 0) ? 'HEADS' : 'TAILS') : forceOutcomeMode;

    currentRotation += 1800;
    if (outcome === 'TAILS') currentRotation += 180;
    coin.style.transform = `rotateY(${currentRotation}deg)`;

    setTimeout(() => {
        resultDisplay.innerText = `Result: ${outcome}`;

        if (currentBet) {
            totalVolume += currentBet.amount;
            if (currentBet.choice === outcome) {
                usersDB[currentUserId].streak++;
                const winAmount = currentBet.amount * 2;
                usersDB[currentUserId].balance += winAmount;
                houseProfit -= currentBet.amount;
                playSound('win');
                if (typeof confetti === 'function') confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
                showModal("🎉 BIG WIN!", `+₹${winAmount}`, "#4ade80");
                statusMsg.innerText = `Won ₹${winAmount}!`;
                statusMsg.style.color = '#4ade80';
            } else {
                usersDB[currentUserId].streak = 0;
                houseProfit += currentBet.amount;
                playSound('lose');
                showModal("❌ YOU LOST", `-₹${currentBet.amount}`, "#ef4444");
                statusMsg.innerText = `Lost ₹${currentBet.amount}`;
                statusMsg.style.color = '#ef4444';
            }
            
            currentBet = null;
            updateUserUI();
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
        statusMsg.innerText = 'Bet already active!';
        return;
    }

    if (!amount || amount < 10) {
        statusMsg.style.color = '#ef4444';
        statusMsg.innerText = 'Minimum bet ₹10';
        return;
    }

    if (amount > usersDB[currentUserId].balance) {
        statusMsg.style.color = '#ef4444';
        statusMsg.innerText = 'Low Balance!';
        return;
    }

    usersDB[currentUserId].balance -= amount;
    updateUserUI();
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
