const socket = io();

let activeUser = null;
let currentRotation = 0;
let isSignUpMode = false;
let adminTapSequence = 0;
let tapTimer = null;
const MASTER_PIN = "9876";

// 1. Real-time Clock and Round Sync from Backend
socket.on('time_sync', (data) => {
    document.getElementById('istClock').innerText = data.istTime;
    document.getElementById('round').innerText = data.roundId;
    document.getElementById('timer').innerText = (data.msRemaining / 1000).toFixed(1);
});

// 2. Real-time Automatic State Sync across ALL login sessions/devices
socket.on('user_sync', (userData) => {
    if (!userData) return;
    document.getElementById('balance').innerText = userData.balance;
    document.getElementById('streak').innerText = userData.streak;

    const statusMsg = document.getElementById('statusMessage');
    if (userData.currentBet) {
        statusMsg.innerText = `Active Bet: ₹${userData.currentBet.amount} on ${userData.currentBet.choice}`;
        statusMsg.style.color = '#38bdf8';
    }
});

// 3. Live UPI Update Sync across devices
socket.on('upi_changed', (newUpi) => {
    document.getElementById('userDepositUpiDisplay').innerText = newUpi;
});

// 4. Live Coin Flip Result Settle
socket.on('round_result', (data) => {
    const coin = document.getElementById('coin');
    currentRotation += 1800;
    if (data.outcome === 'TAILS') currentRotation += 180;
    coin.style.transform = `rotateY(${currentRotation}deg)`;

    setTimeout(() => {
        document.getElementById('resultText').innerText = `Result: ${data.outcome}`;
        renderHistoryUI(data.history);
    }, 1300);
});

// Admin Panel Auto Live Sync
socket.on('admin_state_update', (data) => {
    renderAdminPayouts(data);
});

// Auth Engine (Sign Up / Login)
function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    document.getElementById('authTitle').innerText = isSignUpMode ? '📝 USER SIGN UP' : '🔑 USER LOGIN';
    document.getElementById('authSubmitBtn').innerText = isSignUpMode ? 'CREATE ACCOUNT' : 'LOGIN';
}

function processUserAuth() {
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value.trim();

    if (!username || !password) return alert('Enter credentials!');

    socket.emit('user_login', { username, password, isSignUp: isSignUpMode }, (res) => {
        if (!res.success) {
            document.getElementById('userAuthError').innerText = res.msg;
            return;
        }

        activeUser = username;
        document.getElementById('userTag').innerText = activeUser;
        document.getElementById('balance').innerText = res.userData.balance;
        document.getElementById('streak').innerText = res.userData.streak;
        document.getElementById('userDepositUpiDisplay').innerText = res.adminUpi;
        document.getElementById('userAuthModal').style.display = 'none';
    });
}

// Bet Action
function placeBet(choice) {
    const amount = parseFloat(document.getElementById('betAmount').value);
    if (!amount || amount < 10) return alert('Enter valid amount!');

    socket.emit('place_bet', { username: activeUser, choice, amount }, (res) => {
        if (!res.success) alert(res.msg);
    });
}

// Deposit and Withdraw Actions
function openDepositModal() { document.getElementById('depositModal').style.display = 'flex'; }
function closeDepositModal() { document.getElementById('depositModal').style.display = 'none'; }

function submitDepositRequest() {
    const amount = parseFloat(document.getElementById('depositAmt').value);
    const txnId = document.getElementById('depositTxnId').value.trim();

    socket.emit('request_deposit', { username: activeUser, amount, txnId }, (res) => {
        alert(res.msg);
        closeDepositModal();
    });
}

function openWithdrawModal() { document.getElementById('withdrawModal').style.display = 'flex'; }
function closeWithdrawModal() { document.getElementById('withdrawModal').style.display = 'none'; }

function submitWithdrawalRequest() {
    const upi = document.getElementById('withdrawUpi').value.trim();
    const amount = parseFloat(document.getElementById('withdrawAmt').value);

    socket.emit('request_withdraw', { username: activeUser, amount, upi }, (res) => {
        alert(res.msg);
        closeWithdrawModal();
    });
}

// Admin Trigger & Controls
function handleSecureAdminTrigger() {
    adminTapSequence++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { adminTapSequence = 0; }, 1500);

    if (adminTapSequence >= 7) {
        adminTapSequence = 0;
        document.getElementById('authModal').style.display = 'flex';
    }
}

function authenticateAdmin() {
    if (document.getElementById('adminPasscode').value === MASTER_PIN) {
        document.getElementById('authModal').style.display = 'none';
        document.getElementById('adminModal').style.display = 'flex';
        socket.emit('get_admin_data', renderAdminPayouts);
    } else {
        alert('Invalid Admin PIN');
    }
}

function closeAdminPanel() { document.getElementById('adminModal').style.display = 'none'; }

function adminUpdateUpi() {
    const newUpi = document.getElementById('admUpiInput').value.trim();
    if (newUpi) socket.emit('admin_update_upi', { newUpi });
}

function setForceOutcome(mode) {
    socket.emit('admin_set_mode', { mode });
}

function renderAdminPayouts(data) {
    const depList = document.getElementById('admDepositList');
    depList.innerHTML = data.deposits.map(d => `
        <div class="payout-item">
            <div>${d.uid} - ₹${d.amount} (${d.txnId})</div>
            <div>
                <button onclick="socket.emit('admin_process_deposit', {id: ${d.id}, action: 'APPROVED'})">Approve</button>
                <button onclick="socket.emit('admin_process_deposit', {id: ${d.id}, action: 'REJECTED'})">Reject</button>
            </div>
        </div>
    `).join('') || '<p>No pending deposits</p>';

    const wdList = document.getElementById('admPayoutList');
    wdList.innerHTML = data.withdrawals.map(w => `
        <div class="payout-item">
            <div>${w.uid} - ₹${w.amount} (${w.upi})</div>
            <div>
                <button onclick="socket.emit('admin_process_withdraw', {id: ${w.id}, action: 'APPROVED'})">Approve</button>
                <button onclick="socket.emit('admin_process_withdraw', {id: ${w.id}, action: 'REJECTED'})">Reject</button>
            </div>
        </div>
    `).join('') || '<p>No pending withdrawals</p>';
}

function renderHistoryUI(history) {
    const historyContainer = document.getElementById('historyChips');
    historyContainer.innerHTML = '';
    history.forEach(item => {
        const chip = document.createElement('span');
        chip.className = `chip ${item.toLowerCase()}`;
        chip.innerText = item === 'HEADS' ? 'H' : 'T';
        historyContainer.appendChild(chip);
    });
}
