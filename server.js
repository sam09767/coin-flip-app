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

// SECRET ADMIN PASSWORD
const ADMIN_SECRET = process.env.ADMIN_PASSWORD || "ADMIN@9988";

// Active socket connection tracking
const onlineUsers = new Map(); // socket.id -> username

let globalState = {
    adminUpi: "ishaquehaque107@okaxis",
    forceMode: "AUTO", // AUTO, HEADS, TAILS
    totalVolume: 0,
    houseProfit: 0,
    users: {}, // { username: { password, balance, streak, currentBet: null } }
    deposits: [],
    history: ['HEADS', 'TAILS', 'HEADS', 'HEADS', 'TAILS', 'HEADS'],
    recentBetsFeed: []
};

let lastExecutedRound = -1;

// Central Game Loop (30 Second Timer)
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
        outcome = (roundId % 2 === 0) ? 'HEADS' : 'TAILS';
    } else {
        outcome = globalState.forceMode;
    }

    globalState.history.unshift(outcome);
    if (globalState.history.length > 10) globalState.history.pop();

    // Calculate payouts and settle all active bets
    Object.keys(globalState.users).forEach(username => {
        const user = globalState.users[username];
        if (user && user.currentBet) {
            globalState.totalVolume += user.currentBet.amount;
            
            if (user.currentBet.choice === outcome) {
                // WIN: Give back original bet + win profit (2x total)
                const winPayout = user.currentBet.amount * 2;
                user.balance += winPayout;
                user.streak += 1;
                globalState.houseProfit -= user.currentBet.amount;
            } else {
                // LOSS: Balance was already deducted during bet placement
                user.streak = 0;
                globalState.houseProfit += user.currentBet.amount;
            }
            
            user.currentBet = null;
            io.to(`user_${username}`).emit('user_sync', user);
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
        deposits: globalState.deposits.filter(d => d.status === 'PENDING')
    };
}

io.on('connection', (socket) => {
    socket.emit('upi_changed', globalState.adminUpi);
    socket.emit('history_update', globalState.history);
    socket.emit('live_bet_feed', globalState.recentBetsFeed);

    socket.on('user_login', ({ username, password, isSignUp }, callback) => {
        if (!username || !password) {
            return callback({ success: false, msg: "Username aur Password required hain!" });
        }

        const cleanUsername = username.trim().toLowerCase();

        if (isSignUp) {
            if (globalState.users[cleanUsername]) {
                return callback({ success: false, msg: "Ye Username pehle se maujood hai!" });
            }
            globalState.users[cleanUsername] = {
                username: cleanUsername,
                password: password,
                balance: 100, // Signup Bonus
                streak: 0,
                currentBet: null
            };
        } else {
            if (!globalState.users[cleanUsername] || globalState.users[cleanUsername].password !== password) {
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
        const cleanUsername = username.trim().toLowerCase();
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

    socket.on('request_deposit', ({ username, amount, txnId }, callback) => {
        const cleanUsername = username.trim().toLowerCase();
        if (!amount || amount <= 0 || !txnId) {
            return callback({ success: false, msg: "Valid Amount aur Transaction ID dalein!" });
        }

        const newDeposit = {
            id: Date.now(),
            uid: cleanUsername,
            amount: Number(amount),
            txnId: txnId,
            status: 'PENDING',
            time: new Date().toLocaleTimeString()
        };

        globalState.deposits.push(newDeposit);
        io.emit('admin_state_update', getAdminState());
        callback({ success: true, msg: "Deposit Request Submitted!" });
    });

    // SECURE ADMIN CONTROLS
    socket.on('admin_login', ({ adminPassword }, callback) => {
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
        }
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('admin_modify_wallet', ({ adminSecret, username, amount }) => {
        if (adminSecret !== ADMIN_SECRET) return;
        const cleanUsername = username.trim().toLowerCase();
        const user = globalState.users[cleanUsername];
        if (user) {
            user.balance = Math.max(0, user.balance + Number(amount));
            io.to(`user_${cleanUsername}`).emit('user_sync', user);
        }
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('get_admin_data', ({ adminSecret }, callback) => {
        if (adminSecret === ADMIN_SECRET && callback) {
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
