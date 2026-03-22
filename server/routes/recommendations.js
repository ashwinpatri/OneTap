const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const Card = require('../models/Card');

const CARD_PRODUCTS = [
  {
    name: 'Venture X',
    annualFee: 395,
    rewardTiers: [
      { rate: 10, unit: 'miles', categories: ['hotels', 'car-rental'] },
      { rate: 5, unit: 'miles', categories: ['flights'] },
      { rate: 2, unit: 'miles', categories: ['everything'] },
    ],
  },
  {
    name: 'SavorOne',
    annualFee: 0,
    rewardTiers: [
      { rate: 3, unit: 'percent_cashback', categories: ['dining', 'entertainment', 'streaming', 'groceries'] },
      { rate: 1, unit: 'percent_cashback', categories: ['everything'] },
    ],
  },
  {
    name: 'Quicksilver',
    annualFee: 0,
    rewardTiers: [
      { rate: 1.5, unit: 'percent_cashback', categories: ['everything'] },
    ],
  },
  {
    name: 'Venture',
    annualFee: 95,
    rewardTiers: [
      { rate: 5, unit: 'miles', categories: ['hotels', 'car-rental'] },
      { rate: 2, unit: 'miles', categories: ['everything'] },
    ],
  },
  {
    name: 'Savor',
    annualFee: 95,
    rewardTiers: [
      { rate: 4, unit: 'percent_cashback', categories: ['dining', 'entertainment'] },
      { rate: 3, unit: 'percent_cashback', categories: ['streaming', 'groceries'] },
      { rate: 1, unit: 'percent_cashback', categories: ['everything'] },
    ],
  },
];

router.get('/', auth, async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const transactions = await Transaction.find({
      userId: req.userId,
      date: { $gte: oneMonthAgo },
      status: { $ne: 'refunded' },
    });

    const spendingByCategory = {};
    for (const tx of transactions) {
      const cat = tx.merchantCategory || 'general';
      spendingByCategory[cat] = (spendingByCategory[cat] || 0) + tx.amount;
    }

    if (Object.keys(spendingByCategory).length === 0) {
      return res.json({ recommendation: 'No transactions found in the last month to base a recommendation on.', spendingSummary: {} });
    }

    const userCards = await Card.find({ userId: req.userId, isActive: true }).select('productName');
    const userCardNames = userCards.map(c => c.productName);

    const topCategories = Object.entries(spendingByCategory)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([cat]) => cat);

    const spendingSummary = Object.entries(spendingByCategory)
      .map(([cat, amt]) => `${cat}: $${amt.toFixed(2)}`)
      .join(', ');

    const cardList = CARD_PRODUCTS.map(c => {
      const tiers = c.rewardTiers.map(t =>
        `${t.rate}x ${t.unit === 'percent_cashback' ? '% cash back' : t.unit} on ${t.categories.join('/')}`
      ).join('; ');
      return `${c.name} ($${c.annualFee}/yr annual fee): ${tiers}`;
    }).join('\n');

    const prompt = `A user spent the following amounts last month: ${spendingSummary}.
Their top spending categories were: ${topCategories.join(', ')}.
The user currently has these Capital One cards: ${userCardNames.length > 0 ? userCardNames.join(', ') : 'none'}.

Here are the available Capital One cards:
${cardList}

Based on this spending, determine the single best Capital One card for this user. Respond using EXACTLY this template, filling in the bracketed parts — do not add anything else:

"Your largest categories this month were [category 1], [category 2], and [category 3], and based off your spending, the best card for you would be the [Card Name]. You [already have / do not yet have] this card, [great job maximizing your rewards! / explore the [Card Name] to maximize your rewards!]"

Use "already have" and "great job maximizing your rewards!" if the user's card list includes the recommended card. Otherwise use "do not yet have" and "explore the [Card Name] to maximize your rewards!".`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}));
      return res.status(502).json({ error: `Gemini request failed: ${geminiRes.status} — ${JSON.stringify(err)}` });
    }

    const geminiData = await geminiRes.json();
    const recommendation = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    res.json({ recommendation, spendingSummary: spendingByCategory, userCardNames });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
