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

// Server-Side Global Centralized Database (In-Memory for testing, replace with Database/MongoDB)
let globalState = {
    adminUpi: "paytmqr@upi",
    forceMode: "AUTO",
    totalVolume: 0,
    houseProfit: 0,
    users: {}, // { username: { password, balance, streak, currentBet: null } }
    deposits: [],
    withdrawals: [],
    history: ['HEADS', 'TAILS', 'HEADS']
};

// Central Real-Time Game Loop (Synced across all devices)
let currentRoundId = Math.floor(Date.now() / 30000);
let lastExecutedRound = -1;

setInterval(() => {
    const epochMs = Date.now();
    const roundId = Math.floor(epochMs / 30000);
    const msRemaining = 30000 - (epochMs % 30000);

    // Broadcast live timer & IST time to ALL connected devices
    io.emit('time_sync', {
        roundId: roundId,
        msRemaining: msRemaining,
        istTime: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) + '.' + Math.floor((epochMs % 1000) / 100)
    });

    if (msRemaining <= 300 && lastExecutedRound !== roundId) {
        lastExecutedRound = roundId;
        executeGlobalSpin(roundId);
    }
}, 100);

function executeGlobalSpin(roundId) {
    let outcome = globalState.forceMode === 'AUTO' 
        ? (roundId % 2 === 0 ? 'HEADS' : 'TAILS') 
        : globalState.forceMode;

    globalState.history.unshift(outcome);
    if (globalState.history.length > 6) globalState.history.pop();

    // Settle bets for all active users across devices
    Object.keys(globalState.users).forEach(username => {
        const user = globalState.users[username];
        if (user.currentBet) {
            globalState.totalVolume += user.currentBet.amount;
            if (user.currentBet.choice === outcome) {
                const winAmt = user.currentBet.amount * 2;
                user.balance += winAmt;
                user.streak++;
                globalState.houseProfit -= user.currentBet.amount;
            } else {
                user.streak = 0;
                globalState.houseProfit += user.currentBet.amount;
            }
            user.currentBet = null; // Clear active bet post settlement
        }
    });

    io.emit('round_result', {
        outcome: outcome,
        history: globalState.history
    });

    io.emit('admin_state_update', getAdminState());
}

function getAdminState() {
    return {
        adminUpi: globalState.adminUpi,
        forceMode: globalState.forceMode,
        totalVolume: globalState.totalVolume,
        houseProfit: globalState.houseProfit,
        users: globalState.users,
        deposits: globalState.deposits.filter(d => d.status === 'PENDING'),
        withdrawals: globalState.withdrawals.filter(w => w.status === 'PENDING')
    };
}

// Socket Connections for Real-Time Sync
io.on('connection', (socket) => {

    // User Authentication & Sync State on ANY Device
    socket.on('user_login', ({ username, password, isSignUp }, callback) => {
        if (isSignUp) {
            if (globalState.users[username]) {
                return callback({ success: false, msg: "User already exists!" });
            }
            globalState.users[username] = { password, balance: 0, streak: 0, currentBet: null };
        } else {
            if (!globalState.users[username] || globalState.users[username].password !== password) {
                return callback({ success: false, msg: "Invalid Username/Password!" });
            }
        }

        socket.join(`user_${username}`);
        callback({ 
            success: true, 
            userData: globalState.users[username],
            adminUpi: globalState.adminUpi 
        });
    });

    // Place Bet Request
    socket.on('place_bet', ({ username, choice, amount }, callback) => {
        const user = globalState.users[username];
        if (!user) return callback({ success: false, msg: "User not found!" });
        if (user.currentBet) return callback({ success: false, msg: "Bet already active!" });
        if (amount > user.balance) return callback({ success: false, msg: "Insufficient balance!" });

        user.balance -= amount;
        user.currentBet = { choice, amount };

        // Sync balance and bet to ALL devices where this user is logged in
        io.to(`user_${username}`).emit('user_sync', user);
        io.emit('admin_state_update', getAdminState());

        callback({ success: true });
    });

    // Add Money Request
    socket.on('request_deposit', ({ username, amount, txnId }, callback) => {
        globalState.deposits.push({ id: Date.now(), uid: username, amount, txnId, status: 'PENDING' });
        io.emit('admin_state_update', getAdminState());
        callback({ success: true, msg: "Deposit requested!" });
    });

    // Cashout Request
    socket.on('request_withdraw', ({ username, amount, upi }, callback) => {
        const user = globalState.users[username];
        if (!user || user.balance < amount) return callback({ success: false, msg: "Invalid or Insufficient Balance!" });

        user.balance -= amount;
        globalState.withdrawals.push({ id: Date.now(), uid: username, amount, upi, status: 'PENDING' });

        io.to(`user_${username}`).emit('user_sync', user);
        io.emit('admin_state_update', getAdminState());

        callback({ success: true, msg: "Withdrawal requested!" });
    });

    // Admin Controls
    socket.on('admin_update_upi', ({ newUpi }) => {
        globalState.adminUpi = newUpi;
        io.emit('upi_changed', newUpi);
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('admin_set_mode', ({ mode }) => {
        globalState.forceMode = mode;
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('admin_process_deposit', ({ id, action }) => {
        const req = globalState.deposits.find(d => d.id === id);
        if (req) {
            req.status = action;
            if (action === 'APPROVED') {
                globalState.users[req.uid].balance += req.amount;
                io.to(`user_${req.uid}`).emit('user_sync', globalState.users[req.uid]);
            }
        }
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('admin_process_withdraw', ({ id, action }) => {
        const req = globalState.withdrawals.find(w => w.id === id);
        if (req) {
            req.status = action;
            if (action === 'REJECTED') {
                globalState.users[req.uid].balance += req.amount; // Refund
                io.to(`user_${req.uid}`).emit('user_sync', globalState.users[req.uid]);
            }
        }
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('admin_modify_wallet', ({ username, action, amount }) => {
        const user = globalState.users[username];
        if (user) {
            if (action === 'SET') user.balance = amount;
            if (action === 'ADD') user.balance += amount;
            if (action === 'SUB') user.balance = Math.max(0, user.balance - amount);
            io.to(`user_${username}`).emit('user_sync', user);
        }
        io.emit('admin_state_update', getAdminState());
    });

    socket.on('get_admin_data', (callback) => {
        callback(getAdminState());
    });
});

server.listen(3000, () => console.log('🚀 Server running on port 3000'));
