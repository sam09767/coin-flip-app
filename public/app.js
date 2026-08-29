const socket = io();

let currentUser = null;
let currentUpi = "ishaquehaque107@okaxis";
let MASTER_PIN = "9876";
let adminTapSequence = 0;
let tapTimer = null;
let currentRotation = 0;

// High-Tech Web Audio Synthesizer
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'tick') {
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
            osc.start(); osc.stop(audioCtx.currentTime + 0.03);
        } else if (type === 'click') {
            osc.frequency.setValueAtTime(450, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            osc.start(); osc.stop(audioCtx.currentTime + 0.05);
        } else if (type === 'spin') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 1.2);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.2);
            osc.start(); osc.stop(audioCtx.currentTime + 1.2);
        } else if (type === 'win') {
            const now = audioCtx.currentTime;
            [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.connect(g); g.connect(audioCtx.destination);
                o.frequency.setValueAtTime(freq, now + idx * 0.08);
                g.gain.setValueAtTime(0.15, now + idx * 0.08);
                o.start(now + idx * 0.08);
                o.stop(now + idx * 0.08 + 0.2);
            });
        } else if (type === 'lose') {
            osc.frequency.setValueAtTime(220, audioCtx.currentTime);
            osc.frequency.linearRampToValueAtTime(110, audioCtx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            osc.start(); osc.stop(audioCtx.currentTime + 0.3);
        }
    } catch (e) {}
}

// Socket Listeners
socket.on('time_sync', (data) => {
    document.getElementById('round').innerText = data.roundId;
    document.getElementById('timer').innerText = data.secondsRemaining;
    document.getElementById('istClock').innerText = data.istTime;

    const sec = parseFloat(data.secondsRemaining);
    if (sec <= 5.0 && sec > 0.2 && Math.floor(sec * 10) % 10 === 0) {
        playSound('tick');
    }
});

socket.on('round_result', (data) => {
    animate3DCoin(data.outcome);
    renderHistoryUI(data.history);
});

socket.on('user_sync', (userData) => {
    if (currentUser) {
        currentUser.balance = userData.balance;
        currentUser.streak = userData.streak;
        currentUser.currentBet = userData.currentBet;
        updateUserUI();
    }
});

socket.on('live_bet_feed', (feed) => {
    const feedContainer = document.getElementById('liveBetsFeed');
    if (!feedContainer) return;
    feedContainer.innerHTML = '';
    if (feed.length === 0) {
        feedContainer.innerHTML = `<span class="feed-item">Waiting for bets...</span>`;
    } else {
        feed.forEach(item => {
            const span = document.createElement('span');
            span.className = 'feed-item';
            span.innerText = item;
            feedContainer.appendChild(span);
        });
    }
});

socket.on('upi_changed', (newUpi) => {
    currentUpi = newUpi;
    document.getElementById('displayUpi').innerText = newUpi;
    updateQrCode();
});

socket.on('admin_state_update', (adminState) => {
    renderAdminPanel(adminState);
});

// User Auth Operations
function handleAuth(isSignUp) {
    const usernameInput = document.getElementById('authUsername').value;
    const passwordInput = document.getElementById('authPassword').value;
    const errDisplay = document.getElementById('authErrorMsg');

    socket.emit('user_login', { username: usernameInput, password: passwordInput, isSignUp }, (res) => {
        if (res.success) {
            currentUser = res.userData;
            document.getElementById('authSection').style.display = 'none';
            document.getElementById('gameSection').style.display = 'block';
            updateUserUI();
            errDisplay.innerText = '';
        } else {
            errDisplay.innerText = res.msg;
            playSound('lose');
        }
    });
}

function updateUserUI() {
    document.getElementById('balance').innerText = currentUser.balance;
    document.getElementById('streak').innerText = currentUser.streak;

    const statusMsg = document.getElementById('statusMessage');
    if (currentUser.currentBet) {
        statusMsg.style.color = '#38bdf8';
        statusMsg.innerText = `Active Bet: ₹${currentUser.currentBet.amount} on ${currentUser.currentBet.choice}`;
    }
}

// Bet Operations
function placeBet(choice) {
    if (!currentUser) return alert("Pehle Login karein!");
    const amount = Number(document.getElementById('betAmount').value);
    const statusMsg = document.getElementById('statusMessage');

    socket.emit('place_bet', { username: currentUser.username, choice, amount }, (res) => {
        statusMsg.style.color = res.success ? '#38bdf8' : '#ef4444';
        statusMsg.innerText = res.msg;
        if (res.success) {
            playSound('click');
            document.getElementById('betAmount').value = '';
        } else {
            playSound('lose');
        }
    });
}

function setBetAmount(val) {
    const input = document.getElementById('betAmount');
    input.value = (val === 'max') ? currentUser.balance : (Number(input.value) || 0) + val;
    playSound('click');
}

// 3D Coin Rotation Animation Engine
function animate3DCoin(outcome) {
    const coin = document.getElementById('coin3d');
    const resultDisplay = document.getElementById('resultDisplay');

    resultDisplay.innerText = "🌀 Flipping...";
    playSound('spin');

    currentRotation += 1800; // 5 full 360-degree spins
    if (outcome === 'TAILS') {
        currentRotation += 180;
    }

    coin.style.transform = `rotateY(${currentRotation}deg)`;

    setTimeout(() => {
        resultDisplay.innerText = `Result: ${outcome}`;
        if (currentUser && currentUser.currentBet) {
            if (currentUser.currentBet.choice === outcome) {
                playSound('win');
                if (typeof confetti === 'function') confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
            } else {
                playSound('lose');
            }
        }
    }, 1300);
}

// Deposit System Functions
function toggleDepositModal(show) {
    document.getElementById('depositModal').style.display = show ? 'flex' : 'none';
    if (show) updateQrCode();
}

function updateQrCode() {
    const qrImg = document.getElementById('qrImage');
    const upiUri = `upi://pay?pa=${currentUpi}&pn=RoyalFlip%20Deposit&cu=INR`;
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUri)}`;
}

function submitDeposit() {
    const amount = document.getElementById('depAmountInput').value;
    const txnId = document.getElementById('depTxnInput').value;

    socket.emit('request_deposit', { username: currentUser.username, amount, txnId }, (res) => {
        alert(res.msg);
        if (res.success) {
            toggleDepositModal(false);
            document.getElementById('depAmountInput').value = '';
            document.getElementById('depTxnInput').value = '';
        }
    });
}

// Secret Developer Admin Triggers (7 Taps)
function handleAdminTrigger() {
    adminTapSequence++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { adminTapSequence = 0; }, 1500);

    if (adminTapSequence >= 7) {
        adminTapSequence = 0;
        document.getElementById('authModal').style.display = 'flex';
    }
}

function authenticateAdmin() {
    const pass = document.getElementById('adminPasscode').value;
    if (pass === MASTER_PIN) {
        document.getElementById('authModal').style.display = 'none';
        document.getElementById('adminModal').style.display = 'flex';
        document.getElementById('adminPasscode').value = '';
        document.getElementById('adminPassErr').innerText = '';
        socket.emit('get_admin_data', (state) => renderAdminPanel(state));
    } else {
        document.getElementById('adminPassErr').innerText = "❌ GALAT PASSCODE";
        playSound('lose');
    }
}

function updateAdminUpi() {
    const newUpi = document.getElementById('adminUpiInput').value;
    socket.emit('admin_update_upi', { newUpi });
    alert("UPI ID Update Ho Gayi!");
}

function setForceMode(mode) {
    socket.emit('admin_set_mode', { mode });
}

function processDeposit(id, action) {
    socket.emit('admin_process_deposit', { id, action });
}

function adjustUserWallet() {
    const username = document.getElementById('targetUser').value;
    const amount = document.getElementById('targetAmount').value;

    if (!username || !amount) return alert("Username aur Amount dono bharein!");

    socket.emit('admin_modify_wallet', { username, amount });
    alert(`₹${amount} wallet update sent for ${username}!`);
    document.getElementById('targetUser').value = '';
    document.getElementById('targetAmount').value = '';
}

function renderAdminPanel(state) {
    document.getElementById('adminUsersCount').innerText = state.totalUsersCount;
    document.getElementById('adminHouseProfit').innerText = `₹${state.houseProfit}`;
    document.getElementById('adminTotalVolume').innerText = `₹${state.totalVolume}`;
    document.getElementById('adminCurrentMode').innerText = state.forceMode;

    const depList = document.getElementById('adminDepositList');
    depList.innerHTML = '';

    if (state.deposits.length === 0) {
        depList.innerHTML = `<div style="font-size: 0.75rem; color:#94a3b8;">Koi pending deposit nahi hai.</div>`;
    } else {
        state.deposits.forEach(d => {
            const item = document.createElement('div');
            item.className = 'admin-dep-item';
            item.innerHTML = `
                <span>User: <b>${d.uid}</b> | ₹${d.amount} | UTR: ${d.txnId}</span>
                <div>
                    <button onclick="processDeposit(${d.id}, 'APPROVED')" class="btn-approve">Approve</button>
                    <button onclick="processDeposit(${d.id}, 'REJECTED')" class="btn-reject">Reject</button>
                </div>
            `;
            depList.appendChild(item);
        });
    }
}

function renderHistoryUI(history) {
    const container = document.getElementById('historyChips');
    container.innerHTML = '';
    history.forEach(item => {
        const chip = document.createElement('div');
        chip.className = `chip ${item.toLowerCase()}`;
        chip.innerText = item === 'HEADS' ? 'H' : 'T';
        container.appendChild(chip);
    });
}
