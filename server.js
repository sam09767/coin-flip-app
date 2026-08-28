require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secretkey',
    resave: false,
    saveUninitialized: true
}));

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected Successfully'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Schemas
const userSchema = new mongoose.Schema({
    username: String,
    balance: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const betSchema = new mongoose.Schema({
    userId: String,
    choice: String,
    amount: Number,
    roundId: Number,
    createdAt: { type: Date, default: Date.now }
});
const Bet = mongoose.model('Bet', betSchema);

let currentRound = 1;
let gameOutcome = null;

// Game Loop (Every 60 Seconds)
setInterval(async () => {
    const bets = await Bet.find({ roundId: currentRound });
    let headTotal = 0;
    let tailTotal = 0;

    bets.forEach(b => {
        if (b.choice === 'HEADS') headTotal += b.amount;
        if (b.choice === 'TAILS') tailTotal += b.amount;
    });

    // Least bet side wins
    if (headTotal < tailTotal) {
        gameOutcome = 'HEADS';
    } else if (tailTotal < headTotal) {
        gameOutcome = 'TAILS';
    } else {
        gameOutcome = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
    }

    console.log(`Round ${currentRound} Result: ${gameOutcome}`);
    currentRound++;
}, 60000);

// API Routes
app.get('/api/game-status', (req, res) => {
    res.json({ round: currentRound, lastOutcome: gameOutcome });
});

app.post('/api/place-bet', async (req, res) => {
    const { choice, amount, userId } = req.body;
    if (!choice || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid bet details' });
    }
    const newBet = new Bet({ userId: userId || 'guest', choice, amount, roundId: currentRound });
    await newBet.save();
    res.json({ success: true, message: 'Bet placed successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
