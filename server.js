const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const ADMIN_SECRET = process.env.ADMIN_PASSWORD || "ADMIN@9988";
const MONGO_URI = process.env.MONGO_URI;

console.log("🚀 Starting Coin Flip Casino Server...");

/* =========================================================
   GMAIL SMTP / OTP CONFIGURATION
========================================================= */

const transporter = nodemailer.createTransport({
    service: 'gmail',

    auth: {
        user: 'sameerkhanl045632@gmail.com',
        pass: 'rtkrdhizhcwbsxnl'
    },

    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000
});

console.log("📧 Checking Gmail SMTP connection...");

transporter.verify()
    .then(() => {
        console.log("✅ Gmail Server OTP bhejne ke liye READY hai!");
    })
    .catch((error) => {
        console.error("❌ Gmail Transporter Connection Error:");
        console.error(error);
    });


/* =========================================================
   TEMPORARY OTP STORAGE
========================================================= */

const otpStore = new Map();


/* =========================================================
   MONGODB CONNECTION
========================================================= */

if (!MONGO_URI) {
    console.error("❌ CRITICAL ERROR: MONGO_URI is missing in Environment Variables!");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => {
            console.log("✅ Permanent MongoDB Database Connected Successfully!");
        })
        .catch(err => {
            console.error("❌ MongoDB Connection Error:");
            console.error(err);
        });
}


/* =========================================================
   DATABASE SCHEMAS
========================================================= */

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },

    password: {
        type: String,
        required: true
    },

    balance: {
        type: Number,
        default: 0
    },

    streak: {
        type: Number,
        default: 0
    }
});


const DepositSchema = new mongoose.Schema({
    id: Number,
    uid: String,
    amount: Number,
    txnId: String,

    status: {
        type: String,
        default: 'PENDING'
    },

    time: String
});


const WithdrawalSchema = new mongoose.Schema({
    id: Number,
    uid: String,
    amount: Number,
    upiDetails: String,

    status: {
        type: String,
        default: 'PENDING'
    },

    time: String
});


const SystemStateSchema = new mongoose.Schema({

    key: {
        type: String,
        default: 'global_config',
        unique: true
    },

    adminUpi: {
        type: String,
        default: "ishaquehaque107@okaxis"
    },

    forceMode: {
        type: String,
        default: "AUTO"
    },

    totalVolume: {
        type: Number,
        default: 0
    },

    houseProfit: {
        type: Number,
        default: 0
    },

    history: {
        type: Array,
        default: [
            'HEADS',
            'TAILS',
            'HEADS',
            'HEADS',
            'TAILS',
            'HEADS'
        ]
    }

});


const User = mongoose.model('User', UserSchema);
const Deposit = mongoose.model('Deposit', DepositSchema);
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);
const SystemState = mongoose.model('SystemState', SystemStateSchema);


/* =========================================================
   LIVE MEMORY DATA
========================================================= */

const onlineUsers = new Map();

const activeBets = new Map();

let recentBetsFeed = [];

let lastExecutedRound = -1;


/* =========================================================
   SYSTEM CONFIG
========================================================= */

async function getSystemConfig() {

    let config = await SystemState.findOne({
        key: 'global_config'
    });

    if (!config) {

        config = await SystemState.create({
            key: 'global_config'
        });

    }

    return config;
}


/* =========================================================
   GLOBAL 30 SECOND TIMER
========================================================= */

setInterval(async () => {

    try {

        const epochMs = Date.now();

        const roundId = Math.floor(epochMs / 30000);

        const msRemaining =
            30000 - (epochMs % 30000);


        const nowIST = new Date(
            epochMs + (5.5 * 60 * 60 * 1000)
        );


        const hours = String(
            nowIST.getUTCHours() % 12 || 12
        ).padStart(2, '0');


        const minutes = String(
            nowIST.getUTCMinutes()
        ).padStart(2, '0');


        const seconds = String(
            nowIST.getUTCSeconds()
        ).padStart(2, '0');


        const ampm =
            nowIST.getUTCHours() >= 12
                ? 'PM'
                : 'AM';


        const subSec = Math.floor(
            (epochMs % 1000) / 100
        );


        const formattedIst =
            `${hours}:${minutes}:${seconds}.${subSec} ${ampm}`;


        io.emit('time_sync', {

            roundId: roundId,

            msRemaining: msRemaining,

            secondsRemaining:
                (msRemaining / 1000).toFixed(1),

            istTime: formattedIst

        });


        if (
            msRemaining <= 200 &&
            lastExecutedRound !== roundId
        ) {

            lastExecutedRound = roundId;

            executeGlobalSpin(roundId);

        }

    } catch (error) {

        console.error(
            "❌ Timer Error:",
            error
        );

    }

}, 100);


/* =========================================================
   EXECUTE GAME ROUND
========================================================= */

async function executeGlobalSpin(roundId) {

    try {

        const config =
            await getSystemConfig();


        let outcome;


        if (config.forceMode === 'AUTO') {

            let totalHeadsAmount = 0;

            let totalTailsAmount = 0;


            for (let bet of activeBets.values()) {

                if (bet.choice === 'HEADS') {
                    totalHeadsAmount += bet.amount;
                }

                if (bet.choice === 'TAILS') {
                    totalTailsAmount += bet.amount;
                }

            }


            if (totalHeadsAmount < totalTailsAmount) {

                outcome = 'HEADS';

            } else if (totalTailsAmount < totalHeadsAmount) {

                outcome = 'TAILS';

            } else {

                outcome =
                    roundId % 2 === 0
                        ? 'HEADS'
                        : 'TAILS';

            }

        } else {

            outcome = config.forceMode;

        }


        config.history.unshift(outcome);


        if (config.history.length > 10) {

            config.history.pop();

        }


        for (
            let [username, bet]
            of activeBets.entries()
        ) {

            const user =
                await User.findOne({
                    username
                });


            if (user) {

                config.totalVolume += bet.amount;


                const isWin =
                    bet.choice === outcome;


                if (isWin) {

                    const winPayout =
                        bet.amount * 2;


                    user.balance +=
                        winPayout;


                    user.streak += 1;


                    config.houseProfit -=
                        bet.amount;

                } else {

                    user.streak = 0;


                    config.houseProfit +=
                        bet.amount;

                }


                await user.save();


                io.to(
                    `user_${username}`
                ).emit(
                    'bet_settled',
                    {

                        isWin: isWin,

                        amountWon:
                            isWin
                                ? bet.amount * 2
                                : 0,

                        user: user

                    }
                );

            }

        }


        await config.save();


        activeBets.clear();

        recentBetsFeed = [];


        io.emit(
            'round_result',
            {

                outcome: outcome,

                history: config.history

            }
        );


        const adminData =
            await getAdminState();


        io.emit(
            'admin_state_update',
            adminData
        );


    } catch (error) {

        console.error(
            "❌ Global Spin Error:",
            error
        );

    }

}


/* =========================================================
   ADMIN DATA
========================================================= */

async function getAdminState() {

    const config =
        await getSystemConfig();


    const allUsers =
        await User.find({});


    const pendingDeposits =
        await Deposit.find({
            status: 'PENDING'
        });


    const pendingWithdrawals =
        await Withdrawal.find({
            status: 'PENDING'
        });


    const activeUsersList =
        allUsers.map(u => {

            const isOnline =
                Array.from(
                    onlineUsers.values()
                ).includes(
                    u.username
                );


            const activeBetObj =
                activeBets.get(
                    u.username
                );


            return {

                username:
                    u.username,

                balance:
                    u.balance,

                streak:
                    u.streak,

                isOnline:
                    isOnline,

                activeBet:
                    activeBetObj
                        ? `${activeBetObj.amount} on ${activeBetObj.choice}`
                        : "None"

            };

        });


    return {

        adminUpi:
            config.adminUpi,

        forceMode:
            config.forceMode,

        totalVolume:
            config.totalVolume,

        houseProfit:
            config.houseProfit,

        totalUsersCount:
            allUsers.length,

        usersList:
            activeUsersList,

        deposits:
            pendingDeposits,

        withdrawals:
            pendingWithdrawals

    };

}


/* =========================================================
   SOCKET CONNECTION
========================================================= */

io.on('connection', async (socket) => {

    console.log(
        "🟢 New Socket Connected:",
        socket.id
    );


    try {

        const config =
            await getSystemConfig();


        socket.emit(
            'upi_changed',
            config.adminUpi
        );


        socket.emit(
            'history_update',
            config.history
        );


        socket.emit(
            'live_bet_feed',
            recentBetsFeed
        );


    } catch (error) {

        console.error(
            "❌ Initial Socket Config Error:",
            error
        );

    }


    /* =====================================================
       SEND OTP
    ===================================================== */

    socket.on(
        'send_otp',

        async ({ email }, callback) => {

            console.log(
                "📩 OTP REQUEST RECEIVED:",
                email
            );


            if (
                typeof callback !== 'function'
            ) {

                console.error(
                    "❌ OTP Callback Missing"
                );

                return;

            }


            if (
                !email ||
                !email.includes('@')
            ) {

                console.log(
                    "❌ Invalid Email:",
                    email
                );


                return callback({

                    success: false,

                    msg:
                        "Sahi Email Address enter karein!"

                });

            }


            const cleanEmail =
                String(email)
                    .trim()
                    .toLowerCase();


            const generatedOtp =
                Math.floor(
                    100000 +
                    Math.random() * 900000
                ).toString();


            const expiresAt =
                Date.now() +
                (5 * 60 * 1000);


            otpStore.set(
                cleanEmail,
                {
                    otp:
                        generatedOtp,

                    expiresAt:
                        expiresAt
                }
            );


            console.log(
                `🔐 OTP Generated for ${cleanEmail}`
            );


            const mailOptions = {

                from:
                    '"Coin Flip Live Casino" <YOUR_GMAIL@gmail.com>',

                to:
                    cleanEmail,

                subject:
                    'Your Security OTP Code - Coin Flip Casino',

                html: `

                <div style="
                    font-family: Arial, sans-serif;
                    padding: 20px;
                    background-color: #0f172a;
                    color: #ffffff;
                    border-radius: 10px;
                    max-width: 500px;
                    margin: auto;
                ">

                    <h2 style="
                        color: #facc15;
                        text-align: center;
                    ">
                        COIN FLIP CASINO
                    </h2>

                    <p style="
                        font-size: 16px;
                    ">
                        Aapka Login/Signup OTP verification code hai:
                    </p>

                    <div style="
                        background-color: #1e293b;
                        padding: 15px;
                        text-align: center;
                        border-radius: 8px;
                        font-size: 32px;
                        font-weight: bold;
                        color: #22c55e;
                        letter-spacing: 6px;
                        margin: 20px 0;
                    ">

                        ${generatedOtp}

                    </div>

                    <p style="
                        font-size: 12px;
                        color: #94a3b8;
                        text-align: center;
                    ">

                        Ye OTP 5 minute ke liye valid hai.
                        Kisi ke sath share na karein!

                    </p>

                </div>

                `

            };


            try {

                console.log(
                    "📤 Sending OTP email..."
                );


                const info =
                    await transporter.sendMail(
                        mailOptions
                    );


                console.log(
                    "✅ OTP EMAIL SENT SUCCESSFULLY!"
                );


                console.log(
                    "📧 Message ID:",
                    info.messageId
                );


                callback({

                    success: true,

                    msg:
                        "OTP aapke Gmail par bhej diya gaya hai!"

                });


            } catch (err) {

                console.error(
                    "❌ EMAIL SEND ERROR:"
                );


                console.error(err);


                otpStore.delete(
                    cleanEmail
                );


                callback({

                    success: false,

                    msg:
                        "OTP bhejne me dikkat aayi. Render Logs check karein!"

                });

            }

        }

    );


    /* =====================================================
       VERIFY OTP AND LOGIN / SIGNUP
    ===================================================== */

    socket.on(
        'user_login',

        async (
            {
                username,
                password,
                otp,
                isSignUp
            },

            callback
        ) => {

            try {

                if (
                    typeof callback !== 'function'
                ) {
                    return;
                }


                if (
                    !username ||
                    !password ||
                    !otp
                ) {

                    return callback({

                        success: false,

                        msg:
                            "Email, Password aur OTP teenon zaroori hain!"

                    });

                }


                const cleanEmail =
                    String(username)
                        .trim()
                        .toLowerCase();


                const cleanPassword =
                    String(password)
                        .trim();


                const cleanOtp =
                    String(otp)
                        .trim();


                const storedOtpData =
                    otpStore.get(
                        cleanEmail
                    );


                if (!storedOtpData) {

                    return callback({

                        success: false,

                        msg:
                            "Pehle Send OTP button par click karke OTP mangwaye!"

                    });

                }


                if (
                    Date.now() >
                    storedOtpData.expiresAt
                ) {

                    otpStore.delete(
                        cleanEmail
                    );


                    return callback({

                        success: false,

                        msg:
                            "OTP expire ho chuka hai! Phir se OTP bhejein."

                    });

                }


                if (
                    storedOtpData.otp !==
                    cleanOtp
                ) {

                    return callback({

                        success: false,

                        msg:
                            "Galat OTP enter kiya hai!"

                    });

                }


                otpStore.delete(
                    cleanEmail
                );


                let user =
                    await User.findOne({

                        username:
                            cleanEmail

                    });


                if (isSignUp) {

                    if (user) {

                        return callback({

                            success: false,

                            msg:
                                "Is Email se pehle se account bana hua hai! Directly Login karein."

                        });

                    }


                    user =
                        await User.create({

                            username:
                                cleanEmail,

                            password:
                                cleanPassword,

                            balance:
                                0,

                            streak:
                                0

                        });


                } else {

                    if (
                        !user ||
                        user.password !== cleanPassword
                    ) {

                        return callback({

                            success: false,

                            msg:
                                "Galat Email ya Password!"

                        });

                    }

                }


                socket.join(
                    `user_${cleanEmail}`
                );


                onlineUsers.set(
                    socket.id,
                    cleanEmail
                );


                const config =
                    await getSystemConfig();


                callback({

                    success: true,

                    userData:
                        user,

                    adminUpi:
                        config.adminUpi

                });


                const adminData =
                    await getAdminState();


                io.emit(
                    'admin_state_update',
                    adminData
                );


            } catch (error) {

                console.error(
                    "❌ Login Error:",
                    error
                );


                callback({

                    success: false,

                    msg:
                        "Server Login Error!"

                });

            }

        }

    );


    /* =====================================================
       PLACE BET
    ===================================================== */

    socket.on(
        'place_bet',

        async (
            {
                username,
                choice,
                amount
            },

            callback
        ) => {

            if (
                typeof callback !== 'function'
            ) return;


            const cleanUsername =
                String(username)
                    .trim()
                    .toLowerCase();


            const user =
                await User.findOne({

                    username:
                        cleanUsername

                });


            if (!user) {

                return callback({

                    success: false,

                    msg:
                        "Pehle Login karein!"

                });

            }


            if (
                activeBets.has(
                    cleanUsername
                )
            ) {

                return callback({

                    success: false,

                    msg:
                        "Is round me bet lag chuki hai!"

                });

            }


            if (
                !amount ||
                amount < 10
            ) {

                return callback({

                    success: false,

                    msg:
                        "Minimum bet amount ₹10 hai!"

                });

            }


            if (
                amount > user.balance
            ) {

                return callback({

                    success: false,

                    msg:
                        "Insufficient Wallet Balance!"

                });

            }


            user.balance -=
                Number(amount);


            await user.save();


            activeBets.set(
                cleanUsername,
                {

                    choice,
                    amount:
                        Number(amount)

                }
            );


            const feedEntry =
                `${cleanUsername.toUpperCase()}: ₹${amount} on ${choice}`;


            recentBetsFeed.push(
                feedEntry
            );


            if (
                recentBetsFeed.length > 8
            ) {

                recentBetsFeed.shift();

            }


            io.emit(
                'live_bet_feed',
                recentBetsFeed
            );


            io.to(
                `user_${cleanUsername}`
            ).emit(
                'user_sync',
                user
            );


            const adminData =
                await getAdminState();


            io.emit(
                'admin_state_update',
                adminData
            );


            callback({

                success: true,

                msg:
                    `₹${amount} bet ${choice} par lag gayi!`

            });

        }

    );


    /* =====================================================
       DEPOSIT REQUEST
    ===================================================== */

    socket.on(
        'request_deposit',

        async (
            {
                username,
                amount,
                txnId
            },

            callback
        ) => {

            if (
                typeof callback !== 'function'
            ) return;


            const cleanUsername =
                String(username)
                    .trim()
                    .toLowerCase();


            if (
                !amount ||
                Number(amount) < 100
            ) {

                return callback({

                    success: false,

                    msg:
                        "Minimum deposit amount ₹100 hai!"

                });

            }


            if (
                !txnId ||
                txnId.trim() === ""
            ) {

                return callback({

                    success: false,

                    msg:
                        "Transaction/UTR ID enter karein!"

                });

            }


            await Deposit.create({

                id:
                    Date.now(),

                uid:
                    cleanUsername,

                amount:
                    Number(amount),

                txnId:
                    txnId.trim(),

                status:
                    'PENDING',

                time:
                    new Date().toLocaleTimeString()

            });


            const adminData =
                await getAdminState();


            io.emit(
                'admin_state_update',
                adminData
            );


            callback({

                success: true,

                msg:
                    "Deposit Request Submitted! Verification ke baad balance add hoga."

            });

        }

    );


    /* =====================================================
       WITHDRAWAL REQUEST
    ===================================================== */

    socket.on(
        'request_withdrawal',

        async (
            {
                username,
                amount,
                upiDetails
            },

            callback
        ) => {

            if (
                typeof callback !== 'function'
            ) return;


            const cleanUsername =
                String(username)
                    .trim()
                    .toLowerCase();


            const user =
                await User.findOne({

                    username:
                        cleanUsername

                });


            if (!user) {

                return callback({

                    success: false,

                    msg:
                        "Pehle login karein!"

                });

            }


            if (
                !amount ||
                Number(amount) < 300
            ) {

                return callback({

                    success: false,

                    msg:
                        "Minimum withdrawal amount ₹300 hai!"

                });

            }


            if (
                Number(amount) >
                user.balance
            ) {

                return callback({

                    success: false,

                    msg:
                        "Aapke paas itna balance nahi hai!"

                });

            }


            if (
                !upiDetails ||
                upiDetails.trim() === ""
            ) {

                return callback({

                    success: false,

                    msg:
                        "UPI ID ya Bank details enter karein!"

                });

            }


            user.balance -=
                Number(amount);


            await user.save();


            await Withdrawal.create({

                id:
                    Date.now(),

                uid:
                    cleanUsername,

                amount:
                    Number(amount),

                upiDetails:
                    upiDetails.trim(),

                status:
                    'PENDING',

                time:
                    new Date().toLocaleTimeString()

            });


            io.to(
                `user_${cleanUsername}`
            ).emit(
                'user_sync',
                user
            );


            const adminData =
                await getAdminState();


            io.emit(
                'admin_state_update',
                adminData
            );


            callback({

                success: true,

                msg:
                    "Withdrawal Request Received! 15-30 mins me paise bhej diye jayenge."

            });

        }

    );


    /* =====================================================
       GET WITHDRAWAL HISTORY
    ===================================================== */

    socket.on(
        'get_user_withdrawals',

        async (
            { username },
            callback
        ) => {

            if (
                typeof callback !== 'function'
            ) return;


            const cleanUsername =
                String(username)
                    .trim()
                    .toLowerCase();


            const userHistory =
                await Withdrawal.find({

                    uid:
                        cleanUsername

                });


            callback({

                success: true,

                history:
                    userHistory

            });

        }

    );


    /* =====================================================
       ADMIN LOGIN
    ===================================================== */

    socket.on(
        'admin_login',

        async (
            { adminPassword },
            callback
        ) => {

            if (
                typeof callback !== 'function'
            ) return;


            if (
                adminPassword ===
                ADMIN_SECRET
            ) {

                const adminData =
                    await getAdminState();


                callback({

                    success: true,

                    data:
                        adminData

                });

            } else {

                callback({

                    success: false,

                    msg:
                        "Incorrect Admin Password!"

                });

            }

        }

    );


    /* =====================================================
       UPDATE ADMIN UPI
    ===================================================== */

    socket.on(
        'admin_update_upi',

        async (
            {
                adminSecret,
                newUpi
            }
        ) => {

            if (
                adminSecret !==
                ADMIN_SECRET
            ) return;


            if (
                newUpi &&
                newUpi.trim() !== ""
            ) {

                const config =
                    await getSystemConfig();


                config.adminUpi =
                    newUpi.trim();


                await config.save();


                io.emit(
                    'upi_changed',
                    config.adminUpi
                );


                const adminData =
                    await getAdminState();


                io.emit(
                    'admin_state_update',
                    adminData
                );

            }

        }

    );


    /* =====================================================
       ADMIN SET MODE
    ===================================================== */

    socket.on(
        'admin_set_mode',

        async (
            {
                adminSecret,
                mode
            }
        ) => {

            if (
                adminSecret !==
                ADMIN_SECRET
            ) return;


            const config =
                await getSystemConfig();


            config.forceMode =
                mode;


            await config.save();


            const adminData =
                await getAdminState();


            io.emit(
                'admin_state_update',
                adminData
            );

        }

    );


    /* =====================================================
       PROCESS DEPOSIT
    ===================================================== */

    socket.on(
        'admin_process_deposit',

        async (
            {
                adminSecret,
                id,
                action
            }
        ) => {

            if (
                adminSecret !==
                ADMIN_SECRET
            ) return;


            const dep =
                await Deposit.findOne({

                    id,

                    status:
                        'PENDING'

                });


            if (dep) {

                dep.status =
                    action;


                await dep.save();


                if (
                    action ===
                    'APPROVED'
                ) {

                    const user =
                        await User.findOne({

                            username:
                                dep.uid

                        });


                    if (user) {

                        user.balance +=
                            dep.amount;


                        await user.save();


                        io.to(
                            `user_${dep.uid}`
                        ).emit(
                            'user_sync',
                            user
                        );

                    }

                }


                io.to(
                    `user_${dep.uid}`
                ).emit(
                    'admin_payment_notification',
                    {

                        title:
                            action === 'APPROVED'
                                ? 'Deposit Approved! 🎉'
                                : 'Deposit Rejected ❌',

                        message:
                            action === 'APPROVED'
                                ? `Aapka ₹${dep.amount} deposit approve ho gaya hai aur wallet me add ho chuka hai.`
                                : `Aapka ₹${dep.amount} deposit reject kar diya gaya hai.`,

                        type:
                            action === 'APPROVED'
                                ? 'success'
                                : 'error'

                    }
                );

            }


            const adminData =
                await getAdminState();


            io.emit(
                'admin_state_update',
                adminData
            );

        }

    );


    /* =====================================================
       PROCESS WITHDRAWAL
    ===================================================== */

    socket.on(
        'admin_process_withdrawal',

        async (
            {
                adminSecret,
                id,
                action
            }
        ) => {

            if (
                adminSecret !==
                ADMIN_SECRET
            ) return;


            const wdr =
                await Withdrawal.findOne({

                    id,

                    status:
                        'PENDING'

                });


            if (wdr) {

                wdr.status =
                    action;


                await wdr.save();


                if (
                    action ===
                    'REJECTED'
                ) {

                    const user =
                        await User.findOne({

                            username:
                                wdr.uid

                        });


                    if (user) {

                        user.balance +=
                            wdr.amount;


                        await user.save();


                        io.to(
                            `user_${wdr.uid}`
                        ).emit(
                            'user_sync',
                            user
                        );

                    }

                }


                io.to(
                    `user_${wdr.uid}`
                ).emit(
                    'admin_payment_notification',
                    {

                        title:
                            action === 'APPROVED'
                                ? 'Withdrawal Payment Sent! 💰'
                                : 'Withdrawal Rejected ❌',

                        message:
                            action === 'APPROVED'
                                ? `Aapka ₹${wdr.amount} Ka Withdrawal Success Ho Gaya Hai! Payment Aapke Paytm/UPI Me Bhej Di Gayi Hai.`
                                : `Aapka ₹${wdr.amount} ka withdrawal request reject ho gaya hai. Balance wallet me refund kar diya gaya hai.`,

                        type:
                            action === 'APPROVED'
                                ? 'success'
                                : 'error'

                    }
                );

            }


            const adminData =
                await getAdminState();


            io.emit(
                'admin_state_update',
                adminData
            );

        }

    );


    /* =====================================================
       MODIFY WALLET
    ===================================================== */

    socket.on(
        'admin_modify_wallet',

        async (
            {
                adminSecret,
                username,
                amount
            }
        ) => {

            if (
                adminSecret !==
                ADMIN_SECRET
            ) return;


            const cleanUsername =
                String(username)
                    .trim()
                    .toLowerCase();


            const user =
                await User.findOne({

                    username:
                        cleanUsername

                });


            if (user) {

                user.balance =
                    Math.max(
                        0,
                        user.balance +
                        Number(amount)
                    );


                await user.save();


                io.to(
                    `user_${cleanUsername}`
                ).emit(
                    'user_sync',
                    user
                );

            }


            const adminData =
                await getAdminState();


            io.emit(
                'admin_state_update',
                adminData
            );

        }

    );


    /* =====================================================
       GET ADMIN DATA
    ===================================================== */

    socket.on(
        'get_admin_data',

        async (
            { adminSecret },
            callback
        ) => {

            if (
                adminSecret ===
                ADMIN_SECRET &&
                typeof callback === 'function'
            ) {

                const adminData =
                    await getAdminState();


                callback(
                    adminData
                );

            }

        }

    );


    /* =====================================================
       DISCONNECT
    ===================================================== */

    socket.on(
        'disconnect',

        async () => {

            console.log(
                "🔴 Socket Disconnected:",
                socket.id
            );


            onlineUsers.delete(
                socket.id
            );


            try {

                const adminData =
                    await getAdminState();


                io.emit(
                    'admin_state_update',
                    adminData
                );

            } catch (error) {

                console.error(
                    "❌ Disconnect Error:",
                    error
                );

            }

        }

    );

});


/* =========================================================
   START SERVER
========================================================= */

const PORT =
    process.env.PORT || 3000;


server.listen(
    PORT,
    () => {

        console.log(
            `🚀 Casino Engine Running on Port ${PORT}`
        );

        console.log(
            "🌐 Server is ready!"
        );

    }
);