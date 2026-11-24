require('dotenv').config();
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Kept strictly on server

const db = new Database(path.join(__dirname, 'topify.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grade TEXT DEFAULT 'Class 9',
    pet_id TEXT DEFAULT 'cat',
    xp INTEGER DEFAULT 50,
    streak INTEGER DEFAULT 1,
    study_minutes INTEGER DEFAULT 0,
    completed_missions INTEGER DEFAULT 0,
    notes_used INTEGER DEFAULT 0,
    images_used INTEGER DEFAULT 0,
    premium_until INTEGER DEFAULT NULL
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    title TEXT,
    subject TEXT,
    format TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/profile/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  res.json(user || null);
});

app.post('/api/profile', (req, res) => {
  const { id, name, grade, pet_id } = req.body;
  db.prepare(`
    INSERT INTO users (id, name, grade, pet_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, grade=excluded.grade, pet_id=excluded.pet_id
  `).run(id, name, grade || 'Class 9', pet_id || 'cat');
  res.json({ ok: true });
});

app.post('/api/reward/claim', (req, res) => {
  const { userId } = req.body;
  const until = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(until, userId);
  res.json({ ok: true, premiumUntil: until });
});

app.post('/api/ai/chat', async (req, res) => {
  const { prompt, grade } = req.body;
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Server GEMINI_API_KEY is not configured in .env' });
  }
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are TOPIFY, a friendly step-by-step AI tutor for a ${grade || 'school'} student. Explain clearly without dumping raw answers: ${prompt}`
          }]
        }]
      })
    });
    const data = await resp.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Let us break this down together!';
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reach AI provider' });
  }
});


db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    plan TEXT,
    amount_inr INTEGER,
    method TEXT,
    status TEXT DEFAULT 'paid',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

app.post('/api/payments/create-order', (req, res) => {
  const { userId, plan, amountInr, method } = req.body;
  const orderId = 'ORD_' + Date.now();
  db.prepare('INSERT INTO payments (id, user_id, plan, amount_inr, method) VALUES (?, ?, ?, ?, ?)').run(
    orderId, userId || 'guest', plan, amountInr, method || 'UPI'
  );
  res.json({ ok: true, orderId, amountInr, razorpayKeyId: process.env.RAZORPAY_KEY_ID || null });
});

app.get('/api/revenue/summary', (req, res) => {
  const totals = db.prepare('SELECT COALESCE(SUM(amount_inr), 0) AS totalInr, COUNT(*) AS orders FROM payments WHERE status = "paid"').get();
  const recent = db.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 10').all();
  res.json({ ...totals, recent });
});

app.listen(PORT, () => console.log(`TOPIFY server running on http://localhost:${PORT}`));
