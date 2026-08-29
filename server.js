const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const ADMIN_SECRET = process.env.ADMIN_PASSWORD || "ADMIN@9988";
const onlineUsers = new Map();

let globalState = {
    adminUpi: "ishaquehaque107@okaxis",
    forceMode: "AUTO",
    totalVolume: 0,
    houseProfit: 0,
    users: {},
    deposits: [],
    withdrawals: [],
    history: ['HEADS', 'TAILS', 'HEADS', 'HEADS', 'TAILS', 'HEADS'],
    recentBetsFeed: []
};

let lastExecutedRound = -1;

setInterval(() => {
    const epochMs = Date.now();
    const roundId = Math.floor(epochMs / 30000);
    const msRemaining = 30000 - (epochMs % 30000);

    const nowIST = new Date(epochMs + (5.5 * 60 * 60 * 1000));
    const hours = String(nowIST.getUTCHours() % 12 || 12).padStart(2, '0');
    const minutes = String(nowIST.getUTCMinutes()).padStart(2, '0');
    const seconds = String(nowIST.getUTCSeconds()).padStart(2, '0');
    const ampm = nowIST.getUTCHours() >= 12 ? 'PM' : 'AM';
    const subSec = Math.floor((epochMs % 1000) / 100);

    const formattedIst = `${hours}:${minutes}:${seconds}.${subSec} ${ampm}`;

    io.emit('time_sync', {
        roundId: roundId,
        msRemaining: msRemaining,
        secondsRemaining: (msRemaining / 1000).toFixed(1),
        istTime: formattedIst
    });

    if (msRemaining <= 200 && lastExecutedRound !== roundId) {
        lastExecutedRound = roundId;
        executeGlobalSpin(roundId);
    }
}, 100);

function executeGlobalSpin(roundId) {
    let outcome;

    if (globalState.forceMode === 'AUTO') {
        // Calculate Total Bets on HEADS vs TAILS
        let totalHeadsAmount = 0;
        let totalTailsAmount = 0;

        Object.values(globalState.users).forEach(u => {
            if (u && u.currentBet) {
                if (u.currentBet.choice === 'HEADS') {
                    totalHeadsAmount += u.currentBet.amount;
                } else if (u.currentBet.choice === 'TAILS') {
                    totalTailsAmount += u.currentBet.amount;
                }
            }
        });

        // Lowest bet outcome comes out as the WINNER
        if (totalHeadsAmount < totalTailsAmount) {
            outcome = 'HEADS';
        } else if (totalTailsAmount < totalHeadsAmount) {
            outcome = 'TAILS';
        } else {
            // If equal bets on both, fall back to round alternation
            outcome = (roundId % 2 === 0) ? 'HEADS' : 'TAILS';
        }
    } else {
        outcome = globalState.forceMode;
    }

    globalState.history.unshift(outcome);
    if (globalState.history.length > 10) globalState.history.pop();

    Object.keys(globalState.users).forEach(username => {
        const user = globalState.users[username];
        if (user && user.currentBet) {
            globalState.totalVolume += user.currentBet.amount;
            
            const isWin = user.currentBet.choice === outcome;
            const betAmt = user.currentBet.amount;

            if (isWin) {
                const winPayout = betAmt * 2;
                user.balance += winPayout;
                user.streak += 1;
                globalState.houseProfit -= betAmt;
            } else {
                user.streak = 0;
                globalState.houseProfit += betAmt;
            }
            
            io.to(`user_${username}`).emit('bet_settled', {
                isWin: isWin,
                amountWon: isWin ? betAmt * 2 : 0,
                user: user
            });

            user.currentBet = null;
        }
    });

    globalState.recentBetsFeed = [];

    io.emit('round_result', {
        outcome: outcome,
        history: globalState.history
    });

    io.emit('admin_state_update', getAdminState());
}

function getAdminState() {
    const activeUsersList = Object.keys(globalState.users).map(uname => {
        const u = globalState.users[uname];
        const isOnline = Array.from(onlineUsers.values()).includes(uname);
        return {
            username: u.username,
            balance: u.balance,
            streak: u.streak,
            isOnline: isOnline,
            activeBet: u.currentBet ? `${u.currentBet.amount} on ${u.currentBet.choice}` : "None"
        };
    });

    return {
        adminUpi: globalState.adminUpi,
        forceMode: globalState.forceMode,
        totalVolume: globalState.totalVolume,
        houseProfit: globalState.houseProfit,
        totalUsersCount: Object.keys(globalState.users).length,
        usersList: activeUsersList,
        deposits: globalState.deposits.filter(d => d.status === 'PENDING'),
        withdrawals: globalState.withdrawals.filter(w => w.status === 'PENDING')
    };
}

io.on('connection', (socket) => {
    socket.emit('upi_changed', globalState.adminUpi);
    socket.emit('history_update', globalState.history);
    socket.emit('live_bet_feed', globalState.recentBetsFeed);

    socket.on('user_login', ({ username, password, isSignUp }, callback) => {
        if (typeof callback !== 'function') return;
        if (!username || !password) {
            return callback({ success: false, msg: "Username aur Password required hain!" });
        }

        const cleanUsername = String(username).trim().toLowerCase();
        const cleanPassword = String(password).trim();

        if (isSignUp) {
            if (globalState.users[cleanUsername]) {
                return callback({ success: false, msg: "Ye Username pehle se maujood hai!" });
            }
            globalState.users[cleanUsername] = {
                username: cleanUsername,
                password: cleanPassword,
                balance: 100,
                streak: 0,
                currentBet: null
            };
        } else {
            if (!globalState.users[cleanUsername] || globalState.users[cleanUsername].password !== cleanPassword) {
                return callback({ success: false, msg: "Galat Username ya Password!" });
            }
        }

        socket.join(`user_${cleanUsername}`);
        onlineUsers.set(socket.id, cleanUsername);

        callback({
            success: true,
            userData: globalState.users[cleanUsername],
            adminUpi: globalState.adminUpi
        });

        io.emit('admin_state_update', getAdminState());
    });

    socket.on('place_bet', ({ username, choice, amount }, callback) => {
        if (typeof callback !== 'function') return;
        const cleanUsername = String(username).trim().toLowerCase();
        const user = globalState.users[cleanUsername];

        if (!user) return callback({ success: false, msg: "Pehle Login karein!" });
        if (user.currentBet) return callback({ success: false, msg: "Is round me bet lag chuki hai!" });
        if (!amount || amount < 10) return callback({ success: false, msg: "Minimum bet amount ₹10 hai!" });
        if (amount > user.balance) return callback({ success: false, msg: "Insufficient Wallet Balance!" });

        user.balance -= Number(amount);
        user.currentBet = { choice, amount: Number(amount) };

        const feedEntry = `${cleanUsername.toUpperCase()}: ₹${amount} on ${choice}`;
        globalState.recentBetsFeed.push(feedEntry);
        if (globalState.recentBetsFeed.length > 8) globalState.recentBetsFeed.shift();

        io.emit('live_bet_feed', globalState.recentBetsFeed);
        io.to(`user_${cleanUsername}`).emit('user_sync', user);
        io.emit('admin_state_update', getAdminState());

        callback({ success: true, msg: `₹${amount} bet ${choice} par lag gayi!` });
    });

    // MINIMUM DEPOSIT ₹100
    socket.on('request_deposit', ({ username, amount, txnId }, callback) => {
        if (typeof callback !== 'function') return;
        const cleanUsername = String(username).trim().toLowerCase();
        
        if (!amount || Number(amount) < 100) {
            return callback({ success: false, msg: "Minimum deposit amount ₹100 hai!" });
        }
        if (!txnId || txnId.trim() === "") {
            return callback({ success: false, msg: "Transaction/UTR ID enter karein!" });
        }

        const newDeposit = {
            id: Date.now(),
            uid: cleanUsername,
            amount: Number(amount),
            txnId: txnId.trim(),
            status: 'PENDING',
            time: new Date().toLocaleTimeString()
        };

        globalState.deposits.push(newDeposit);
        io.emit('admin_state_update', getAdminState());
        callback({ success: true, msg: "Deposit Request Submitted! Verification ke baad balance add hoga." });
    });

    // MINIMUM WITHDRAWAL ₹300
    socket.on('request_withdrawal', ({ username, amount, upiDetails }, callback) => {
        if (typeof callback !== 'function') return;
        const cleanUsername = String(username).trim().toLowerCase();
        const user = globalState.users[cleanUsername];

        if (!user) return callback({ success: false, msg: "Pehle login karein!" });
        if (!amount || Number(amount) < 300) {
            return callback({ success: false, msg: "Minimum withdrawal amount ₹300 hai!" });
        }
        if (Number(amount) > user.balance) {
            return callback({ success: false, msg: "Aapke paas itna balance nahi hai!" });
        }
        if (!upiDetails || upiDetails.trim() === "") {
            return callback({ success: false, msg: "UPI ID ya Bank details enter karein!" });
        }

        user.balance -= Number(amount);

        const newWithdrawal = {
            id: Date.now(),
            uid: cleanUsername,
            amount: Number(amount),
            upiDetails: upiDetails.trim(),
            status: 'PENDING',
            time: new Date().toLocaleTimeString()
        };

        globalState.withdrawals.push(newWithdrawal);
        io.to(`user_${cleanUsername}`).emit('user_sync', user);
        io.emit('admin_state_update', getAdminState());
        callback({ success: true, msg: "Withdrawal Request Received! 15-30 mins me paise bhej diye jayenge." });
    });

    // GET USER WITHDRAWAL HISTORY
    socket.on('get_user_withdrawals', ({ username }, callback) => {
        if (typeof callback !== 'function') return;
        const cleanUsername = String(username).trim().toLowerCase();
        const userHistory = globalState.withdrawals.filter(w => w.uid === cleanUsername);
        callback({ success: true, history: userHistory });
    });

    // ADMIN CONTROLS
    socket.on('admin_login', ({ adminPassword }, callback) => {
        if (typeof callback !== 'function') return;
        if (adminPassword === ADMIN_SECRET) {
            callback({ success: true, data: getAdminState() });
        } else {
            callback({ success: false, msg: "Incorrect Admin Password!" });
        }
    });

    socket.on('admin_update_upi', ({ adminSecret, newUpi }) => {
        if (adminSecret !== ADMIN_SECRET) return;
        if (newUpi && newUpi.trim() !== "") {
            globalState.adminUpi = newUpi.trim();
            io.emit('upi_changed', globalState.adminUpi);
            io.emit('admin_state_update', getAdminState());
        }
    });

    socket.on('admin_set_mode', ({ adminSecret, mode }) => {
        if (adminSecret !== ADMIN_SECRET) return;
        globalState.forceMode = mode;
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('admin_process_deposit', ({ adminSecret, id, action }) => {
        if (adminSecret !== ADMIN_SECRET) return;
        const dep = globalState.deposits.find(d => d.id === id);
        if (dep && dep.status === 'PENDING') {
            dep.status = action;
            if (action === 'APPROVED') {
                const user = globalState.users[dep.uid];
                if (user) {
                    user.balance += dep.amount;
                    io.to(`user_${dep.uid}`).emit('user_sync', user);
                }
            }

            // Real-Time Notification to User
            io.to(`user_${dep.uid}`).emit('admin_payment_notification', {
                title: action === 'APPROVED' ? 'Deposit Approved! 🎉' : 'Deposit Rejected ❌',
                message: action === 'APPROVED' 
                    ? `Aapka ₹${dep.amount} deposit approve ho gaya hai aur wallet me add ho chuka hai.` 
                    : `Aapka ₹${dep.amount} deposit reject kar diya gaya hai.`,
                type: action === 'APPROVED' ? 'success' : 'error'
            });
        }
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('admin_process_withdrawal', ({ adminSecret, id, action }) => {
        if (adminSecret !== ADMIN_SECRET) return;
        const wdr = globalState.withdrawals.find(w => w.id === id);
        if (wdr && wdr.status === 'PENDING') {
            wdr.status = action;
            if (action === 'REJECTED') {
                const user = globalState.users[wdr.uid];
                if (user) {
                    user.balance += wdr.amount; // Refund if rejected
                    io.to(`user_${wdr.uid}`).emit('user_sync', user);
                }
            }

            // Real-Time Notification to User when Admin Pays / Rejects
            io.to(`user_${wdr.uid}`).emit('admin_payment_notification', {
                title: action === 'APPROVED' ? 'Withdrawal Payment Sent! 💰' : 'Withdrawal Rejected ❌',
                message: action === 'APPROVED' 
                    ? `Aapka ₹${wdr.amount} Ka Withdrawal Success Ho Gaya Hai! Payment Aapke Paytm/UPI Me Bhej Di Gayi Hai.` 
                    : `Aapka ₹${wdr.amount} ka withdrawal request reject ho gaya hai. Balance wallet me refund kar diya gaya hai.`,
                type: action === 'APPROVED' ? 'success' : 'error'
            });
        }
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('admin_modify_wallet', ({ adminSecret, username, amount }) => {
        if (adminSecret !== ADMIN_SECRET) return;
        const cleanUsername = String(username).trim().toLowerCase();
        const user = globalState.users[cleanUsername];
        if (user) {
            user.balance = Math.max(0, user.balance + Number(amount));
            io.to(`user_${cleanUsername}`).emit('user_sync', user);
        }
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('get_admin_data', ({ adminSecret }, callback) => {
        if (adminSecret === ADMIN_SECRET && typeof callback === 'function') {
            callback(getAdminState());
        }
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('admin_state_update', getAdminState());
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Casino Engine Running on Port ${PORT}`));
