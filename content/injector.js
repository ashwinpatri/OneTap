// One Tap Injector — creates shadow DOM with floating button and checkout overlay
const OneTapInjector = (() => {
  let shadowRoot = null;
  let overlayData = null;

  function createHost() {
    const host = document.createElement('div');
    host.id = 'one-tap-host';
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;';
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'closed' });

    // Load styles
    const brandLink = document.createElement('link');
    brandLink.rel = 'stylesheet';
    brandLink.href = chrome.runtime.getURL('styles/brand.css');
    shadowRoot.appendChild(brandLink);

    const overlayLink = document.createElement('link');
    overlayLink.rel = 'stylesheet';
    overlayLink.href = chrome.runtime.getURL('content/overlay.css');
    shadowRoot.appendChild(overlayLink);
  }

  function show(response, merchant, amount) {
    overlayData = { ...response, merchant, amount: amount || 42.99 };
    if (!shadowRoot) createHost();
    injectButton();
  }

  function injectButton() {
    const btn = document.createElement('button');
    btn.className = 'onetap-fab';
    btn.innerHTML = `
      <div class="onetap-fab-inner">
        <svg class="onetap-fab-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 4H4C2.89 4 2 4.89 2 6V18C2 19.11 2.89 20 4 20H20C21.11 20 22 19.11 22 18V6C22 4.89 21.11 4 20 4ZM20 18H4V12H20V18ZM20 8H4V6H20V8Z" fill="white"/>
        </svg>
        <span class="onetap-fab-text">One Tap Pay</span>
      </div>
    `;
    btn.addEventListener('click', () => showOverlay());
    shadowRoot.appendChild(btn);

    // Entrance animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        btn.classList.add('onetap-fab-visible');
      });
    });
  }

  function showOverlay() {
    // Remove existing overlay if any
    const existing = shadowRoot.querySelector('.onetap-overlay-backdrop');
    if (existing) existing.remove();

    const { bestCard, offers, allCards, merchant, amount } = overlayData;
    const applicableOffers = offers || [];

    // Track the algorithm's original best card across manual selections
    if (!overlayData.originalBestCardId) overlayData.originalBestCardId = bestCard._id;
    const originalBestCardId = overlayData.originalBestCardId;

    const backdrop = document.createElement('div');
    backdrop.className = 'onetap-overlay-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeOverlay(backdrop);
    });

    const drawer = document.createElement('div');
    drawer.className = 'onetap-drawer';
    drawer.innerHTML = buildOverlayHTML(bestCard, allCards, applicableOffers, merchant, amount, originalBestCardId);
    backdrop.appendChild(drawer);
    shadowRoot.appendChild(backdrop);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        backdrop.classList.add('onetap-overlay-visible');
        drawer.classList.add('onetap-drawer-visible');
      });
    });

    // Bind events
    bindOverlayEvents(drawer, allCards, applicableOffers, merchant, amount);
  }

  function buildOverlayHTML(bestCard, allCards, offers, merchant, amount, originalBestCardId) {
    originalBestCardId = originalBestCardId || bestCard._id;
    const savings = offers.reduce((sum, o) => o.activated ? sum + Math.min(amount * (o.discount || 0), o.maxSavings || 0) : sum, 0);
    const finalAmount = amount - savings;

    // ── Helpers ───────────────────────────────────────────────────────────────
    function toDollars(rate, unit, amt) {
      if (unit === 'percent_cashback') return amt * rate / 100;
      if (unit === 'miles') return amt * rate * 0.0105;
      return amt * rate * 0.01;
    }

    function earnDisplay(rate, unit, amt) {
      if (unit === 'percent_cashback') return { primary: `$${(amt * rate / 100).toFixed(2)}`, label: 'cash back' };
      if (unit === 'miles') return { primary: `${Math.round(amt * rate).toLocaleString()}`, label: 'miles' };
      return { primary: `${Math.round(amt * rate).toLocaleString()}`, label: 'points' };
    }

    function fmtRate(rate, unit) {
      if (unit === 'percent_cashback') return `${rate}% cash back`;
      if (unit === 'miles') return `${rate}x miles`;
      return `${rate}x points`;
    }

    function fmtCats(cats) {
      const L = { dining: 'dining', groceries: 'groceries', flights: 'flights', hotels: 'hotels',
        'car-rental': 'car rentals', streaming: 'streaming', entertainment: 'entertainment',
        gas: 'gas', transit: 'transit', 'bass-pro': "Bass Pro/Cabela's", everything: 'everything else' };
      return cats.map(c => L[c] || c).join(', ');
    }

    const bestEarn = earnDisplay(bestCard._score, bestCard._unit, finalAmount);
    const bestDollars = toDollars(bestCard._score, bestCard._unit, finalAmount);

    // ── Section A: Top Recommendation ────────────────────────────────────────
    const isManual = bestCard._isManualSelection;
    const eyebrow = isManual ? `Using ${bestCard.productName}` : 'Best card for this purchase';

    // Show RATE (clear) as primary, computed amount as context line
    const rateText = fmtRate(bestCard._score, bestCard._unit);
    const earnContext = bestCard._unit === 'percent_cashback'
      ? `Earn $${(finalAmount * bestCard._score / 100).toFixed(2)} on this $${finalAmount.toFixed(2)} purchase`
      : bestCard._unit === 'miles'
        ? `Earn ~${Math.round(finalAmount * bestCard._score).toLocaleString()} miles on this purchase`
        : `Earn ~${Math.round(finalAmount * bestCard._score).toLocaleString()} points on this purchase`;

    const runnerUpNote = !isManual && bestCard._runnerUp
      ? `<div class="onetap-rec-vs">vs. ${bestCard._runnerUp.rewardLabel} on ${bestCard._runnerUp.productName}</div>`
      : '';

    const sectionRec = `
      <div class="onetap-section onetap-section-rec">
        <div class="onetap-rec-eyebrow">${eyebrow}</div>
        <div class="onetap-rec-card" style="background:${bestCard.visual?.gradient || '#004977'}; color:${bestCard.visual?.textColor || '#fff'}">
          <div class="onetap-rec-card-top">
            <div>
              <div class="onetap-rec-name">${bestCard.productName}</div>
              <div class="onetap-rec-number">•••• ${bestCard.lastFour}</div>
            </div>
            <div class="onetap-rec-network">${(bestCard.network || '').toUpperCase()}</div>
          </div>
          <div class="onetap-rec-earn-block">
            <div class="onetap-rec-rate-primary">${rateText}</div>
            <div class="onetap-rec-earn-context">${earnContext}</div>
            ${runnerUpNote}
          </div>
        </div>
        <div class="onetap-rec-reason">${bestCard._reason || ''}</div>
      </div>`;

    // ── Section B: Preference Alternatives + Other Cards ─────────────────────
    const PREF_ICONS = { 'Best for cash back': '💰', 'Best for miles': '✈️', 'Best simple option': '⚡' };

    const { alts, altSeen } = (() => {
      const result = [];
      const seen = new Set([bestCard._id]);

      const cbCard = allCards.filter(c => c._unit === 'percent_cashback' && !seen.has(c._id)).sort((a, b) => b._score - a._score)[0];
      const miCard = allCards.filter(c => c._unit === 'miles' && !seen.has(c._id)).sort((a, b) => b._score - a._score)[0];

      const flatBest = allCards.map(c => {
        const t = (c.rewardTiers || []).find(r => r.categories.includes('everything'));
        return { card: c, rate: t?.rate || 0, unit: t?.unit || c._unit };
      }).sort((a, b) => toDollars(b.rate, b.unit, finalAmount) - toDollars(a.rate, a.unit, finalAmount))[0];

      if (bestCard._unit !== 'percent_cashback' && cbCard) {
        seen.add(cbCard._id);
        result.push({ label: 'Best for cash back', card: cbCard, earn: earnDisplay(cbCard._score, cbCard._unit, finalAmount), note: 'Prefer immediate cash value.' });
      }
      if (bestCard._unit !== 'miles' && miCard) {
        seen.add(miCard._id);
        result.push({ label: 'Best for miles', card: miCard, earn: earnDisplay(miCard._score, miCard._unit, finalAmount), note: 'Better for travel redemptions.' });
      }
      if (flatBest && !seen.has(flatBest.card._id)) {
        seen.add(flatBest.card._id);
        result.push({ label: 'Best simple option', card: flatBest.card, earn: earnDisplay(flatBest.rate, flatBest.unit, finalAmount), note: 'Flat rate, no categories to track.' });
      }
      return { alts: result.slice(0, 3), altSeen: seen };
    })();

    // Remaining cards not yet shown anywhere
    const otherCards = allCards.filter(c => !altSeen.has(c._id));

    const sectionAlts = (alts.length > 0 || otherCards.length > 0) ? `
      <div class="onetap-section">
        <div class="onetap-section-title">Other good options</div>
        <div class="onetap-alts-list">
          ${alts.map(a => `
            <button class="onetap-alt-chip onetap-card-chip" data-card-id="${a.card._id}"
              style="background:${a.card.visual?.gradient || '#333'}; color:${a.card.visual?.textColor || '#fff'}">
              <span class="onetap-alt-pref">${PREF_ICONS[a.label] || '💳'} ${a.label}</span>
              <span class="onetap-alt-name">${a.card.productName}</span>
              <span class="onetap-alt-earn">${fmtRate(a.card._score, a.card._unit)}</span>
              <span class="onetap-alt-note">${a.note}</span>
            </button>`).join('')}
          ${otherCards.map(c => `
            <button class="onetap-alt-chip onetap-card-chip" data-card-id="${c._id}"
              style="background:${c.visual?.gradient || '#333'}; color:${c.visual?.textColor || '#fff'}">
              <span class="onetap-alt-pref">💳 Other card</span>
              <span class="onetap-alt-name">${c.productName}</span>
              <span class="onetap-alt-earn">${fmtRate(c._score, c._unit)}</span>
              <span class="onetap-alt-note">•••• ${c.lastFour}</span>
            </button>`).join('')}
        </div>
      </div>` : '';

    // ── Section C: Comparison Table ───────────────────────────────────────────
    const topCards = allCards.slice(0, 4);
    const maxDollars = Math.max(...topCards.map(c => toDollars(c._score, c._unit, finalAmount)), 0.01);

    const sectionCompare = topCards.length > 1 ? `
      <div class="onetap-section">
        <div class="onetap-section-title">How your cards compare here</div>
        <div class="onetap-cmp-table">
          ${topCards.map(c => {
            const earn = earnDisplay(c._score, c._unit, finalAmount);
            const dollars = toDollars(c._score, c._unit, finalAmount);
            const barPct = Math.round((dollars / maxDollars) * 100);
            const isAlgoBest = c._id === originalBestCardId;
            const isSelected = c._id === bestCard._id && !isAlgoBest;
            const badge = isAlgoBest
              ? '<span class="onetap-cmp-best-badge">⭐ best</span>'
              : isSelected ? '<span class="onetap-cmp-sel-badge">using</span>' : '';
            return `
              <div class="onetap-cmp-row${isAlgoBest ? ' onetap-cmp-row-best' : ''}">
                <div class="onetap-cmp-left">
                  <span class="onetap-cmp-name">${c.productName} ${badge}</span>
                  <span class="onetap-cmp-earn">Earn ${earn.primary} ${earn.label}</span>
                  <div class="onetap-cmp-bar-wrap">
                    <div class="onetap-cmp-bar${isAlgoBest ? ' onetap-cmp-bar-top' : ''}" style="width:${barPct}%"></div>
                  </div>
                </div>
                <span class="onetap-cmp-value${isAlgoBest ? '' : ' onetap-cmp-value-dim'}">≈$${dollars.toFixed(2)}</span>
              </div>`;
          }).join('')}
        </div>
      </div>` : '';

    // ── Section D: Deeper Reasoning (expandable) ──────────────────────────────
    const introRow = (() => {
      const o = bestCard.introOffer;
      if (!o || o.earned || !o.spendRequired) return '';
      const spent = o.amountSpent || 0;
      const rem = Math.max(0, o.spendRequired - spent);
      const pct = Math.min(100, Math.round((spent / o.spendRequired) * 100));
      const bonus = o.bonusUnit === 'cash' ? `$${o.bonusAmount}` : `${o.bonusAmount.toLocaleString()} ${o.bonusUnit}`;
      return `
        <div class="onetap-deep-row">
          <div class="onetap-deep-key">🎯 Intro offer</div>
          <div class="onetap-deep-val">
            $${rem.toFixed(0)} more to earn ${bonus}
            <div class="onetap-deep-sub">$${spent.toFixed(0)} of $${o.spendRequired} spent</div>
            <div class="onetap-progress-bar"><div class="onetap-progress-fill" style="width:${pct}%"></div></div>
          </div>
        </div>`;
    })();

    const tiersRows = (bestCard.rewardTiers || []).map(t =>
      `<div class="onetap-deep-tier">
        <strong>${fmtRate(t.rate, t.unit)}</strong> on ${fmtCats(t.categories)}${t.qualifier ? ` <em class="onetap-deep-qualifier">${t.qualifier}</em>` : ''}
      </div>`
    ).join('');

    const runnerUpDeepRow = bestCard._runnerUp ? (() => {
      const ru = allCards.find(c => c.productName === bestCard._runnerUp.productName);
      const ruDollars = ru ? toDollars(ru._score, ru._unit, finalAmount).toFixed(2) : '—';
      return `
        <div class="onetap-deep-row">
          <div class="onetap-deep-key">🆚 Runner-up</div>
          <div class="onetap-deep-val">${bestCard._runnerUp.productName} earns ${bestCard._runnerUp.rewardLabel} here (≈$${ruDollars}) — $${(bestDollars - parseFloat(ruDollars)).toFixed(2)} less value</div>
        </div>`;
    })() : '';

    const balanceRow = bestCard.rewardsBalance > 0 ? `
      <div class="onetap-deep-row">
        <div class="onetap-deep-key">⭐ Balance</div>
        <div class="onetap-deep-val">${
          bestCard._unit === 'miles' ? `${bestCard.rewardsBalance.toLocaleString()} miles` :
          bestCard._unit === 'percent_cashback' ? `$${bestCard.rewardsBalance.toFixed(2)} cash back` :
          `${bestCard.rewardsBalance.toLocaleString()} points`
        } available to redeem</div>
      </div>` : '';

    const sectionDeep = `
      <div class="onetap-section onetap-section-deep">
        <details class="onetap-deep">
          <summary class="onetap-deep-summary">
            <span>Why ${bestCard.productName} wins here</span>
            <span class="onetap-deep-chevron">›</span>
          </summary>
          <div class="onetap-deep-body">
            <div class="onetap-deep-row">
              <div class="onetap-deep-key">🏷 Category</div>
              <div class="onetap-deep-val">${bestCard._category !== 'general' ? bestCard._category : 'General — no special category matched'}</div>
            </div>
            <div class="onetap-deep-row">
              <div class="onetap-deep-key">💳 Rate applied</div>
              <div class="onetap-deep-val">${fmtRate(bestCard._score, bestCard._unit)} → ${bestEarn.primary} ${bestEarn.label} (≈$${bestDollars.toFixed(2)} value)</div>
            </div>
            ${runnerUpDeepRow}
            ${tiersRows ? `
            <div class="onetap-deep-row">
              <div class="onetap-deep-key">📋 All tiers</div>
              <div class="onetap-deep-val onetap-deep-tiers">${tiersRows}</div>
            </div>` : ''}
            ${introRow}
            ${balanceRow}
          </div>
        </details>
      </div>`;

    // ── Offers ────────────────────────────────────────────────────────────────
    const sectionOffers = offers.length > 0 ? `
      <div class="onetap-section">
        <div class="onetap-section-title">Available Offers</div>
        <div class="onetap-offers-list">
          ${offers.map(offer => `
            <label class="onetap-offer" data-offer-id="${offer._id}">
              <div class="onetap-offer-info">
                <span class="onetap-offer-icon">${offer.merchantIcon}</span>
                <div>
                  <div class="onetap-offer-desc">${offer.description}</div>
                  <div class="onetap-offer-savings">Save up to $${(offer.maxSavings || 0).toFixed(2)}</div>
                </div>
              </div>
              <div class="onetap-toggle ${offer.activated ? 'active' : ''}">
                <div class="onetap-toggle-track"><div class="onetap-toggle-thumb"></div></div>
              </div>
            </label>`).join('')}
        </div>
      </div>` : '';

    return `
      <div class="onetap-header">
        <div class="onetap-header-left">
          <div class="onetap-logo">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#004977"/>
              <path d="M8 16C8 16 12 10 16 10C20 10 24 16 24 16C24 16 20 22 16 22C12 22 8 16 8 16Z" stroke="white" stroke-width="2" fill="none"/>
              <circle cx="16" cy="16" r="3" fill="white"/>
            </svg>
          </div>
          <div>
            <div class="onetap-title">One Tap Pay</div>
            <div class="onetap-subtitle">${merchant}</div>
          </div>
        </div>
        <button class="onetap-close" aria-label="Close">&times;</button>
      </div>

      <div class="onetap-amount-bar">
        <span class="onetap-amount-label">Total</span>
        <span class="onetap-amount-value" data-original="${amount}">$${amount.toFixed(2)}</span>
      </div>

      ${sectionRec}
      ${sectionAlts}
      ${sectionCompare}
      ${sectionDeep}
      ${sectionOffers}

      <div class="onetap-section">
        <label class="onetap-split-toggle">
          <span>Split this payment</span>
          <div class="onetap-toggle" id="split-toggle">
            <div class="onetap-toggle-track"><div class="onetap-toggle-thumb"></div></div>
          </div>
        </label>
        <div class="onetap-split-panel" style="display:none;">
          <div class="onetap-split-row">
            <div class="onetap-split-card" style="background:${bestCard.visual?.gradient || '#004977'}; color:${bestCard.visual?.textColor || '#fff'}">
              ${bestCard.productName} •••• ${bestCard.lastFour}
            </div>
            <input type="range" class="onetap-split-slider" min="1" max="${Math.floor(amount) - 1}" value="${Math.floor(amount / 2)}" data-card="primary">
            <span class="onetap-split-amount" id="split-amount-1">$${(amount / 2).toFixed(2)}</span>
          </div>
          <div class="onetap-split-row">
            <select class="onetap-split-select">
              ${allCards.filter(c => c._id !== bestCard._id).map(c => `<option value="${c._id}">${c.productName} •••• ${c.lastFour}</option>`).join('')}
            </select>
            <span class="onetap-split-amount" id="split-amount-2">$${(amount / 2).toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div class="onetap-rewards-bar">
        <svg class="onetap-rewards-icon" viewBox="0 0 20 20" fill="none">
          <path d="M10 1L12.5 7H19L13.75 11L15.5 17.5L10 13.5L4.5 17.5L6.25 11L1 7H7.5L10 1Z" fill="#FFD700"/>
        </svg>
        <span>You'll earn <strong>${bestEarn.primary} ${bestEarn.label}</strong> on this purchase</span>
      </div>

      <button class="onetap-pay-btn" data-card-id="${bestCard._id}" data-amount="${finalAmount}">
        <div class="onetap-pay-btn-content">
          <svg class="onetap-lock-icon" viewBox="0 0 16 16" fill="none">
            <rect x="3" y="7" width="10" height="7" rx="1.5" fill="white"/>
            <path d="M5 7V5C5 3.34 6.34 2 8 2C9.66 2 11 3.34 11 5V7" stroke="white" stroke-width="1.5" fill="none"/>
          </svg>
          <span>Pay $${finalAmount.toFixed(2)}</span>
        </div>
        <div class="onetap-pay-btn-loading" style="display:none">
          <div class="onetap-spinner"></div>
          <span>Processing...</span>
        </div>
        <div class="onetap-pay-btn-success" style="display:none">
          <svg viewBox="0 0 24 24" fill="none" class="onetap-checkmark">
            <path d="M5 13L9 17L19 7" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>Payment Complete!</span>
        </div>
      </button>
    `;
  }

  function bindOverlayEvents(drawer, allCards, offers, merchant, amount) {
    const closeBtn = drawer.querySelector('.onetap-close');
    const backdrop = drawer.parentElement;
    closeBtn.addEventListener('click', () => closeOverlay(backdrop));

    // Card chip selection
    drawer.querySelectorAll('.onetap-card-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cardId = chip.dataset.cardId;
        const card = allCards.find(c => c._id === cardId);
        if (card) {
          // Use pre-scored _score/_unit from allCards (already computed for this merchant)
          const reason = card._category && card._category !== 'general'
            ? `${card.productName} earns ${card._rewardLabel} at ${card._category} merchants`
            : `${card.productName} earns ${card._rewardLabel} on every purchase`;
          overlayData.bestCard = { ...card, _isManualSelection: true, _reason: reason };
          closeOverlay(backdrop);
          showOverlay();
        }
      });
    });

    // Offer toggles
    drawer.querySelectorAll('.onetap-offer').forEach(offerEl => {
      const toggle = offerEl.querySelector('.onetap-toggle');
      offerEl.addEventListener('click', (e) => {
        e.preventDefault();
        toggle.classList.toggle('active');
        updateTotal(drawer, offers, amount);
      });
    });

    // Split toggle
    const splitToggle = drawer.querySelector('#split-toggle');
    const splitPanel = drawer.querySelector('.onetap-split-panel');
    splitToggle.parentElement.parentElement.addEventListener('click', () => {
      splitToggle.classList.toggle('active');
      splitPanel.style.display = splitToggle.classList.contains('active') ? 'block' : 'none';
    });

    // Split slider
    const slider = drawer.querySelector('.onetap-split-slider');
    if (slider) {
      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        drawer.querySelector('#split-amount-1').textContent = `$${val.toFixed(2)}`;
        drawer.querySelector('#split-amount-2').textContent = `$${(amount - val).toFixed(2)}`;
      });
    }

    // Pay button
    const payBtn = drawer.querySelector('.onetap-pay-btn');
    payBtn.addEventListener('click', () => processPayment(drawer, merchant));
  }

  function updateTotal(drawer, offers, originalAmount) {
    let savings = 0;
    drawer.querySelectorAll('.onetap-offer').forEach((offerEl, i) => {
      const toggle = offerEl.querySelector('.onetap-toggle');
      if (toggle.classList.contains('active') && offers[i]) {
        savings += Math.min(originalAmount * offers[i].discount, offers[i].maxSavings);
      }
    });
    const finalAmount = originalAmount - savings;
    const amountEl = drawer.querySelector('.onetap-amount-value');
    if (savings > 0) {
      amountEl.innerHTML = `<span style="text-decoration: line-through; opacity: 0.5;">$${originalAmount.toFixed(2)}</span> $${finalAmount.toFixed(2)}`;
    } else {
      amountEl.textContent = `$${originalAmount.toFixed(2)}`;
    }
    const payBtn = drawer.querySelector('.onetap-pay-btn');
    payBtn.dataset.amount = finalAmount;
    payBtn.querySelector('.onetap-pay-btn-content span').textContent = `Pay $${finalAmount.toFixed(2)}`;
  }

  function processPayment(drawer, merchant) {
    const payBtn = drawer.querySelector('.onetap-pay-btn');
    const content = payBtn.querySelector('.onetap-pay-btn-content');
    const loading = payBtn.querySelector('.onetap-pay-btn-loading');
    const success = payBtn.querySelector('.onetap-pay-btn-success');

    payBtn.disabled = true;
    content.style.display = 'none';
    loading.style.display = 'flex';

    const finalAmount = parseFloat(payBtn.dataset.amount);
    const cardId = payBtn.dataset.cardId;

    chrome.runtime.sendMessage({
      type: MSG.PROCESS_PAYMENT,
      payload: { cardId, amount: finalAmount, merchant }
    }, (response) => {
      loading.style.display = 'none';
      success.style.display = 'flex';
      payBtn.classList.add('onetap-pay-success');

      // Show confirmation after a brief moment
      setTimeout(() => {
        const drawer = payBtn.closest('.onetap-drawer');
        if (drawer) {
          const rewardsBar = drawer.querySelector('.onetap-rewards-bar');
          if (rewardsBar && response && response.transaction) {
            rewardsBar.innerHTML = `
              <svg class="onetap-rewards-icon" viewBox="0 0 20 20" fill="none">
                <path d="M10 1L12.5 7H19L13.75 11L15.5 17.5L10 13.5L4.5 17.5L6.25 11L1 7H7.5L10 1Z" fill="#FFD700"/>
              </svg>
              <span>Earned <strong>${response.transaction.rewardsEarned} ${response.transaction.rewardUnit}</strong> · Confirmation: ${response.confirmationNumber}</span>
            `;
          }
        }
      }, 500);
    });
  }

  function closeOverlay(backdrop) {
    const drawer = backdrop.querySelector('.onetap-drawer');
    drawer.classList.remove('onetap-drawer-visible');
    backdrop.classList.remove('onetap-overlay-visible');
    setTimeout(() => backdrop.remove(), 300);
  }

  return { show };
})();
