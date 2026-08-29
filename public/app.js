const socket = io();

let currentUser = null;
let currentRotation = 0;
let currentAdminSecret = null;

// Auto-Login Check On Page Load / Refresh
window.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('coin_app_user');
    if (saved) {
        const { username, password } = JSON.parse(saved);
        socket.emit('user_login', { username, password, isSignUp: false }, (res) => {
            if (res.success) {
                onLoginSuccess(res.userData, res.adminUpi, username, password);
            } else {
                localStorage.removeItem('coin_app_user');
            }
        });
    }
});

// Auth Submit Handler
function submitAuth(isSignUp) {
    const uInput = document.getElementById('authUsername').value;
    const pInput = document.getElementById('authPassword').value;
    const msgBox = document.getElementById('authMsg');

    if (!uInput || !pInput) {
        msgBox.innerText = "Username aur Password dalein!";
        msgBox.style.color = "#ef4444";
        return;
    }

    socket.emit('user_login', { username: uInput, password: pInput, isSignUp }, (res) => {
        if (res.success) {
            onLoginSuccess(res.userData, res.adminUpi, uInput, pInput);
        } else {
            msgBox.innerText = res.msg;
            msgBox.style.color = "#ef4444";
        }
    });
}

function onLoginSuccess(userData, adminUpi, username, password) {
    currentUser = userData;
    localStorage.setItem('coin_app_user', JSON.stringify({ username, password }));
    
    document.getElementById('authModal').style.display = 'none';
    document.getElementById('walletBalance').innerText = `₹${userData.balance}`;
    document.getElementById('adminUpiText').innerText = adminUpi;
}

// Timer & IST Sync Listener
socket.on('time_sync', (data) => {
    document.getElementById('roundIdText').innerText = `#${data.roundId}`;
    document.getElementById('countdownTimer').innerText = `${data.secondsRemaining}s`;
    document.getElementById('istTimeText').innerText = `IST Time: ${data.istTime}`;
});

// Accurate Coin Spin Animation Logic
socket.on('round_result', (data) => {
    const coin = document.getElementById('coin3d');
    
    currentRotation += 1800;
    if (data.outcome === 'TAILS') {
        currentRotation += 180;
    }
    
    if (currentRotation % 360 !== (data.outcome === 'HEADS' ? 0 : 180)) {
        currentRotation += (data.outcome === 'HEADS' ? 0 : 180) - (currentRotation % 360);
    }

    coin.style.transform = `rotateY(${currentRotation}deg)`;

    setTimeout(() => {
        document.getElementById('resultText').innerText = `RESULT: ${data.outcome}`;
        document.getElementById('statusMsg').innerText = "";
    }, 1300);

    renderHistory(data.history);
});

// Real-Time Socket Listeners
socket.on('user_sync', (user) => {
    currentUser = user;
    document.getElementById('walletBalance').innerText = `₹${user.balance}`;
});

socket.on('upi_changed', (upi) => {
    document.getElementById('adminUpiText').innerText = upi;
});

socket.on('live_bet_feed', (feed) => {
    const feedBox = document.getElementById('betsFeed');
    if (feed.length === 0) {
        feedBox.innerHTML = `<div class="feed-item">Waiting for bets...</div>`;
    } else {
        feedBox.innerHTML = feed.map(f => `<div class="feed-item">${f}</div>`).join('');
    }
});

socket.on('history_update', renderHistory);

function renderHistory(hist) {
    const container = document.getElementById('historyChips');
    container.innerHTML = hist.map(h => `<div class="chip ${h.toLowerCase()}">${h[0]}</div>`).join('');
}

// Betting Handlers
function setBetAmount(amt) {
    const input = document.getElementById('betAmountInput');
    input.value = Number(input.value || 0) + amt;
}

function placeBet(choice) {
    if (!currentUser) return alert("Pehle login karein!");
    const amt = Number(document.getElementById('betAmountInput').value);
    
    socket.emit('place_bet', { username: currentUser.username, choice, amount: amt }, (res) => {
        const msg = document.getElementById('statusMsg');
        msg.innerText = res.msg;
        msg.style.color = res.success ? "#22c55e" : "#ef4444";
    });
}

// Deposit Handlers
document.getElementById('openDepositBtn').addEventListener('click', () => {
    document.getElementById('depositModal').style.display = 'flex';
});

function submitDeposit() {
    const amt = document.getElementById('depAmount').value;
    const txn = document.getElementById('depTxnId').value;

    socket.emit('request_deposit', { username: currentUser.username, amount: amt, txnId: txn }, (res) => {
        alert(res.msg);
        if (res.success) closeModal('depositModal');
    });
}

// SECRET ADMIN TRIGGER: 10 TAPS IN 1.5 SECONDS
let logoTapTimestamps = [];

document.getElementById('brandBtn').addEventListener('click', () => {
    const now = Date.now();
    logoTapTimestamps.push(now);

    // Keep only taps within the last 1500ms (1.5 seconds)
    logoTapTimestamps = logoTapTimestamps.filter(timestamp => now - timestamp <= 1500);

    if (logoTapTimestamps.length >= 10) {
        logoTapTimestamps = []; // Reset counter

        if (currentAdminSecret) {
            socket.emit('get_admin_data', { adminSecret: currentAdminSecret }, (data) => {
                renderAdminPanel(data);
                document.getElementById('adminModal').style.display = 'flex';
            });
        } else {
            document.getElementById('adminPassInput').value = "";
            document.getElementById('adminAuthMsg').innerText = "";
            document.getElementById('adminAuthModal').style.display = 'flex';
        }
    }
});

function verifyAdminPassword() {
    const pass = document.getElementById('adminPassInput').value;
    const msgBox = document.getElementById('adminAuthMsg');

    socket.emit('admin_login', { adminPassword: pass }, (res) => {
        if (res.success) {
            currentAdminSecret = pass;
            closeModal('adminAuthModal');
            renderAdminPanel(res.data);
            document.getElementById('adminModal').style.display = 'flex';
        } else {
            msgBox.innerText = res.msg;
            msgBox.style.color = "#ef4444";
        }
    });
}

socket.on('admin_state_update', (data) => {
    if (document.getElementById('adminModal').style.display === 'flex' && currentAdminSecret) {
        renderAdminPanel(data);
    }
});

function renderAdminPanel(data) {
    document.getElementById('adminProfit').innerText = `₹${data.houseProfit}`;
    document.getElementById('adminVolume').innerText = `₹${data.totalVolume}`;

    let uHTML = "";
    data.usersList.forEach(u => {
        uHTML += `
            <div class="admin-dep-item">
                <div>
                    <strong>${u.username}</strong> ${u.isOnline ? '🟢' : '🔴'}<br>
                    <small>Bal: ₹${u.balance} | Bet: ${u.activeBet}</small>
                </div>
                <button class="btn-approve" onclick="addMoney('${u.username}')">+ Cash</button>
            </div>
        `;
    });
    document.getElementById('adminUsersContainer').innerHTML = uHTML || "No Users";

    let dHTML = "";
    data.deposits.forEach(d => {
        dHTML += `
            <div class="admin-dep-item">
                <div>
                    <strong>${d.uid}</strong>: ₹${d.amount}<br>
                    <small>Txn: ${d.txnId}</small>
                </div>
                <div>
                    <button class="btn-approve" onclick="processDep(${d.id}, 'APPROVED')">✓</button>
                    <button class="btn-reject" onclick="processDep(${d.id}, 'REJECTED')">✕</button>
                </div>
            </div>
        `;
    });
    document.getElementById('adminDepositsContainer').innerHTML = dHTML || "No Pending Requests";
}

function setAdminMode(mode) {
    socket.emit('admin_set_mode', { adminSecret: currentAdminSecret, mode });
}

function updateAdminUpi() {
    const upi = document.getElementById('newUpiInput').value;
    socket.emit('admin_update_upi', { adminSecret: currentAdminSecret, newUpi: upi });
}

function processDep(id, action) {
    socket.emit('admin_process_deposit', { adminSecret: currentAdminSecret, id, action });
}

function addMoney(username) {
    const amt = prompt(`${username} ke wallet me kitne paise jodna/ghatana chahte hain? (e.g. 500 ya -200)`);
    if (amt) {
        socket.emit('admin_modify_wallet', { adminSecret: currentAdminSecret, username, amount: Number(amt) });
    }
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}
