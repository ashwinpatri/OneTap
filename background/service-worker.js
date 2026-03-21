// One Tap Background Service Worker — MongoDB backend
import { selectBestCard } from './card-selector.js';

const BACKEND_BASE = 'http://localhost:3001';

const CARD_META = [
  { id: 'venture-x',  name: 'Venture X',   lastFour: '4821', type: 'visa',       rewardRate: 2,   bonusRate: 10,  rewardUnit: 'miles',       categories: ['travel', 'hotels', 'car-rental', 'flights'],         gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', textColor: '#FFFFFF', isDefault: true,  rewards: 0 },
  { id: 'savor-one',  name: 'SavorOne',    lastFour: '7293', type: 'mastercard', rewardRate: 1,   bonusRate: 3,   rewardUnit: 'cash back %', categories: ['dining', 'entertainment', 'streaming', 'groceries'], gradient: 'linear-gradient(135deg, #2d2d2d 0%, #1a1a1a 50%, #0d0d0d 100%)', textColor: '#FFFFFF', isDefault: false, rewards: 0 },
  { id: 'quicksilver',name: 'Quicksilver', lastFour: '5510', type: 'visa',       rewardRate: 1.5, bonusRate: 1.5, rewardUnit: 'cash back %', categories: ['everything'],                                        gradient: 'linear-gradient(135deg, #c0c0c0 0%, #a8a8a8 50%, #808080 100%)', textColor: '#1A1A1A', isDefault: false, rewards: 0 },
  { id: 'venture',    name: 'Venture',     lastFour: '3347', type: 'visa',       rewardRate: 2,   bonusRate: 5,   rewardUnit: 'miles',       categories: ['travel', 'hotels'],                                  gradient: 'linear-gradient(135deg, #004977 0%, #003557 50%, #002840 100%)', textColor: '#FFFFFF', isDefault: false, rewards: 0 },
];

const MOCK_OFFERS = [
  { id: 'offer-1', merchant: 'Amazon',        merchantIcon: '📦', description: '10% back on your next purchase',      discount: 0.10, maxSavings: 15.00,  expiresAt: '2026-04-15', cardId: 'venture-x',   activated: true  },
  { id: 'offer-2', merchant: 'Uber Eats',     merchantIcon: '🍔', description: '5x miles on delivery orders',         discount: 0.05, maxSavings: 10.00,  expiresAt: '2026-04-01', cardId: 'venture-x',   activated: false },
  { id: 'offer-3', merchant: 'DoorDash',      merchantIcon: '🚗', description: '20% off your first 3 orders',         discount: 0.20, maxSavings: 25.00,  expiresAt: '2026-03-30', cardId: 'savor-one',   activated: false },
  { id: 'offer-4', merchant: 'Target',        merchantIcon: '🎯', description: '3x points on all purchases',          discount: 0.03, maxSavings: 20.00,  expiresAt: '2026-04-20', cardId: 'quicksilver', activated: true  },
  { id: 'offer-5', merchant: 'Whole Foods',   merchantIcon: '🥑', description: '5% back on groceries',                discount: 0.05, maxSavings: 12.00,  expiresAt: '2026-04-10', cardId: 'savor-one',   activated: false },
  { id: 'offer-6', merchant: 'Netflix',       merchantIcon: '🎬', description: '3 months of 3x rewards on streaming', discount: 0.03, maxSavings: 5.00,   expiresAt: '2026-06-01', cardId: 'savor-one',   activated: true  },
  { id: 'offer-7', merchant: 'Delta Airlines',merchantIcon: '✈️', description: '10x miles on flights',                discount: 0.10, maxSavings: 100.00, expiresAt: '2026-05-15', cardId: 'venture-x',   activated: false },
  { id: 'offer-8', merchant: 'Hilton Hotels', merchantIcon: '🏨', description: '8x miles on hotel bookings',          discount: 0.08, maxSavings: 80.00,  expiresAt: '2026-05-01', cardId: 'venture',     activated: false },
];

// ─── Backend (MongoDB) helpers ────────────────────────────────────────────────

async function getAuthState() {
  const { onetapUser } = await chrome.storage.local.get('onetapUser');
  return onetapUser || null;
}

async function backend(path, method = 'GET', body) {
  const user = await getAuthState();
  const res = await fetch(`${BACKEND_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

// Initialize settings on first install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({
      settings: { autoDetect: true, showFloatingButton: true, defaultCardId: 'venture-x', notifications: true },
    });
  }
  console.log('[One Tap] Extension installed');
});

async function handleMessage(message) {
  switch (message.type) {

    case 'GET_ALL_CARDS': {
      return { cards: CARD_META };
    }

    case 'GET_OFFERS': {
      const { offers = MOCK_OFFERS } = await chrome.storage.local.get('offers');
      return { offers };
    }

    case 'CHECKOUT_DETECTED': {
      const { merchant, amount } = message.payload;
      const { offers = MOCK_OFFERS } = await chrome.storage.local.get('offers');
      const bestCard = selectBestCard(merchant, amount, CARD_META, offers);
      const matchingOffers = offers.filter(o =>
        o.merchant.toLowerCase() === merchant.toLowerCase() ||
        merchant.toLowerCase().includes(o.merchant.toLowerCase())
      );
      return { bestCard, offers: matchingOffers, allCards: CARD_META };
    }

    case 'GET_BEST_CARD': {
      const { merchant, amount } = message.payload;
      const { offers = MOCK_OFFERS } = await chrome.storage.local.get('offers');
      return { bestCard: selectBestCard(merchant, amount, CARD_META, offers) };
    }

    case 'PROCESS_PAYMENT': {
      const { cardId, amount, merchant } = message.payload;
      const card = CARD_META.find(c => c.id === cardId);
      if (!card) return { success: false, error: 'Card not found' };

      const rewardUnit = card.rewardUnit.replace(' %', '');
      const rewardsEarned = rewardUnit === 'miles'
        ? Math.round(amount * card.rewardRate)
        : parseFloat((amount * card.rewardRate / 100).toFixed(2));

      const transaction = {
        id: `tx-${Date.now()}`,
        merchant,
        amount,
        cardId,
        cardName: card.name,
        rewardsEarned,
        rewardUnit,
        date: new Date().toISOString().split('T')[0],
        status: 'completed',
      };

      const authUser = await getAuthState();
      if (authUser) {
        await backend(`/api/users/${authUser.userId}/transactions`, 'POST', transaction);
      }

      return {
        success: true,
        transaction,
        confirmationNumber: `CO-${Date.now().toString(36).toUpperCase()}`,
      };
    }

    case 'GET_SETTINGS': {
      const { settings } = await chrome.storage.local.get('settings');
      return { settings: settings || { autoDetect: true, showFloatingButton: true, notifications: true } };
    }

    case 'UPDATE_SETTINGS': {
      const { settings } = await chrome.storage.local.get('settings');
      const newSettings = { ...settings, ...message.payload };
      await chrome.storage.local.set({ settings: newSettings });
      const authState = await getAuthState();
      if (authState) {
        await backend(`/api/users/${authState.userId}/settings`, 'PATCH', newSettings);
      }
      return { settings: newSettings };
    }

    case 'GET_AUTH_STATE': {
      const user = await getAuthState();
      return { user };
    }

    case 'AUTH_LOGIN': {
      const res = await backend('/api/auth/login', 'POST', message.payload);
      if (res.error) return { error: res.error };
      await chrome.storage.local.set({ onetapUser: res });
      await backend(`/api/users/${res.userId}/cards`, 'PUT', { cards: CARD_META });
      const { offers = MOCK_OFFERS } = await chrome.storage.local.get('offers');
      await backend(`/api/users/${res.userId}/offers`, 'PUT', { offers });
      return { user: res };
    }

    case 'AUTH_REGISTER': {
      const res = await backend('/api/auth/register', 'POST', message.payload);
      if (res.error) return { error: res.error };
      await chrome.storage.local.set({ onetapUser: res });
      await backend(`/api/users/${res.userId}/cards`, 'PUT', { cards: CARD_META });
      const { offers = MOCK_OFFERS } = await chrome.storage.local.get('offers');
      await backend(`/api/users/${res.userId}/offers`, 'PUT', { offers });
      return { user: res };
    }

    case 'AUTH_LOGOUT': {
      await chrome.storage.local.remove('onetapUser');
      return { success: true };
    }

    case 'GET_TRANSACTIONS': {
      const authUser = await getAuthState();
      if (authUser) {
        const dbRes = await backend(`/api/users/${authUser.userId}/transactions`);
        return { transactions: dbRes.transactions || [] };
      }
      return { transactions: [] };
    }

    default:
      return { error: 'Unknown message type' };
  }
}
