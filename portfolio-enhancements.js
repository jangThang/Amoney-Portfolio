(function () {
  const byId = id;
  const won = krw;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
  const today = () => new Date().toISOString().slice(0, 10);
  const number = value => Number.isFinite(+value) ? +value : 0;
  const dividendPerShareDisplay = value => Math.trunc(number(value));
  const accountKey = (account, asset) => account + '\u0000' + asset;

  const existingAccounts = [...new Set(transactions.map(item => item.account).filter(Boolean))];
  const accountSeed = existingAccounts.map(name => {
    const overseas = name === '\ud574\uc678\uc8fc\uc2dd \uacc4\uc88c';
    return {
      name,
      broker: overseas ? '\uc0d8\ud50c\uc99d\uad8c' : name,
      market: overseas ? '\ud574\uc678' : '\uad6d\ub0b4',
      currency: overseas ? 'USD' : 'KRW',
      defaultFx: overseas ? 1350 : 1
    };
  });
  if (!accountSeed.some(item => item.name === '\ud574\uc678\uc8fc\uc2dd \uacc4\uc88c')) {
    accountSeed.push({
      name: '\ud574\uc678\uc8fc\uc2dd \uacc4\uc88c',
      broker: '',
      market: '\ud574\uc678',
      currency: 'USD',
      defaultFx: 0
    });
  }

  let accounts = JSON.parse(localStorage.getItem('wb-accounts') || 'null') || accountSeed;
  let editingAccount = -1;
  let advancedEditingTransaction = -1;

  function saveAccounts() {
    localStorage.setItem('wb-accounts', JSON.stringify(accounts));
  }

  if (localStorage.getItem('wb-account-migration') !== '2026-07-31-v1') {
    existingAccounts.forEach(name => {
      if (!accounts.some(item => item.name === name)) {
        accounts.push({ name, broker: name, market: '\uad6d\ub0b4', currency: 'KRW', defaultFx: 1 });
      }
    });
    if (!accounts.some(item => item.name === '\ud574\uc678\uc8fc\uc2dd \uacc4\uc88c')) {
      accounts.push({ name: '\ud574\uc678\uc8fc\uc2dd \uacc4\uc88c', broker: '', market: '\ud574\uc678', currency: 'USD', defaultFx: 0 });
    }
    transactions.forEach(item => {
      item.currency = item.currency || 'KRW';
      item.fxRate = number(item.fxRate) || 1;
      item.fee = number(item.fee);
      item.tax = number(item.tax);
      item.localAmount = number(item.localAmount) || Math.abs(number(item.amount)) / item.fxRate;
    });
    saveAccounts();
    save();
    localStorage.setItem('wb-account-migration', '2026-07-31-v1');
  }

  if (localStorage.getItem('wb-dividend-account-migration') !== '2026-08-05-v1') {
    transactions.forEach(item => {
      if (item.type === '\ubc30\ub2f9') item.account = '';
    });
    save();
    localStorage.setItem('wb-dividend-account-migration', '2026-08-05-v1');
  }

  function securityMasters() {
    const masters = JSON.parse(localStorage.getItem('wb-security-masters') || '[]');
    let migrated = false;
    masters.forEach(item => {
      if (item.strategy === '\uc131\uc7a5 \uc704\uc131') {
        item.strategy = '\uc131\uc7a5 \uc790\uc0b0';
        migrated = true;
      }
      const name = String(item.name || '').trim().toUpperCase();
      const code = String(item.code || '').trim();
      const normalizedCode = name.includes('VOO') ? 'VOO' : (/^\d{6}$/.test(code) ? code : code.toUpperCase());
      if (item.code !== normalizedCode) {
        item.code = normalizedCode;
        migrated = true;
      }
    });
    if (migrated) localStorage.setItem('wb-security-masters', JSON.stringify(masters));
    return masters;
  }

  function masterForAsset(name) {
    return securityMasters().find(item => item.name === name) || {};
  }

  function defaultStrategy(master) {
    const category = master.category || '';
    if (category.includes('\uae08\ub9ac') || category.includes('\ud604\uae08')) return '\ud604\uae08\uc131';
    if (category.includes('\ucc44\uad8c') || category === '\uae08' || category.includes('\ub9ac\uce20')) return '\ubc29\uc5b4 \uc790\uc0b0';
    if (category.includes('S&P500') || category.includes('\ub2e4\uc6b0\uc874\uc2a4')) return '\ud575\uc2ec \uc7a5\uae30';
    if (category.includes('\ub098\uc2a4\ub2e5100')) return '\uc131\uc7a5 \uc790\uc0b0';
    return master.risk === '\uc548\uc804' || master.risk === '\uc800\uc704\ud5d8' ? '\ubc29\uc5b4 \uc790\uc0b0' : '\uc131\uc7a5 \uc790\uc0b0';
  }

  function marketSignalMap() {
    try {
      return JSON.parse(localStorage.getItem('wb-market-signals') || '{}');
    } catch {
      return {};
    }
  }

  function exchangeRateMap() {
    try {
      return JSON.parse(localStorage.getItem('wb-fx-rates') || '{}');
    } catch {
      return {};
    }
  }

  function currentExchangeRate(currency, ...fallbacks) {
    if (!currency || currency === 'KRW') return 1;
    const saved = exchangeRateMap()[currency];
    return number(saved?.rate) || fallbacks.map(number).find(Boolean) || 0;
  }

  async function refreshExchangeRates(force = false, masters = securityMasters()) {
    const lastRefresh = localStorage.getItem('wb-fx-last-refresh');
    if (!force && lastRefresh && Date.now() - new Date(lastRefresh).getTime() < 6 * 60 * 60 * 1000) {
      return { updated: 0, failed: 0, cached: true };
    }
    const currencies = new Set([
      ...masters.map(item => item.currency),
      ...accounts.map(item => item.currency),
      ...transactions.map(item => item.currency)
    ].filter(currency => currency && currency !== 'KRW'));
    const rates = exchangeRateMap();
    let updated = 0;
    let failed = 0;
    for (const currency of currencies) {
      try {
        const response = await fetch(`/api/fx?currency=${encodeURIComponent(currency)}`);
        if (!response.ok) throw new Error('fx');
        const data = await response.json();
        if (!number(data.rate)) throw new Error('empty');
        rates[currency] = {
          rate: number(data.rate),
          date: data.date || today(),
          source: data.source || '',
          updatedAt: new Date().toISOString()
        };
        updated++;
      } catch {
        failed++;
      }
    }
    localStorage.setItem('wb-fx-rates', JSON.stringify(rates));
    localStorage.setItem('wb-fx-last-refresh', new Date().toISOString());
    masters.forEach(master => {
      const rate = rates[master.currency];
      if (!rate) return;
      master.fxRate = rate.rate;
      master.fxUpdatedAt = rate.date;
      master.fxSource = rate.source;
    });
    accounts.forEach(account => {
      const rate = rates[account.currency];
      if (rate) account.defaultFx = rate.rate;
    });
    localStorage.setItem('wb-security-masters', JSON.stringify(masters));
    saveAccounts();
    return { updated, failed, cached: false };
  }

  function analyzeMarketHistory(items) {
    const prices = (items || [])
      .map(item => ({ date: item.date, close: number(item.close) }))
      .filter(item => item.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (prices.length < 20) return null;
    const closes = prices.map(item => item.close);
    const latest = closes.at(-1);
    const average = count => closes.slice(-Math.min(count, closes.length)).reduce((sum, value) => sum + value, 0) / Math.min(count, closes.length);
    const change = days => {
      const base = closes[Math.max(0, closes.length - 1 - days)];
      return base ? (latest / base - 1) * 100 : 0;
    };
    const dailyReturns = closes.slice(1).map((value, index) => value / closes[index] - 1).slice(-60);
    const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / Math.max(1, dailyReturns.length);
    const variance = dailyReturns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, dailyReturns.length);
    const ma20 = average(20);
    const ma60 = average(60);
    const return20 = change(20);
    const return60 = change(60);
    const drawdown = (latest / Math.max(...closes) - 1) * 100;
    const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
    let trend = '\uc911\ub9bd';
    if (latest >= ma60 * 1.01 && ma20 >= ma60 && return20 > 0) trend = '\uc0c1\uc2b9';
    else if (latest >= ma20 && return20 > 0) trend = '\ud68c\ubcf5';
    else if (latest < ma60 * 0.98 && ma20 < ma60 && return20 < 0) trend = '\ud558\ub77d';
    else if (latest < ma60 || return20 <= -3) trend = '\uc57d\uc138';
    return {
      latest,
      latestDate: prices.at(-1).date,
      ma20,
      ma60,
      return20,
      return60,
      drawdown,
      volatility,
      trend,
      samples: prices.length,
      calculatedAt: new Date().toISOString()
    };
  }

  const planFilter = byId('planFilter');
  if (planFilter && !byId('refreshPlanPrices')) {
    const controls = document.createElement('div');
    controls.className = 'plan-price-controls';
    planFilter.before(controls);
    controls.appendChild(planFilter);
    controls.insertAdjacentHTML('beforeend', `
      <label class="plan-holding-toggle"><input type="checkbox" id="heldOnlyPlan" checked><span>\ubcf4\uc720\uc885\ubaa9\ub9cc \ubcf4\uae30</span></label>
      <button type="button" class="btn light" id="refreshPlanPrices" title="\ubcf4\uc720 \uc885\ubaa9\uc758 \ucd5c\uc2e0 \uc2dc\uc138 \uac31\uc2e0">&#8635; \ud604\uc7ac\uac00 \uac31\uc2e0</button>
      <span class="price-refresh-status" id="priceRefreshStatus"></span>`);
  }

  let priceRefreshRunning = false;
  function formatRefreshTime(value) {
    if (!value) return '\uac31\uc2e0 \uc804';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '\uac31\uc2e0 \uc804';
    return date.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' \uae30\uc900';
  }

  function updatePriceRefreshStatus(text) {
    if (byId('priceRefreshStatus')) byId('priceRefreshStatus').textContent = text;
    if (byId('masterPriceRefreshStatus')) byId('masterPriceRefreshStatus').textContent = text;
  }

  function formatMasterPrice(master) {
    const value = number(master.price);
    if (!value) return '-';
    const currency = /^\d{6}$/.test(String(master.code || '').trim())
      ? 'KRW'
      : master.currency || (master.country === '\ubbf8\uad6d' ? 'USD' : 'KRW');
    try {
      return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: currency === 'KRW' ? 0 : 2 }).format(value);
    } catch {
      return value.toLocaleString('ko-KR');
    }
  }

  function updateVisibleMasterPrices(masters) {
    document.querySelectorAll('#masterRows tr').forEach(row => {
      const name = row.cells[0]?.textContent.trim();
      const master = masters.find(item => item.name === name);
      if (master && row.cells[2]) {
        row.cells[2].textContent = formatMasterPrice(master);
        row.cells[2].title = master.priceUpdatedAt ? `\ucd5c\uc885 \uac31\uc2e0 ${master.priceUpdatedAt} \u00b7 ${master.priceSource || '\uc678\ubd80 \uc2dc\uc138'}` : '\uc2dc\uc138 \uac31\uc2e0 \uc804';
      }
    });
  }

  async function refreshPlanPrices(force = false, requestedNames = null) {
    if (priceRefreshRunning) return;
    const lastRefresh = localStorage.getItem('wb-price-last-refresh');
    const savedSignals = marketSignalMap();
    if (!force && Object.keys(savedSignals).length && lastRefresh && Date.now() - new Date(lastRefresh).getTime() < 30 * 60 * 1000) {
      updatePriceRefreshStatus(formatRefreshTime(lastRefresh));
      scheduleAdvancedPlan();
      return;
    }

    const masters = securityMasters();
    const targets = masters.filter(master => master.code && (!requestedNames || requestedNames.has(master.name)));
    if (!targets.length) {
      updatePriceRefreshStatus('\uac31\uc2e0\ud560 \uc885\ubaa9\ucf54\ub4dc\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.');
      return;
    }

    priceRefreshRunning = true;
    const button = byId('refreshPlanPrices');
    if (button) button.disabled = true;
    const signals = marketSignalMap();
    let updated = 0;
    let failed = 0;
    for (let index = 0; index < targets.length; index++) {
      const master = targets[index];
      updatePriceRefreshStatus(`\uc2dc\uc138 \uac31\uc2e0 \uc911 ${index + 1}/${targets.length}`);
      try {
        const response = await fetch(`/api/market?code=${encodeURIComponent(master.code)}&range=6m`);
        if (!response.ok) throw new Error('market');
        const data = await response.json();
        const latest = (data.items || []).filter(item => Number.isFinite(+item.close)).at(-1);
        if (!latest) throw new Error('empty');
        master.price = +latest.close;
        master.priceUpdatedAt = latest.date || today();
        master.priceSource = data.source || '';
        if (data.currency) master.currency = data.currency;
        const signal = analyzeMarketHistory(data.items || []);
        if (signal) signals[master.name] = signal;
        updated++;
      } catch {
        failed++;
      }
    }

    updatePriceRefreshStatus('\ud604\uc7ac \ud658\uc728 \uac31\uc2e0 \uc911');
    const fxResult = await refreshExchangeRates(force, masters);

    localStorage.setItem('wb-security-masters', JSON.stringify(masters));
    localStorage.setItem('wb-market-signals', JSON.stringify(signals));
    const refreshedAt = new Date().toISOString();
    localStorage.setItem('wb-price-last-refresh', refreshedAt);
    updateVisibleMasterPrices(masters);
    priceRefreshRunning = false;
    if (button) button.disabled = false;
    const fxStatus = fxResult.failed
      ? `\ud658\uc728 ${fxResult.updated}\uac1c \uac31\uc2e0\u00b7${fxResult.failed}\uac1c \uc2e4\ud328`
      : fxResult.cached ? '\ud658\uc728 \ucd5c\uc2e0 \uae30\uc900' : `\ud658\uc728 ${fxResult.updated}\uac1c \uac31\uc2e0`;
    updatePriceRefreshStatus(`${updated}\uac1c \uc2dc\uc138 \u00b7 ${fxStatus}${failed ? ` \u00b7 \uc2dc\uc138 ${failed}\uac1c \uc2e4\ud328` : ''}`);
    window.render();
    updateVisibleMasterPrices(masters);
  }

  if (byId('refreshPlanPrices')) {
    byId('refreshPlanPrices').onclick = () => refreshPlanPrices(true);
    updatePriceRefreshStatus(formatRefreshTime(localStorage.getItem('wb-price-last-refresh')));
  }

  function accountFor(name) {
    return accounts.find(item => item.name === name) || {
      name,
      market: '\uad6d\ub0b4',
      currency: 'KRW',
      defaultFx: 1
    };
  }

  function transactionGrossKrw(item) {
    if (number(item.localAmount)) return Math.abs(number(item.localAmount) * (number(item.fxRate) || 1));
    return Math.abs(number(item.amount));
  }

  function portfolioLedger() {
    const states = new Map();
    const transactionResults = new Map();
    let realized = 0;
    let dividends = 0;
    let fees = 0;
    let taxes = 0;

    transactions
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (a.item.date || '').localeCompare(b.item.date || '') || a.index - b.index)
      .forEach(({ item, index }) => {
        const key = accountKey(item.account || '-', item.asset || '-');
        if (!states.has(key)) {
          states.set(key, {
            account: item.account || '-',
            name: item.asset || '-',
            qty: 0,
            cost: 0,
            realized: 0,
            dividends: 0,
            fees: 0,
            taxes: 0,
            lastFx: number(item.fxRate) || 1
          });
        }
        const state = states.get(key);
        const type = item.type || '\ub9e4\uc218';
        const fx = number(item.fxRate) || 1;
        const feeKrw = number(item.fee);
        const taxKrw = number(item.tax);
        const grossKrw = transactionGrossKrw(item);
        state.lastFx = fx;
        state.fees += feeKrw;
        state.taxes += taxKrw;
        fees += feeKrw;
        taxes += taxKrw;

        if (type === '\ub9e4\uc218') {
          const qty = Math.abs(number(item.qty));
          state.qty += qty;
          state.cost += grossKrw + feeKrw + taxKrw;
          transactionResults.set(index, { realized: 0, dividend: 0 });
          return;
        }

        if (type === '\ub9e4\ub3c4') {
          const qty = Math.min(Math.abs(number(item.qty)), Math.max(0, state.qty));
          const averageCost = state.qty > 0 ? state.cost / state.qty : 0;
          const proceeds = grossKrw - feeKrw - taxKrw;
          const gain = proceeds - averageCost * qty;
          state.qty -= qty;
          state.cost = Math.max(0, state.cost - averageCost * qty);
          state.realized += gain;
          realized += gain;
          transactionResults.set(index, { realized: gain, dividend: 0 });
          return;
        }

        if (type === '\ubc30\ub2f9') {
          const netDividend = Math.max(0, grossKrw - feeKrw - taxKrw);
          state.dividends += netDividend;
          dividends += netDividend;
          transactionResults.set(index, { realized: 0, dividend: netDividend });
          return;
        }

        transactionResults.set(index, { realized: 0, dividend: 0 });
      });

    const positions = [...states.values()].filter(state => state.qty > 0.0000001).map(state => {
      const master = masterForAsset(state.name);
      const account = accountFor(state.account);
      const currency = master.currency || account.currency || 'KRW';
      const currentFx = currentExchangeRate(currency, master.fxRate, account.defaultFx, state.lastFx) || 1;
      const currentPrice = number(master.price) || (state.qty ? state.cost / state.qty / currentFx : 0);
      const value = state.qty * currentPrice * currentFx;
      const unrealized = value - state.cost;
      return {
        ...state,
        currency,
        currentFx,
        currentPrice,
        value,
        unrealized,
        returnRate: state.cost ? unrealized / state.cost * 100 : 0,
        market: account.market || (currency === 'KRW' ? '\uad6d\ub0b4' : '\ud574\uc678'),
        country: master.country || (currency === 'KRW' ? '\ud55c\uad6d' : '\ud574\uc678'),
        category: master.category || '\ubbf8\ubd84\ub958',
        risk: master.risk || '-'
      };
    });

    return { positions, states, transactionResults, realized, dividends, fees, taxes };
  }

  function syncAssetsFromLedger() {
    const { positions } = portfolioLedger();
    assets = positions.map(position => ({
      name: position.name,
      account: position.account,
      type: '\uc8fc\uc2dd',
      qty: position.qty,
      cost: position.cost,
      value: position.value,
      risk: position.risk,
      country: position.country,
      category: position.category,
      currency: position.currency
    }));
  }

  const planningToolbar = byId('goals').querySelector('.panel .toolbar');
  if (planningToolbar && !byId('planningMethod')) {
    planningToolbar.querySelector('h3').textContent = '\ubaa9\ud45c\ube44\uc911 \uae30\ubc18 \ub9e4\ub9e4 \uc124\uacc4';
    const description = planningToolbar.querySelector('.muted');
    if (description) description.textContent = '\ud22c\uc790 \uc5ed\ud560\u00b7\ubaa9\ud45c\ube44\uc911\u00b7\ucd94\uc138\u00b7\ubcc0\ub3d9\uc131\uc744 \ud568\uaed8 \ubc18\uc601\ud55c \ub9ac\ubc38\ub7f0\uc2f1 \ubd84\uc11d';
    const method = document.createElement('div');
    method.className = 'planning-method';
    method.id = 'planningMethod';
    method.innerHTML = `
      <div><b>\uc218\uc775\ub960 \ub2e8\ub3c5 \ud310\ub2e8 \uae08\uc9c0</b><span>\uc7a5\uae30\uc790\uc0b0\uc740 \ubaa9\ud45c\ube44\uc911 \ubc94\uc704 \ub0b4\uc5d0\uc11c \ubcf4\uc720</span></div>
      <div><b>\ud558\ub77d\ucd94\uc138 \ub9e4\uc218 \ubcf4\ub958</b><span>20\u00b760\uc77c \ucd94\uc138 \ud68c\ubcf5 \uc804\uc5d0\ub294 \ub9e4\uc218\ub300\uae30</span></div>
      <div><b>\uc784\uacc4\uce58 \ub9ac\ubc38\ub7f0\uc2f1</b><span>\ubaa9\ud45c\ube44\uc911 \ubc94\uc704\ub97c \ubc97\uc5b4\ub09c \uacbd\uc6b0\uc5d0\ub9cc \ub9e4\ub9e4 \uac80\ud1a0</span></div>`;
    planningToolbar.after(method);
    const planningNote = byId('planRows').closest('table').parentElement.nextElementSibling;
    if (planningNote?.classList.contains('muted')) {
      planningNote.textContent = '\ubcf8 \ud310\ub2e8\uc740 \ubaa9\ud45c\ube44\uc911\uacfc \uacfc\uac70 \uc2dc\uc138\ub97c \ud65c\uc6a9\ud55c \ucc38\uace0\uc6a9 \ub9ac\ubc38\ub7f0\uc2f1 \ubd84\uc11d\uc785\ub2c8\ub2e4. \ud574\uc678\uc790\uc0b0\uc740 ECB \ucd5c\uc2e0 \uc601\uc5c5\uc77c \uae30\uc900\ud658\uc728\ub85c \uc6d0\ud654 \ud658\uc0b0\ud558\uba70, \uc2e4\uc81c \ud658\uc804\u00b7\uac70\ub798 \ud658\uc728\uacfc \ucc28\uc774\uac00 \uc788\uc744 \uc218 \uc788\uc2b5\ub2c8\ub2e4. \uc2dc\uc138 \ucd94\uc138\ub294 \ubbf8\ub798 \uc218\uc775\uc744 \ubcf4\uc7a5\ud558\uc9c0 \uc54a\uc73c\uba70, \uc138\uae08\u00b7\uc218\uc218\ub8cc\u00b7\ud22c\uc790\uae30\uac04\uc744 \ud568\uaed8 \uac80\ud1a0\ud574\uc57c \ud569\ub2c8\ub2e4.';
    }
  }

  if (planFilter) {
    planFilter.innerHTML = `
      <option value="">\uc804\uccb4 \ud310\ub2e8</option>
      <option value="\ubd84\ud560\ub9e4\uc218">\ubd84\ud560\ub9e4\uc218</option>
      <option value="\ubd84\ud560\ub9e4\ub3c4">\ubd84\ud560\ub9e4\ub3c4</option>
      <option value="\uc7a5\uae30\ubcf4\uc720">\uc7a5\uae30\ubcf4\uc720</option>
      <option value="\ub9e4\uc218\ub300\uae30">\ub9e4\uc218\ub300\uae30</option>
      <option value="\uc704\ud5d8\ucd95\uc18c">\uc704\ud5d8\ucd95\uc18c</option>
      <option value="\uad00\ucc30">\uad00\ucc30</option>`;
  }
  const planningLabels = byId('goals').querySelectorAll('.cards .label');
  if (planningLabels[0]) planningLabels[0].textContent = '\ub9e4\uc218 \uac80\ud1a0';
  if (planningLabels[1]) planningLabels[1].textContent = '\ucd95\uc18c \uac80\ud1a0';
  if (planningLabels[2]) planningLabels[2].textContent = '\ubcf4\uc720\u00b7\ub300\uae30';
  const planningHeader = byId('planRows')?.closest('table')?.querySelector('thead tr');
  if (planningHeader) {
    planningHeader.innerHTML = ['\uc885\ubaa9\uba85', '\ubcf4\uc720\uc218\ub7c9', '\ud22c\uc790\uae08\uc561', '\ud604\uc7ac\uac00', '\ud3c9\uade0\ub9e4\uc785\uac00', '\uc218\uc775\ub960', '\ubcf4\uc720\ube44\uc911', '\ud310\ub2e8', '1\ucc28', '2\ucc28', '3\ucc28', '\ud310\ub2e8 \uadfc\uac70']
      .map(label => `<th>${label}</th>`).join('');
  }

  function aggregatePlanningPositions(includeUnheld = false) {
    const grouped = new Map();
    portfolioLedger().positions.forEach(position => {
      if (!grouped.has(position.name)) {
        grouped.set(position.name, { name: position.name, qty: 0, cost: 0, value: 0 });
      }
      const item = grouped.get(position.name);
      item.qty += position.qty;
      item.cost += position.cost;
      item.value += position.value;
    });
    if (includeUnheld) {
      securityMasters().forEach(master => {
        if (!master.name || grouped.has(master.name)) return;
        grouped.set(master.name, { name: master.name, qty: 0, cost: 0, value: 0 });
      });
    }
    return [...grouped.values()];
  }

  function splitQuantities(totalQuantity) {
    const total = Math.max(0, Math.floor(totalQuantity));
    if (!total) return [0, 0, 0];
    const first = Math.ceil(total * 0.3);
    const second = Math.min(total - first, Math.ceil(total * 0.3));
    return [first, second, Math.max(0, total - first - second)];
  }

  function buildAdvancedPlan(position, total, masters, signals) {
    const master = masters.find(item => item.name === position.name) || {};
    const strategy = master.strategy || defaultStrategy(master);
    const weight = total ? position.value / total * 100 : 0;
    const manualTarget = number(master.targetWeight);
    const concentrationCap = ({
      '\ud575\uc2ec \uc7a5\uae30': 35,
      '\uc131\uc7a5 \uc790\uc0b0': 20,
      '\ubc29\uc5b4 \uc790\uc0b0': 25,
      '\ud604\uae08\uc131': 25,
      '\ub2e8\uae30 \uad00\ucc30': 8
    })[strategy] || 15;
    const target = manualTarget || Math.min(weight, concentrationCap);
    const band = Math.max(2, Math.min(5, target * 0.2));
    const lower = Math.max(0, target - band);
    const upper = target + band;
    const rate = position.cost ? (position.value - position.cost) / position.cost * 100 : 0;
    const currency = master.currency || 'KRW';
    const fxInfo = exchangeRateMap()[currency] || null;
    const currentFx = currentExchangeRate(currency, master.fxRate) || 1;
    const localPrice = number(master.price) || (position.qty ? position.value / position.qty / currentFx : 0);
    const price = localPrice * currentFx;
    const average = position.qty ? position.cost / position.qty : 0;
    const signal = signals[position.name] || null;
    const trend = signal?.trend || '\ub370\uc774\ud130 \ubd80\uc871';
    const downtrend = trend === '\ud558\ub77d' || trend === '\uc57d\uc138';
    const positiveTrend = trend === '\uc0c1\uc2b9' || trend === '\ud68c\ubcf5';
    const severeDowntrend = downtrend && number(signal?.drawdown) <= -15 && number(signal?.return60) <= -8;
    const overTarget = weight > upper;
    const underTarget = weight < lower;
    let action = '\uad00\ucc30';
    let reason = `\ubaa9\ud45c ${target.toFixed(1)}%, \uad00\ub9ac\ubc94\uc704 ${lower.toFixed(1)}~${upper.toFixed(1)}% \ub0b4`;

    if (strategy === '\ud575\uc2ec \uc7a5\uae30') {
      if (overTarget) {
        action = '\ubd84\ud560\ub9e4\ub3c4';
        reason = `\uc218\uc775\ub960\uacfc \ubb34\uad00\ud558\uac8c \ubaa9\ud45c \uc0c1\ub2e8 ${upper.toFixed(1)}%\ub97c \ucd08\uacfc`;
      } else if (underTarget && downtrend) {
        action = '\ub9e4\uc218\ub300\uae30';
        reason = `\ubaa9\ud45c \ud558\ub2e8 \ubbf8\ub2ec\uc774\uc9c0\ub9cc ${trend} \ucd94\uc138\ub85c \ud68c\ubcf5 \ud655\uc778 \uc804 \ub300\uae30`;
      } else if (underTarget && positiveTrend) {
        action = '\ubd84\ud560\ub9e4\uc218';
        reason = `\ud575\uc2ec \uc7a5\uae30\uc790\uc0b0\uc774 \ubaa9\ud45c \ud558\ub2e8 ${lower.toFixed(1)}% \ubbf8\ub2ec, ${trend} \ucd94\uc138`;
      } else {
        action = '\uc7a5\uae30\ubcf4\uc720';
        reason = `\uc218\uc775\ub960 ${rate.toFixed(1)}%\uc640 \ubb34\uad00\ud558\uac8c \ud575\uc2ec \uc5ed\ud560\uacfc \ubaa9\ud45c\ubc94\uc704 \uc720\uc9c0`;
      }
    } else if (strategy === '\uc131\uc7a5 \uc790\uc0b0') {
      if (overTarget) {
        action = '\ubd84\ud560\ub9e4\ub3c4';
        reason = `\uc131\uc7a5 \uc790\uc0b0 \ube44\uc911 ${weight.toFixed(1)}%\ub85c \ubaa9\ud45c \uc0c1\ub2e8 ${upper.toFixed(1)}% \ucd08\uacfc`;
      } else if (severeDowntrend && (master.risk === '\uace0\uc704\ud5d8' || master.category?.includes('\uac1c\ubcc4\uc8fc\uc2dd'))) {
        action = '\uc704\ud5d8\ucd95\uc18c';
        reason = `\uace0\uc704\ud5d8 \uc704\uc131\uc790\uc0b0\uc758 ${trend} \ucd94\uc138\u00b7\uace0\uc810\ub300\ube44 ${number(signal?.drawdown).toFixed(1)}%`;
      } else if (downtrend) {
        action = '\ub9e4\uc218\ub300\uae30';
        reason = `\ud3c9\uac00\uc190\uc2e4\uacfc \ubb34\uad00\ud558\uac8c ${trend} \ucd94\uc138\uc5d0\uc11c \ucd94\uac00\ub9e4\uc218 \ubcf4\ub958`;
      } else if (underTarget && positiveTrend) {
        action = '\ubd84\ud560\ub9e4\uc218';
        reason = `\ubaa9\ud45c \ud558\ub2e8 ${lower.toFixed(1)}% \ubbf8\ub2ec\u00b7${trend} \ucd94\uc138 \ud655\uc778`;
      } else {
        reason = `\uc131\uc7a5 \uc790\uc0b0 \ube44\uc911\uc774 \uad00\ub9ac\ubc94\uc704 \ub0b4, \ucd94\uc138 ${trend}`;
      }
    } else if (strategy === '\ubc29\uc5b4 \uc790\uc0b0' || strategy === '\ud604\uae08\uc131') {
      if (overTarget) {
        action = '\ubd84\ud560\ub9e4\ub3c4';
        reason = `\ubc29\uc5b4\u00b7\ud604\uae08\uc131 \ube44\uc911\uc774 \ubaa9\ud45c \uc0c1\ub2e8 ${upper.toFixed(1)}% \ucd08\uacfc`;
      } else if (underTarget && downtrend && strategy !== '\ud604\uae08\uc131') {
        action = '\ub9e4\uc218\ub300\uae30';
        reason = `\ubc29\uc5b4\uc790\uc0b0 \ubaa9\ud45c \ubbf8\ub2ec\uc774\uc9c0\ub9cc ${trend} \ucd94\uc138\ub85c \ub300\uae30`;
      } else if (underTarget) {
        action = '\ubd84\ud560\ub9e4\uc218';
        reason = `\ubc29\uc5b4\u00b7\ud604\uae08\uc131 \ube44\uc911\uc774 \ubaa9\ud45c \ud558\ub2e8 ${lower.toFixed(1)}% \ubbf8\ub2ec`;
      } else {
        action = '\uc7a5\uae30\ubcf4\uc720';
        reason = `\ud3ec\ud2b8\ud3f4\ub9ac\uc624 \ubc29\uc5b4 \uc5ed\ud560\uacfc \ubaa9\ud45c\ubc94\uc704 \uc720\uc9c0`;
      }
    } else {
      if (downtrend) {
        action = '\uc704\ud5d8\ucd95\uc18c';
        reason = `\ub2e8\uae30 \uad00\ucc30\uc790\uc0b0\uc774 ${trend} \ucd94\uc138\ub85c \uc804\ud658`;
      } else if (overTarget || (rate >= 10 && !positiveTrend)) {
        action = '\ubd84\ud560\ub9e4\ub3c4';
        reason = `\ub2e8\uae30 \uc790\uc0b0\uc758 \ube44\uc911 \ub610\ub294 \ucd94\uc138 \ub465\ud654\ub97c \ubc18\uc601`;
      }
    }

    if (!signal && action === '\ubd84\ud560\ub9e4\uc218') {
      action = '\ub9e4\uc218\ub300\uae30';
      reason = '\ubaa9\ud45c\ube44\uc911\uc740 \ubbf8\ub2ec\ud558\uc9c0\ub9cc 6\uac1c\uc6d4 \ucd94\uc138 \ub370\uc774\ud130 \ud655\uc778 \uc804\uae4c\uc9c0 \ub9e4\uc218 \ubcf4\ub958';
    }

    const annualVolatility = number(signal?.volatility) || (master.risk === '\uace0\uc704\ud5d8' ? 35 : master.risk === '\uc911\uc704\ud5d8' ? 22 : 12);
    const step = Math.max(0.02, Math.min(0.07, annualVolatility / Math.sqrt(252) / 100 * 1.5));
    let levels = [null, null, null];
    if (action === '\ubd84\ud560\ub9e4\uc218') {
      const budget = Math.max(0, total * (target - weight) / 100);
      const quantities = splitQuantities(Math.max(3, Math.floor(budget / Math.max(1, price))));
      levels = [[price, quantities[0]], [price * (1 - step), quantities[1]], [price * (1 - step * 2), quantities[2]]];
    } else if (action === '\ubd84\ud560\ub9e4\ub3c4' || action === '\uc704\ud5d8\ucd95\uc18c') {
      const excessValue = action === '\uc704\ud5d8\ucd95\uc18c' ? position.value * 0.3 : Math.max(0, total * (weight - target) / 100);
      const quantities = splitQuantities(Math.min(Math.floor(position.qty), Math.max(3, Math.floor(excessValue / Math.max(1, price)))));
      levels = [[price, quantities[0]], [price * (1 + step), quantities[1]], [price * (1 + step * 2), quantities[2]]];
    }

    const latestTransaction = transactions.filter(item => item.asset === position.name).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    return { ...position, master, strategy, target, manualTarget: !!manualTarget, lower, upper, weight, rate, price, localPrice, currency, currentFx, fxInfo, average, signal, trend, action, reason, levels, recentDate: latestTransaction?.date || '-' };
  }

  function renderAdvancedPlan() {
    if (!byId('planRows')) return;
    const positions = aggregatePlanningPositions(!byId('heldOnlyPlan')?.checked);
    const total = positions.reduce((sum, item) => sum + item.value, 0) || 1;
    const masters = securityMasters();
    const signals = marketSignalMap();
    const plans = positions
      .map(position => buildAdvancedPlan(position, total, masters, signals))
      .sort((a, b) => b.value - a.value || b.cost - a.cost || a.name.localeCompare(b.name, 'ko'));
    const filter = planFilter?.value || '';
    const visible = plans.filter(plan => !filter || plan.action === filter);
    byId('buyPlanCount').textContent = plans.filter(plan => plan.action === '\ubd84\ud560\ub9e4\uc218').length + '\uac1c';
    byId('sellPlanCount').textContent = plans.filter(plan => plan.action === '\ubd84\ud560\ub9e4\ub3c4' || plan.action === '\uc704\ud5d8\ucd95\uc18c').length + '\uac1c';
    byId('holdPlanCount').textContent = plans.filter(plan => !['\ubd84\ud560\ub9e4\uc218', '\ubd84\ud560\ub9e4\ub3c4', '\uc704\ud5d8\ucd95\uc18c'].includes(plan.action)).length + '\uac1c';
    byId('planUpdated').textContent = new Date().toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    byId('planRows').innerHTML = visible.map(plan => {
      const trendDetail = plan.signal
        ? `20\uc77c ${number(plan.signal.return20).toFixed(1)}% \u00b7 60\uc77c ${number(plan.signal.return60).toFixed(1)}% \u00b7 \uace0\uc810\ub300\ube44 ${number(plan.signal.drawdown).toFixed(1)}%`
        : '\ucd94\uc138 \ub370\uc774\ud130 \uac31\uc2e0 \ud544\uc694';
      const fxDetail = plan.currency !== 'KRW'
        ? ` \u00b7 ${plan.currency}/KRW ${plan.currentFx.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} (${esc(plan.fxInfo?.date || '\uc218\ub3d9 \ud658\uc728')})`
        : '';
      const actionClass = plan.action === '\ubd84\ud560\ub9e4\uc218' ? 'up' : ['\ubd84\ud560\ub9e4\ub3c4', '\uc704\ud5d8\ucd95\uc18c'].includes(plan.action) ? 'down' : 'neutral-action';
      const levelCells = plan.levels.map(level => level
        ? `<td>${won(level[0])}<div class="muted cell-note">${Math.max(0, level[1]).toLocaleString('ko-KR')}\uc8fc</div></td>`
        : '<td class="muted">-</td>').join('');
      return `<tr>
        <td><button type="button" class="plan-asset-name" data-market-asset="${encodeURIComponent(plan.name)}" title="\ud074\ub9ad\ud558\uc5ec \uc2dc\uc138\uc640 \ub274\uc2a4 \ubcf4\uae30"><b>${esc(plan.name)}</b><span class="muted">${esc(plan.strategy)} \u00b7 \ucd5c\uadfc\uac70\ub798 ${esc(plan.recentDate)}</span></button></td>
        <td class="plan-quantity"><b>${plan.qty.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}\uc8fc</b></td>
        <td class="plan-investment"><b>${won(plan.value)}</b><div class="muted cell-note">\ucde8\ub4dd\uc6d0\uae08 ${won(plan.cost)}</div></td>
        <td>${won(plan.price)}${plan.currency !== 'KRW' ? `<div class="muted cell-note">${esc(formatMasterPrice({ ...plan.master, price: plan.localPrice, currency: plan.currency }))} \u00b7 \ud658\uc728 ${plan.currentFx.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}</div>` : ''}</td><td>${won(plan.average)}</td>
        <td><span class="tag ${plan.rate < 0 ? 'red' : ''}">${plan.rate.toFixed(1)}%</span></td>
        <td>${plan.weight.toFixed(1)}%<div class="muted cell-note">${plan.manualTarget ? '\ubaa9\ud45c' : '\uc790\ub3d9\uae30\uc900'} ${plan.target.toFixed(1)}%</div></td>
        <td><b class="${actionClass}">${esc(plan.action)}</b><div class="trend-badge trend-${esc(plan.trend)}">${esc(plan.trend)}</div></td>
        ${levelCells}
        <td><b class="reason-title">${esc(plan.reason)}</b><div class="muted reason-detail">${esc(trendDetail)}${fxDetail}</div></td>
      </tr>`;
    }).join('') || '<tr><td colspan="12" class="empty">\ud574\ub2f9\ud558\ub294 \ud310\ub2e8\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</td></tr>';
    byId('planRows').querySelectorAll('[data-market-asset]').forEach(button => {
      button.onclick = () => window.openMarketDetail?.(decodeURIComponent(button.dataset.marketAsset));
    });
  }

  let advancedPlanTimer;
  function scheduleAdvancedPlan() {
    clearTimeout(advancedPlanTimer);
    advancedPlanTimer = setTimeout(renderAdvancedPlan, 0);
  }
  if (planFilter) planFilter.onchange = renderAdvancedPlan;
  if (byId('heldOnlyPlan')) byId('heldOnlyPlan').onchange = renderAdvancedPlan;
  new MutationObserver(scheduleAdvancedPlan).observe(byId('transactionRows'), { childList: true });

  const performanceTab = document.createElement('button');
  performanceTab.className = 'tab';
  performanceTab.dataset.view = 'performance';
  performanceTab.textContent = '\uc131\uacfc\ubd84\uc11d';
  document.querySelector('.tabs').insertBefore(performanceTab, document.querySelector('[data-view="goals"]'));

  const performanceView = document.createElement('section');
  performanceView.className = 'view';
  performanceView.id = 'performance';
  performanceView.innerHTML = `
    <div class="performance-toolbar panel">
      <div>
        <h3>\uc218\uc775 \uad6c\uc131 \ubd84\uc11d</h3>
        <div class="muted">\ub9e4\ub9e4\ucc28\uc775, \ubc30\ub2f9, \uc218\uc218\ub8cc\uc640 \uc138\uae08\uc744 \uc6d0\ud654 \uae30\uc900\uc73c\ub85c \uc9d1\uacc4\ud569\ub2c8\ub2e4.</div>
      </div>
      <div class="performance-filters">
        <label><span>\uc2dc\uc791\uc77c</span><input class="input" type="date" id="performanceFrom"></label>
        <label><span>\uc885\ub8cc\uc77c</span><input class="input" type="date" id="performanceTo"></label>
        <label><span>\uacc4\uc88c</span><select class="select" id="performanceAccount"><option value="">\uc804\uccb4 \uacc4\uc88c</option></select></label>
        <button class="btn light" id="resetPerformance">\ucd08\uae30\ud654</button>
        <button class="btn light" id="exportPerformance">\uc131\uacfc CSV</button>
        <button class="btn" id="openDividend">+ \ubc30\ub2f9\uae08 \uc785\ub825</button>
      </div>
    </div>
    <div class="cards performance-cards">
      <div class="card"><div class="label">\uc2e4\ud604 \ub9e4\ub9e4\ucc28\uc775</div><div class="num" id="performanceRealized">-</div></div>
      <div class="card"><div class="label">\ubc30\ub2f9 \uc21c\uc218\ub839\uc561</div><div class="num up" id="performanceDividend">-</div></div>
      <div class="card"><div class="label">\uc21c \ud655\uc815\uc218\uc775</div><div class="num" id="performanceNet">-</div></div>
    </div>
    <div class="performance-grid">
      <div class="panel">
        <div class="section-head income-chart-head"><h3>\uc6d4\ubcc4 \ubc30\ub2f9\uae08</h3><div class="income-chart-tools"><span class="muted" id="dividendPeriod"></span><div class="period-control" id="dividendChartRange" aria-label="\ubc30\ub2f9\uae08 \ucc28\ud2b8 \uae30\uac04"><button type="button" class="active" data-dividend-months="12">12\uac1c\uc6d4</button><button type="button" data-dividend-months="24">24\uac1c\uc6d4</button><button type="button" data-dividend-months="all">\uc804\uccb4</button></div></div></div>
        <div class="income-chart" id="incomeChart"></div>
      </div>
      <div class="panel">
        <div class="section-head"><h3>\uc885\ubaa9\ubcc4 \ud655\uc815\uc218\uc775</h3><span class="muted">\uc2e4\ud604\uc190\uc775 + \ubc30\ub2f9</span></div>
        <div class="performance-table-wrap"><table><thead><tr><th>\uc885\ubaa9</th><th>\uc2e4\ud604\uc190\uc775</th><th>\ubc30\ub2f9</th><th>\ud569\uacc4</th></tr></thead><tbody id="performanceRows"></tbody></table></div>
      </div>
    </div>
    <div class="panel dividend-ledger-panel">
      <div class="section-head"><div><h3>\ubc30\ub2f9\uae08 \ub0b4\uc5ed</h3><p class="muted">\ubc30\ub2f9\ub77d\uc77c \uc9c1\uc804\uc758 \uc804\uccb4 \uacc4\uc88c \ubcf4\uc720\ub7c9\uc73c\ub85c \uae30\uc900\uc218\ub7c9\u00b7\uc8fc\ub2f9 \ubc30\ub2f9\uae08\uc744 \uacc4\uc0b0\ud569\ub2c8\ub2e4.</p></div><div class="dividend-ledger-actions"><span id="dividendScheduleStatus" aria-live="polite"></span><button type="button" class="btn light" id="refreshDividendSchedules" title="\uc885\ubaa9\ubcc4 \ubc30\ub2f9\ub77d\uc77c\uacfc \uae30\uc900\uc77c \uc77c\uad04 \uc870\ud68c">&#8635; \ubc30\ub2f9\uc77c\uc815 \uc77c\uad04\uc870\ud68c</button><b id="dividendResultCount">0\uac74</b></div></div>
      <div class="performance-table-wrap"><table><thead><tr><th>\uc9c0\uae09\uc6d4</th><th>\uc885\ubaa9</th><th>\uae30\uc900\uc77c\u00b7\ubc30\ub2f9\ub77d\uc77c</th><th>\uc804\uccb4 \uacc4\uc88c \uae30\uc900\uc218\ub7c9</th><th>\uc138\ud6c4 \uc8fc\ub2f9 \ubc30\ub2f9\uae08</th><th>\uc138\ud6c4 \ubc30\ub2f9\uae08</th><th>\ube44\uace0</th><th></th></tr></thead><tbody id="dividendRows"></tbody></table></div>
    </div>`;
  document.querySelector('#goals').before(performanceView);
  let dividendChartMonths = '12';
  let automaticDividendLookupStarted = false;

  const dividendMonthModal = document.createElement('div');
  dividendMonthModal.className = 'modal';
  dividendMonthModal.id = 'dividendMonthModal';
  dividendMonthModal.innerHTML = `
    <div class="dialog dividend-month-dialog" role="dialog" aria-modal="true" aria-labelledby="dividendMonthTitle">
      <div class="market-head">
        <div><h2 id="dividendMonthTitle">\uc6d4\ubcc4 \ubc30\ub2f9\uae08 \ub0b4\uc5ed</h2><div class="muted" id="dividendMonthPeriod"></div></div>
        <button type="button" class="market-close" id="closeDividendMonthIcon" title="\ub2eb\uae30" aria-label="\ub2eb\uae30">&times;</button>
      </div>
      <div class="dividend-month-summary" id="dividendMonthSummary"></div>
      <div class="performance-table-wrap dividend-month-table"><table>
        <thead><tr><th>\uc885\ubaa9</th><th>\ubc30\ub2f9\uc77c\uc815</th><th>\uc804\uccb4 \uacc4\uc88c \uae30\uc900\uc218\ub7c9</th><th>\uc138\ud6c4 \uc8fc\ub2f9</th><th>\uc138\ud6c4 \uc218\ub839\uc561</th><th>\ube44\uace0</th></tr></thead>
        <tbody id="dividendMonthRows"></tbody>
      </table></div>
      <div class="actions"><button type="button" class="btn" id="closeDividendMonth">\ub2eb\uae30</button></div>
    </div>`;
  document.body.appendChild(dividendMonthModal);

  const incomeDetailModal = document.createElement('div');
  incomeDetailModal.className = 'modal';
  incomeDetailModal.id = 'incomeDetailModal';
  incomeDetailModal.innerHTML = `
    <div class="dialog income-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="incomeDetailTitle">
      <div class="market-head">
        <div><h2 id="incomeDetailTitle">\uc885\ubaa9\ubcc4 \ud655\uc815\uc218\uc775 \ub0b4\uc5ed</h2><div class="muted" id="incomeDetailPeriod"></div></div>
        <button type="button" class="market-close" id="closeIncomeDetailIcon" title="\ub2eb\uae30" aria-label="\ub2eb\uae30">&times;</button>
      </div>
      <div class="dividend-month-summary income-detail-summary" id="incomeDetailSummary"></div>
      <div class="performance-table-wrap dividend-month-table income-detail-table"><table>
        <thead><tr><th>\uad6c\ubd84</th><th>\uc77c\uc790</th><th>\uacc4\uc88c\u00b7\ubc30\ub2f9\uc77c\uc815</th><th>\uc218\ub7c9</th><th>\ub2e8\uac00</th><th>\uae08\uc561</th><th>\ud655\uc815\uc218\uc775</th></tr></thead>
        <tbody id="incomeDetailRows"></tbody>
      </table></div>
      <div class="actions"><button type="button" class="btn" id="closeIncomeDetail">\ub2eb\uae30</button></div>
    </div>`;
  document.body.appendChild(incomeDetailModal);

  const dashboardSummary = document.createElement('div');
  dashboardSummary.className = 'insight-strip';
  dashboardSummary.innerHTML = `
    <div><span>\uc2e4\ud604\uc190\uc775</span><b id="dashboardRealized">-</b></div>
    <div><span>\ubc30\ub2f9\uae08</span><b id="dashboardDividend">-</b></div>
    <div><span>\ud574\uc678\uc790\uc0b0</span><b id="dashboardOverseas">-</b></div>
    <div><span>\uc218\uc218\ub8cc\u00b7\uc138\uae08</span><b id="dashboardCosts">-</b></div>`;
  document.querySelector('#dashboard .cards').after(dashboardSummary);
  const dashboardDataPanel = byId('export')?.closest('.panel');
  if (dashboardDataPanel) {
    dashboardDataPanel.className = 'panel settings-data-management portfolio-data-center';
    dashboardDataPanel.innerHTML = `
      <div class="data-center-head">
        <div><h3>\ub370\uc774\ud130 \ubc0f \ubc31\uc5c5</h3><p class="muted">\ud604\uc7ac \ud3ec\ud2b8\ud3f4\ub9ac\uc624\ub294 \uc774 \ube0c\ub77c\uc6b0\uc800\uc5d0 \uc800\uc7a5\ub429\ub2c8\ub2e4. \uc8fc\uae30\uc801\uc73c\ub85c \uc804\uccb4 \ubc31\uc5c5\uc744 \ubc1b\uc544 \ubcf4\uad00\ud558\uc138\uc694.</p></div>
        <span class="data-storage-badge" id="dataStorageBadge">\ube0c\ub77c\uc6b0\uc800 \uc800\uc7a5</span>
      </div>
      <div class="data-overview" id="dataOverview">
        <div><span>\uac70\ub798\ub0b4\uc5ed</span><b id="dataTransactionCount">0\uac74</b></div>
        <div><span>\uacc4\uc88c</span><b id="dataAccountCount">0\uac1c</b></div>
        <div><span>\uc885\ubaa9 \uae30\uc900\uc815\ubcf4</span><b id="dataMasterCount">0\uac1c</b></div>
        <div><span>\uc608\u00b7\uc801\uae08</span><b id="dataSafeCount">0\uac1c</b></div>
        <div><span>\uc800\uc7a5 \uc6a9\ub7c9</span><b id="dataStorageSize">0 KB</b></div>
      </div>
      <div class="data-action-grid">
        <section class="data-action-block primary">
          <div><span class="data-action-kicker">\uad8c\uc7a5</span><h4>\uc804\uccb4 \ubc31\uc5c5</h4><p>\uac70\ub798, \uacc4\uc88c, \uc885\ubaa9, \uc608\u00b7\uc801\uae08, \ubc30\ub2f9, \uc124\uc815\uc744 \ud558\ub098\uc758 JSON \ud30c\uc77c\ub85c \ubcf4\uad00\ud569\ub2c8\ub2e4.</p></div>
          <div class="data-action-buttons"><button type="button" class="btn" id="exportBackup">\uc804\uccb4 \ubc31\uc5c5 \ub2e4\uc6b4\ub85c\ub4dc</button><label class="btn light">\ubc31\uc5c5 \ud30c\uc77c \ubcf5\uc6d0<input id="importBackup" type="file" accept=".json,application/json" hidden></label></div>
          <small id="lastBackupText">\ucd5c\uadfc \ubc31\uc5c5 \uae30\ub85d \uc5c6\uc74c</small>
        </section>
        <section class="data-action-block">
          <div><span class="data-action-kicker">\ud45c\uc900 \ud615\uc2dd</span><h4>CSV \ub0b4\ubcf4\ub0b4\uae30</h4><p>\uc678\ubd80 \ubd84\uc11d\uc774\ub098 \uc5d1\uc140 \ud655\uc778\uc744 \uc704\ud574 \uac70\ub798\ub0b4\uc5ed\uacfc \ud604\uc7ac \ubcf4\uc720\ud604\ud669\uc744 \uac01\uac01 \ub0b4\ubcf4\ub0c5\ub2c8\ub2e4.</p></div>
          <div class="data-action-buttons"><button type="button" class="btn light" id="exportTransactionsData">\uac70\ub798\ub0b4\uc5ed CSV</button><button type="button" class="btn light" id="exportHoldingsData">\ubcf4\uc720\ud604\ud669 CSV</button></div>
          <small>CSV\ub294 \uc870\ud68c\uc6a9\uc774\uba70, \uc804\uccb4 \ubcf5\uc6d0\uc5d0\ub294 JSON \ubc31\uc5c5\uc744 \uc0ac\uc6a9\ud569\ub2c8\ub2e4.</small>
        </section>
        <section class="data-action-block">
          <div><span class="data-action-kicker">\uc548\uc804 \uc810\uac80</span><h4>\ub370\uc774\ud130 \ubb34\uacb0\uc131</h4><p>\uc8fc\uc694 \uc800\uc7a5 \ud56d\ubaa9\uc758 \ud30c\uc2f1 \uc624\ub958\uc640 \ud544\uc218 \ub370\uc774\ud130 \ub204\ub77d \uc5ec\ubd80\ub97c \ud655\uc778\ud569\ub2c8\ub2e4.</p></div>
          <div class="data-action-buttons"><button type="button" class="btn light" id="validatePortfolioData">\uc9c0\uae08 \ub370\uc774\ud130 \uc810\uac80</button></div>
          <small class="data-validation-result" id="dataValidationResult">\uc810\uac80 \uc804</small>
        </section>
      </div>
      <div class="data-reset-bar">
        <div><span class="data-action-kicker">\uc8fc\uc758</span><h4>\ub370\uc774\ud130 \ucd08\uae30\ud654</h4><p>\uc774 \ube0c\ub77c\uc6b0\uc800\uc5d0 \uc800\uc7a5\ub41c \ubcc0\uacbd \ub0b4\uc5ed\uc744 \uc0ad\uc81c\ud558\uace0, \uc571\uc5d0 \ud3ec\ud568\ub41c \uae30\ubcf8 \ud3ec\ud2b8\ud3f4\ub9ac\uc624 \ub370\uc774\ud130\ub85c \ub418\ub3cc\ub9bd\ub2c8\ub2e4. \uc2e4\ud589 \uc804 \uc804\uccb4 \ubc31\uc5c5\uc744 \uad8c\uc7a5\ud569\ub2c8\ub2e4.</p></div>
        <button type="button" class="btn danger" id="resetPortfolioData">\ub370\uc774\ud130 \ucd08\uae30\ud654</button>
      </div>`;
    byId('settings').appendChild(dashboardDataPanel);
  }

  function localPortfolioData() {
    const data = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith('wb-')) data[key] = localStorage.getItem(key);
    }
    return data;
  }

  function downloadDataFile(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const arrayStorageKeys = ['wb-assets', 'wb-transactions', 'wb-goals', 'wb-accounts', 'wb-security-masters', 'wb-safe-assets'];
  const objectStorageKeys = ['wb-fx-rates', 'wb-market-signals'];
  function validatePortfolioStorage(data) {
    const errors = [];
    const warnings = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { errors: ['\ub370\uc774\ud130 \uad6c\uc870\uac00 \uc62c\ubc14\ub974\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.'], warnings };
    const entries = Object.entries(data);
    if (!entries.length) errors.push('\uc800\uc7a5\ub41c \ud3ec\ud2b8\ud3f4\ub9ac\uc624 \ub370\uc774\ud130\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.');
    entries.forEach(([key, value]) => {
      if (!key.startsWith('wb-') || typeof value !== 'string') errors.push(`${key}: \uc9c0\uc6d0\ud558\uc9c0 \uc54a\ub294 \ud56d\ubaa9`);
    });
    [...arrayStorageKeys, ...objectStorageKeys].forEach(key => {
      if (!(key in data)) {
        if (['wb-transactions', 'wb-security-masters'].includes(key)) warnings.push(`${key}: \ud56d\ubaa9 \ub204\ub77d`);
        return;
      }
      try {
        const parsed = JSON.parse(data[key]);
        if (arrayStorageKeys.includes(key) && !Array.isArray(parsed)) errors.push(`${key}: \ubc30\uc5f4\uc774 \uc544\ub2d9\ub2c8\ub2e4.`);
        if (objectStorageKeys.includes(key) && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) errors.push(`${key}: \uac1d\uccb4\uac00 \uc544\ub2d9\ub2c8\ub2e4.`);
      } catch {
        errors.push(`${key}: JSON \ud30c\uc2f1 \uc624\ub958`);
      }
    });
    return { errors, warnings };
  }

  function updateDataManagementStats() {
    if (!byId('dataOverview')) return;
    const data = localPortfolioData();
    const bytes = Object.entries(data).reduce((sum, [key, value]) => sum + (key.length + String(value).length) * 2, 0);
    byId('dataTransactionCount').textContent = `${transactions.length.toLocaleString('ko-KR')}\uac74`;
    byId('dataAccountCount').textContent = `${accounts.length.toLocaleString('ko-KR')}\uac1c`;
    byId('dataMasterCount').textContent = `${securityMasters().length.toLocaleString('ko-KR')}\uac1c`;
    byId('dataSafeCount').textContent = `${(window.WB_SAFE || []).length.toLocaleString('ko-KR')}\uac1c`;
    byId('dataStorageSize').textContent = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('ko-KR')} KB`;
    const lastBackup = localStorage.getItem('wb-last-backup-at');
    byId('lastBackupText').textContent = lastBackup ? `\ucd5c\uadfc \ubc31\uc5c5 ${new Date(lastBackup).toLocaleString('ko-KR')}` : '\ucd5c\uadfc \ubc31\uc5c5 \uae30\ub85d \uc5c6\uc74c';
  }

  byId('exportBackup').onclick = () => {
    const data = localPortfolioData();
    const counts = { transactions: transactions.length, accounts: accounts.length, masters: securityMasters().length, savings: (window.WB_SAFE || []).length };
    const payload = JSON.stringify({
      application: 'A_MONEY_PORTFOLIO',
      version: 2,
      exportedAt: new Date().toISOString(),
      counts,
      data
    }, null, 2);
    downloadDataFile(payload, 'application/json;charset=utf-8', `a-money-portfolio-\uc804\uccb4\ubc31\uc5c5-${today()}.json`);
    localStorage.setItem('wb-last-backup-at', new Date().toISOString());
    updateDataManagementStats();
  };

  byId('importBackup').onchange = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (!['A_MONEY_PORTFOLIO', 'WEALTHBOARD'].includes(payload.application)) throw new Error('\uc9c0\uc6d0\ud558\uc9c0 \uc54a\ub294 \ubc31\uc5c5 \ud615\uc2dd\uc785\ub2c8\ub2e4.');
        const validation = validatePortfolioStorage(payload.data);
        if (validation.errors.length) throw new Error(validation.errors.slice(0, 3).join('\n'));
        const transactionCount = JSON.parse(payload.data['wb-transactions'] || '[]').length;
        if (!confirm(`\ubc31\uc5c5\uc758 \uac70\ub798 ${transactionCount.toLocaleString('ko-KR')}\uac74\uc744 \ud3ec\ud568\ud55c \uc804\uccb4 \ub370\uc774\ud130\ub85c \uad50\uccb4\ud560\uae4c\uc694?\n\ud604\uc7ac \ub370\uc774\ud130\ub294 \ub36e\uc5b4\uc501\ub2c8\ub2e4.`)) return;
        const previous = localPortfolioData();
        try {
          Object.keys(previous).forEach(key => localStorage.removeItem(key));
          Object.entries(payload.data).forEach(([key, value]) => localStorage.setItem(key, value));
        } catch (error) {
          Object.keys(localPortfolioData()).forEach(key => localStorage.removeItem(key));
          Object.entries(previous).forEach(([key, value]) => localStorage.setItem(key, value));
          throw error;
        }
        location.reload();
      } catch (error) {
        alert(`\ubc31\uc5c5 \ud30c\uc77c\uc744 \ubcf5\uc6d0\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.\n${error.message || '\ud30c\uc77c \ud615\uc2dd\uc744 \ud655\uc778\ud558\uc138\uc694.'}`);
      }
    };
    reader.readAsText(file);
  };

  byId('resetPortfolioData').onclick = () => {
    const summary = `\uac70\ub798 ${transactions.length.toLocaleString('ko-KR')}\uac74, \uacc4\uc88c ${accounts.length.toLocaleString('ko-KR')}\uac1c, \uc608\u00b7\uc801\uae08 ${(window.WB_SAFE || []).length.toLocaleString('ko-KR')}\uac1c`;
    if (!confirm(`\ud604\uc7ac \ud3ec\ud2b8\ud3f4\ub9ac\uc624 \ub370\uc774\ud130\ub97c \ucd08\uae30\ud654\ud560\uae4c\uc694?\n${summary}\uc758 \ubcc0\uacbd \ub0b4\uc5ed\uc774 \uc0ad\uc81c\ub429\ub2c8\ub2e4.\n\ubcf5\uad6c\ud558\ub824\uba74 \uba3c\uc800 \uc804\uccb4 \ubc31\uc5c5\uc744 \ub2e4\uc6b4\ub85c\ub4dc\ud558\uc138\uc694.`)) return;
    const confirmation = prompt('\ucd08\uae30\ud654\ub97c \uacc4\uc18d\ud558\ub824\uba74 \uc544\ub798\uc5d0 "\ucd08\uae30\ud654"\ub97c \uc785\ub825\ud558\uc138\uc694.');
    if (confirmation !== '\ucd08\uae30\ud654') {
      if (confirmation !== null) alert('\uc785\ub825\ud55c \ubb38\uad6c\uac00 \uc77c\uce58\ud558\uc9c0 \uc54a\uc544 \ucd08\uae30\ud654\ub97c \ucde8\uc18c\ud588\uc2b5\ub2c8\ub2e4.');
      return;
    }
    const previous = localPortfolioData();
    try {
      Object.keys(previous).forEach(key => localStorage.removeItem(key));
      location.reload();
    } catch (error) {
      Object.entries(previous).forEach(([key, value]) => localStorage.setItem(key, value));
      alert(`\ub370\uc774\ud130\ub97c \ucd08\uae30\ud654\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.\n${error.message || '\ube0c\ub77c\uc6b0\uc800 \uc800\uc7a5\uc18c\ub97c \ud655\uc778\ud558\uc138\uc694.'}`);
    }
  };

  byId('exportTransactionsData').onclick = () => {
    const ledger = portfolioLedger();
    const header = ['\uc77c\uc790', '\uacc4\uc88c', '\uc885\ubaa9', '\uad6c\ubd84', '\uc218\ub7c9', '\ub2e8\uac00', '\uac70\ub798\ud1b5\ud654', '\ud658\uc728', '\uae08\uc561(\uc6d0)', '\uc218\uc218\ub8cc(\uc6d0)', '\uc138\uae08(\uc6d0)', '\uc2e4\ud604\uc190\uc775(\uc6d0)', '\ubc30\ub2f9(\uc6d0)', '\ubc30\ub2f9\uae30\uc900\uc77c', '\ubc30\ub2f9\ub77d\uc77c', '\ube44\uace0'];
    const rows = transactions.map((item, index) => {
      const result = ledger.transactionResults.get(index) || {};
      const derived = item.type === '\ubc30\ub2f9' ? dividendDerivedValues(item) : null;
      return [item.date, item.account || '', item.asset, item.type, derived ? derived.quantity : Math.abs(number(item.qty)), derived ? dividendPerShareDisplay(derived.perShare) : number(item.price), item.currency || 'KRW', number(item.fxRate) || 1, derived ? derived.netKrw : transactionGrossKrw(item), number(item.fee), number(item.tax), number(result.realized), number(result.dividend), item.recordDate || '', item.exDividendDate || '', item.note || ''];
    });
    const csv = '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadDataFile(csv, 'text/csv;charset=utf-8', `a-money-portfolio-\uac70\ub798\ub0b4\uc5ed-${today()}.csv`);
  };

  byId('exportHoldingsData').onclick = () => {
    const header = ['\uacc4\uc88c', '\uc885\ubaa9', '\uc218\ub7c9', '\ucde8\ub4dd\uc6d0\uac00(\uc6d0)', '\ud3c9\uac00\uae08\uc561(\uc6d0)', '\ud3c9\uac00\uc190\uc775(\uc6d0)', '\uc218\uc775\ub960(%)', '\uc2dc\uc7a5', '\ud1b5\ud654'];
    const rows = portfolioLedger().positions.map(item => [item.account, item.name, item.qty, item.cost, item.value, item.value - item.cost, item.cost ? (item.value - item.cost) / item.cost * 100 : 0, item.market, item.currency]);
    const csv = '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadDataFile(csv, 'text/csv;charset=utf-8', `a-money-portfolio-\ubcf4\uc720\ud604\ud669-${today()}.csv`);
  };

  byId('validatePortfolioData').onclick = () => {
    const validation = validatePortfolioStorage(localPortfolioData());
    const result = byId('dataValidationResult');
    if (validation.errors.length) {
      result.className = 'data-validation-result error';
      result.textContent = `\uc624\ub958 ${validation.errors.length}\uac74 \u00b7 ${validation.errors.slice(0, 2).join(' / ')}`;
    } else if (validation.warnings.length) {
      result.className = 'data-validation-result warning';
      result.textContent = `\uc800\uc7a5 \uad6c\uc870 \uc815\uc0c1 \u00b7 \ud655\uc778 ${validation.warnings.length}\uac74`;
    } else {
      result.className = 'data-validation-result success';
      result.textContent = `\uc815\uc0c1 \u00b7 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} \uc810\uac80 \uc644\ub8cc`;
    }
  };
  updateDataManagementStats();

  // Keep legacy render hooks alive while the visible dashboard uses the newer charts.
  if (!byId('trendChart')) {
    const legacyGraphs = document.createElement('div');
    legacyGraphs.hidden = true;
    legacyGraphs.innerHTML = '<svg id="trendChart"></svg><div id="riskRows"></div>';
    byId('dashboard').appendChild(legacyGraphs);
  }

  const analysisCharts = byId('analysisCharts');
  if (analysisCharts && !byId('donutAccount')) {
    [
      ['\uacc4\uc88c\ubcc4 \ube44\uc911', 'Account'],
      ['\ud1b5\ud654\ubcc4 \ube44\uc911', 'Currency']
    ].forEach(([title, suffix]) => {
      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.innerHTML = `<h3>${title}</h3><div class="chart-box"><svg class="donut-svg" viewBox="0 0 100 100" id="donut${suffix}"></svg><div class="chart-legend" id="legend${suffix}"></div></div>`;
      analysisCharts.appendChild(panel);
    });
  }

  const exposureColors = ['#377dca', '#efb321', '#50b3ba', '#ee7771', '#7c9fca', '#6dae68', '#b487ca', '#ec8f45'];
  function drawExposure(suffix, entries) {
    const svg = byId(`donut${suffix}`);
    const legend = byId(`legend${suffix}`);
    if (!svg || !legend) return;
    const visible = entries.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    const total = visible.reduce((sum, [, value]) => sum + value, 0) || 1;
    const circumference = 2 * Math.PI * 36;
    let offset = 0;
    svg.innerHTML = '<circle cx="50" cy="50" r="36" stroke="#edf1f3"></circle>' + visible.map(([, value], index) => {
      const length = value / total * circumference;
      const circle = `<circle cx="50" cy="50" r="36" stroke="${exposureColors[index % exposureColors.length]}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"></circle>`;
      offset += length;
      return circle;
    }).join('');
    legend.innerHTML = visible.map(([label, value], index) => `
      <div class="chart-row" title="${esc(label)} ${won(value)}">
        <i class="swatch" style="background:${exposureColors[index % exposureColors.length]}"></i>
        <span>${esc(label)}</span><b>${(value / total * 100).toFixed(1)}%</b>
      </div>`).join('') || '<div class="empty">\ub370\uc774\ud130 \uc5c6\uc74c</div>';
  }

  function renderExposureCharts(ledger) {
    const deposits = (window.WB_SAFE || []).reduce((sum, item) => sum + number(item.current), 0);
    const accountsMap = new Map();
    const currenciesMap = new Map();
    ledger.positions.forEach(position => {
      accountsMap.set(position.account, (accountsMap.get(position.account) || 0) + position.value);
      currenciesMap.set(position.currency, (currenciesMap.get(position.currency) || 0) + position.value);
    });
    if (deposits) {
      accountsMap.set('\uc608\u00b7\uc801\uae08', (accountsMap.get('\uc608\u00b7\uc801\uae08') || 0) + deposits);
      currenciesMap.set('KRW', (currenciesMap.get('KRW') || 0) + deposits);
    }
    drawExposure('Account', [...accountsMap.entries()]);
    drawExposure('Currency', [...currenciesMap.entries()]);
  }

  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'panel settings-accounts';
  settingsPanel.innerHTML = `
    <div class="toolbar">
      <div><h3>\uacc4\uc88c \uae30\uc900\uc815\ubcf4</h3><div class="muted">\ucd5c\uc2e0 ECB \uae30\uc900\ud658\uc728\uc740 \ud604\uc7ac \ud3c9\uac00\uc5d0, \uac70\ub798 \ub2f9\uc2dc \ud658\uc728\uc740 \ucde8\ub4dd\uc6d0\uac00\u00b7\uc2e4\ud604\uc190\uc775\uc5d0 \uc0ac\uc6a9\ud569\ub2c8\ub2e4.</div></div>
      <button class="btn" id="addAccount">+ \uacc4\uc88c \ucd94\uac00</button>
    </div>
    <div class="table-scroll"><table><thead><tr><th>\uacc4\uc88c\uba85</th><th>\uc99d\uad8c\uc0ac</th><th>\uc2dc\uc7a5</th><th>\uae30\uc900\ud1b5\ud654</th><th>\uae30\ubcf8\ud658\uc728</th><th></th></tr></thead><tbody id="accountRows"></tbody></table></div>`;
  byId('settings').prepend(settingsPanel);

  const accountModal = document.createElement('div');
  accountModal.className = 'modal';
  accountModal.id = 'accountModal';
  accountModal.innerHTML = `
    <div class="dialog">
      <h2 id="accountModalTitle">\uacc4\uc88c \ucd94\uac00</h2>
      <div class="form">
        <label>\uacc4\uc88c\uba85<input id="accountName"></label>
        <label>\uc99d\uad8c\uc0ac<input id="accountBroker"></label>
        <label>\uc2dc\uc7a5<select id="accountMarket"><option>\uad6d\ub0b4</option><option>\ud574\uc678</option></select></label>
        <label>\uae30\uc900\ud1b5\ud654<select id="accountCurrency"><option>KRW</option><option>USD</option><option>JPY</option><option>EUR</option><option>CNY</option><option>HKD</option></select></label>
        <label>\uae30\ubcf8\ud658\uc728 (1\ud1b5\ud654\ub2f9 \uc6d0\ud654)<input id="accountFx" type="number" min="0" step="0.01"></label>
      </div>
      <div class="actions"><button class="btn light" id="cancelAccount">\ucde8\uc18c</button><button class="btn" id="saveAccount">\uc800\uc7a5</button></div>
    </div>`;
  document.body.appendChild(accountModal);

  function renderAccounts() {
    const rates = exchangeRateMap();
    byId('accountRows').innerHTML = accounts.map((item, index) => {
      const rateInfo = rates[item.currency];
      return `
      <tr>
        <td><b>${esc(item.name)}</b></td>
        <td>${esc(item.broker || '-')}</td>
        <td><span class="market-badge ${item.market === '\ud574\uc678' ? 'overseas' : ''}">${esc(item.market)}</span></td>
        <td>${esc(item.currency)}</td>
        <td>${item.currency === 'KRW' ? '-' : number(item.defaultFx) ? `${number(item.defaultFx).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}<div class="muted cell-note">${esc(rateInfo?.date || '\uc218\ub3d9 \uae30\uc900')}</div>` : '<span class="setup-warning">\ubbf8\uc124\uc815</span>'}</td>
        <td class="row-actions">
          <button class="row-action edit" data-account-edit="${index}" title="\uacc4\uc88c \uc218\uc815" aria-label="\uacc4\uc88c \uc218\uc815">&#9998;</button>
          <button class="row-action delete" data-account-delete="${index}" title="\uacc4\uc88c \uc0ad\uc81c" aria-label="\uacc4\uc88c \uc0ad\uc81c">&#128465;</button>
        </td>
      </tr>`;
    }).join('');
    fillAccountSelects();
  }

  function fillAccountSelects() {
    const selects = [byId('transactionAccount'), byId('accountFilter'), byId('txAccountFilter'), byId('performanceAccount')].filter(Boolean);
    selects.forEach(select => {
      const current = select.value;
      const allLabel = select.id === 'transactionAccount' ? null : '\uc804\uccb4 \uacc4\uc88c';
      select.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : '') +
        accounts.map(item => `<option value="${esc(item.name)}">${esc(item.name)}${item.market === '\ud574\uc678' ? ' \u00b7 ' + item.currency : ''}</option>`).join('');
      if ([...select.options].some(option => option.value === current)) select.value = current;
    });
  }

  byId('addAccount').onclick = () => {
    editingAccount = -1;
    byId('accountModalTitle').textContent = '\uacc4\uc88c \ucd94\uac00';
    ['accountName', 'accountBroker', 'accountFx'].forEach(id => byId(id).value = '');
    byId('accountMarket').value = '\uad6d\ub0b4';
    byId('accountCurrency').value = 'KRW';
    accountModal.classList.add('open');
  };
  byId('cancelAccount').onclick = () => accountModal.classList.remove('open');
  byId('saveAccount').onclick = () => {
    const name = byId('accountName').value.trim();
    if (!name) return alert('\uacc4\uc88c\uba85\uc744 \uc785\ub825\ud558\uc138\uc694.');
    if (accounts.some((account, index) => account.name === name && index !== editingAccount)) {
      return alert('\uc774\ubbf8 \uac19\uc740 \uc774\ub984\uc758 \uacc4\uc88c\uac00 \uc788\uc2b5\ub2c8\ub2e4.');
    }
    const item = {
      name,
      broker: byId('accountBroker').value.trim(),
      market: byId('accountMarket').value,
      currency: byId('accountCurrency').value,
      defaultFx: byId('accountCurrency').value === 'KRW' ? 1 : number(byId('accountFx').value)
    };
    if (editingAccount < 0) accounts.push(item);
    else {
      const oldName = accounts[editingAccount].name;
      accounts[editingAccount] = item;
      if (oldName !== name) transactions.forEach(transaction => {
        if (transaction.account === oldName) transaction.account = name;
      });
    }
    saveAccounts();
    save();
    window.render();
    accountModal.classList.remove('open');
  };

  document.body.addEventListener('click', event => {
    const edit = event.target.closest('[data-account-edit]');
    const remove = event.target.closest('[data-account-delete]');
    if (edit) {
      editingAccount = +edit.dataset.accountEdit;
      const item = accounts[editingAccount];
      byId('accountModalTitle').textContent = '\uacc4\uc88c \uc218\uc815';
      byId('accountName').value = item.name;
      byId('accountBroker').value = item.broker || '';
      byId('accountMarket').value = item.market || '\uad6d\ub0b4';
      byId('accountCurrency').value = item.currency || 'KRW';
      byId('accountFx').value = number(item.defaultFx) || '';
      accountModal.classList.add('open');
    }
    if (remove) {
      const index = +remove.dataset.accountDelete;
      const usedCount = transactions.filter(transaction => transaction.account === accounts[index]?.name).length;
      if (usedCount) {
        alert(`\uc774 \uacc4\uc88c\ub97c \uc0ac\uc6a9\ud55c \uac70\ub798\ub0b4\uc5ed\uc774 ${usedCount}\uac74 \uc788\uc5b4 \uc0ad\uc81c\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.`);
        return;
      }
      if (confirm('\uc774 \uacc4\uc88c \uae30\uc900\uc815\ubcf4\ub97c \uc0ad\uc81c\ud560\uae4c\uc694?')) {
        accounts.splice(index, 1);
        saveAccounts();
        renderAccounts();
      }
    }
  });

  const masterForm = document.querySelector('#masterModal .form');
  const addMasterButton = byId('addMaster');
  if (addMasterButton && !byId('refreshMasterPrices')) {
    const controls = document.createElement('div');
    controls.className = 'master-price-controls';
    addMasterButton.before(controls);
    controls.innerHTML = `
      <span class="price-refresh-status" id="masterPriceRefreshStatus">${esc(formatRefreshTime(localStorage.getItem('wb-price-last-refresh')))}</span>
      <button type="button" class="btn light" id="refreshMasterPrices" title="\ub4f1\ub85d\ub41c \uc885\ubaa9\uc758 \ucd5c\uc2e0 \uc2dc\uc138 \uc870\ud68c">&#8635; \ud604\uc7ac\uac00 \uc804\uccb4 \uac31\uc2e0</button>`;
    controls.appendChild(addMasterButton);
    byId('refreshMasterPrices').onclick = () => refreshPlanPrices(true);
  }
  if (masterForm && !byId('masterCurrency')) {
    const masterPriceLabel = byId('masterPrice').closest('label');
    if (masterPriceLabel) masterPriceLabel.childNodes[0].nodeValue = '\ud604\uc7ac\uac00 (\uac70\ub798\ud1b5\ud654)';
    ['\uc77c\ubcf8', '\uc911\uad6d', '\ud64d\ucf69', '\uc720\ub7fd', '\uae30\ud0c0'].forEach(country => {
      if (![...byId('masterCountry').options].some(option => option.value === country)) {
        byId('masterCountry').add(new Option(country, country));
      }
    });
    ['\ud574\uc678\uac1c\ubcc4\uc8fc\uc2dd', '\ud574\uc678 ETF', '\ub9ac\uce20', '\ud604\uae08\uc131\uc790\uc0b0'].forEach(category => {
      if (![...byId('masterCategory').options].some(option => option.value === category)) {
        byId('masterCategory').add(new Option(category, category));
      }
    });
    masterForm.insertAdjacentHTML('beforeend', `
      <label>\uac70\ub798\ud1b5\ud654<select id="masterCurrency"><option>KRW</option><option>USD</option><option>JPY</option><option>EUR</option><option>CNY</option><option>HKD</option></select></label>
      <label>\ud604\uc7ac \ud658\uc728 (\uc790\ub3d9\u00b7\uc218\ub3d9)<input id="masterFx" type="number" min="0" step="0.01"></label>
      <label>\ud22c\uc790 \uc5ed\ud560<select id="masterStrategy"><option>\ud575\uc2ec \uc7a5\uae30</option><option>\uc131\uc7a5 \uc790\uc0b0</option><option>\ubc29\uc5b4 \uc790\uc0b0</option><option>\ud604\uae08\uc131</option><option>\ub2e8\uae30 \uad00\ucc30</option></select></label>
      <label>\ubaa9\ud45c\ube44\uc911 (%) \u00b7 \ubbf8\uc785\ub825 \uc2dc \uc790\ub3d9<input id="masterTargetWeight" type="number" min="0" max="100" step="0.1" placeholder="\uc790\ub3d9"></label>`);
    byId('saveMaster').addEventListener('click', () => {
      const name = byId('masterName').value.trim();
      setTimeout(() => {
        const list = securityMasters();
        const item = list.find(master => master.name === name);
        if (!item) return;
        item.currency = byId('masterCurrency').value;
        item.fxRate = item.currency === 'KRW' ? 1 : number(byId('masterFx').value);
        item.strategy = byId('masterStrategy').value;
        item.targetWeight = number(byId('masterTargetWeight').value);
        localStorage.setItem('wb-security-masters', JSON.stringify(list));
        scheduleAdvancedPlan();
        refreshPlanPrices(true, new Set([name]));
      }, 0);
    });
    document.body.addEventListener('click', event => {
      const edit = event.target.closest('[data-master-edit]');
      if (!edit) return;
      const item = securityMasters()[+edit.dataset.masterEdit] || {};
      byId('masterCode').value = item.code || '';
      byId('masterCurrency').value = item.currency || (item.country === '\ubbf8\uad6d' ? 'USD' : 'KRW');
      byId('masterFx').value = currentExchangeRate(byId('masterCurrency').value, item.fxRate) || '';
      byId('masterStrategy').value = item.strategy || defaultStrategy(item);
      byId('masterTargetWeight').value = number(item.targetWeight) || '';
    });
  }

  function decorateMasterActions() {
    const headerRow = byId('masterRows').closest('table').querySelector('thead tr');
    if (headerRow && !headerRow.querySelector('[data-planning-header]')) {
      const header = document.createElement('th');
      header.dataset.planningHeader = 'true';
      header.textContent = '\uc6b4\uc6a9 \uae30\uc900';
      headerRow.insertBefore(header, headerRow.lastElementChild);
    }
    const masters = securityMasters();
    document.querySelectorAll('#masterRows tr').forEach(row => {
      const risk = row.cells[3]?.textContent.trim() || '';
      const riskTag = row.cells[3]?.querySelector('.tag');
      if (riskTag) {
        const riskClass = risk === '\uace0\uc704\ud5d8' ? 'risk-high'
          : risk === '\uc911\uc704\ud5d8' ? 'risk-medium'
            : risk === '\uc800\uc704\ud5d8' ? 'risk-low'
              : risk === '\uc548\uc804' ? 'risk-safe' : 'risk-unknown';
        riskTag.className = `tag ${riskClass}`;
      }
      if (row.querySelector('[data-planning-cell]')) return;
      const master = masters.find(item => item.name === row.cells[0]?.textContent.trim()) || {};
      const strategy = master.strategy || defaultStrategy(master);
      const target = number(master.targetWeight);
      const cell = document.createElement('td');
      cell.dataset.planningCell = 'true';
      cell.innerHTML = `<b>${esc(strategy)}</b><div class="muted cell-note">${target ? `\ubaa9\ud45c ${target.toFixed(1)}%` : '\uc9d1\uc911\ub3c4 \uc0c1\ud55c \uc790\ub3d9'}</div>`;
      row.insertBefore(cell, row.lastElementChild);
    });
    document.querySelectorAll('#masterRows [data-master-edit]').forEach(button => {
      button.className = 'row-action edit';
      button.innerHTML = '&#9998;';
      button.title = '\uc885\ubaa9 \uc218\uc815';
      button.setAttribute('aria-label', '\uc885\ubaa9 \uc218\uc815');
    });
    document.querySelectorAll('#masterRows [data-master-delete]').forEach(button => {
      button.className = 'row-action delete';
      button.innerHTML = '&#128465;';
      button.title = '\uc885\ubaa9 \uc0ad\uc81c';
      button.setAttribute('aria-label', '\uc885\ubaa9 \uc0ad\uc81c');
    });
    document.querySelectorAll('#masterRows td:last-child').forEach(cell => cell.classList.add('row-actions'));
    updateVisibleMasterPrices(masters);
  }
  decorateMasterActions();
  new MutationObserver(decorateMasterActions).observe(byId('masterRows'), { childList: true });

  const transactionForm = document.querySelector('#transactionModal .form');
  if (transactionForm && !byId('transactionCurrency')) {
    byId('transactionType').insertAdjacentHTML('beforeend', '<option value="\ubc30\ub2f9">\ubc30\ub2f9</option>');
    transactionForm.insertAdjacentHTML('beforeend', `
      <label>\uac70\ub798\ud1b5\ud654<select id="transactionCurrency"><option>KRW</option><option>USD</option><option>JPY</option><option>EUR</option><option>CNY</option><option>HKD</option></select></label>
      <label>\uc801\uc6a9\ud658\uc728<input id="transactionFx" type="number" min="0" step="0.01"></label>
      <label>\uc218\uc218\ub8cc (\uc6d0\ud654)<input id="transactionFee" type="number" min="0"></label>
      <label>\uc138\uae08\u00b7\uc6d0\ucc9c\uc9d5\uc218 (\uc6d0\ud654)<input id="transactionTax" type="number" min="0"></label>
      <label class="dividend-schedule-field">\ubc30\ub2f9 \uae30\uc900\uc77c (\uc790\ub3d9 \uc870\ud68c\u00b7\uc120\ud0dd)<input id="dividendRecordDate" type="date"></label>
      <label class="dividend-schedule-field">\ubc30\ub2f9\ub77d\uc77c (\uc790\ub3d9 \uc870\ud68c\u00b7\uc120\ud0dd)<input id="dividendExDate" type="date"></label>
      <div class="dividend-form-note form-wide" id="dividendFormNote">\uae30\uc900\uc77c\uacfc \ubc30\ub2f9\ub77d\uc77c\uc740 \ube44\uc6cc\ub450\uc5b4\ub3c4 \ub429\ub2c8\ub2e4. <span>\uc800\uc7a5 \ud6c4 \uc885\ubaa9\ucf54\ub4dc\u00b7\uc9c0\uae09\uc6d4\ub85c \uc77c\uc815\uc744 \uc870\ud68c\ud558\uace0, \uc804\uccb4 \uacc4\uc88c \uad8c\ub9ac\uc218\ub7c9\uc744 \uc790\ub3d9 \uacc4\uc0b0\ud569\ub2c8\ub2e4.</span> <b id="dividendDerivedQuantity">\uae30\uc900\uc218\ub7c9 -</b> \u00b7 <b id="dividendDerivedPerShare">\uc138\ud6c4 \uc8fc\ub2f9 -</b><strong class="dividend-anomaly" id="dividendDerivedWarning"></strong></div>`);
  }

  function applyTransactionDefaults() {
    const account = accountFor(byId('transactionAccount').value);
    const master = masterForAsset(byId('transactionAsset').value);
    const currency = master.currency || account.currency || 'KRW';
    byId('transactionCurrency').value = currency;
    byId('transactionFx').value = currentExchangeRate(currency, master.fxRate, account.defaultFx) || '';
    if (byId('transactionType').value !== '\ubc30\ub2f9' && !byId('transactionPrice').value && number(master.price)) byId('transactionPrice').value = master.price;
  }

  function previousBusinessDay(dateValue) {
    if (!dateValue) return '';
    const date = new Date(`${dateValue}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    do {
      date.setDate(date.getDate() - 1);
    } while (date.getDay() === 0 || date.getDay() === 6);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function quantityHeldOnDate(account, asset, date, exclusive = false) {
    const quantitiesByAccount = new Map();
    transactions
      .filter(item => (!account || item.account === account) && item.asset === asset && (!date || (exclusive ? (item.date || '') < date : (item.date || '') <= date)))
      .sort((left, right) => (left.date || '').localeCompare(right.date || ''))
      .forEach(item => {
        if (item.type === '\ubc30\ub2f9') return;
        const accountKey = item.account || '-';
        const quantity = quantitiesByAccount.get(accountKey) || 0;
        const amount = Math.abs(number(item.qty));
        const sell = item.type === '\ub9e4\ub3c4' || number(item.qty) < 0 || number(item.amount) < 0;
        quantitiesByAccount.set(accountKey, Math.max(0, quantity + (sell ? -amount : amount)));
      });
    return [...quantitiesByAccount.values()].reduce((sum, quantity) => sum + quantity, 0);
  }

  function dividendSchedule(item) {
    const month = (item.date || '').slice(0, 7);
    const recordDate = item.recordDate || '';
    const exDividendDate = item.exDividendDate || previousBusinessDay(recordDate);
    return {
      recordDate,
      exDividendDate,
      cutoffDate: exDividendDate || (month ? `${month}-31` : ''),
      exclusive: !!exDividendDate,
      estimated: !recordDate
    };
  }

  function dividendDerivedValues(item) {
    const schedule = dividendSchedule(item);
    const quantity = quantityHeldOnDate('', item.asset, schedule.cutoffDate, schedule.exclusive);
    const fxRate = number(item.fxRate) || 1;
    const netKrw = Math.max(0, transactionGrossKrw(item) - number(item.fee) - number(item.tax));
    const netLocal = netKrw / fxRate;
    const perShare = quantity ? netLocal / quantity : 0;
    const referencePrice = number(masterForAsset(item.asset).price);
    return {
      quantity,
      netKrw,
      netLocal,
      perShare,
      suspicious: !!(perShare && referencePrice && perShare / referencePrice >= 0.1),
      schedule
    };
  }

  function dividendEventForMonth(items, paymentMonth) {
    if (!paymentMonth) return null;
    const valid = (items || []).filter(item => item?.exDividendDate);
    const exact = valid
      .filter(item => (item.paymentDate || '').slice(0, 7) === paymentMonth)
      .sort((left, right) => (left.paymentDate || '').localeCompare(right.paymentDate || ''));
    if (exact.length) return exact.at(-1);

    const monthEnd = new Date(`${paymentMonth}-28T12:00:00`);
    monthEnd.setMonth(monthEnd.getMonth() + 1, 0);
    const target = monthEnd.getTime();
    return valid
      .filter(item => item.paymentDate)
      .map(item => ({ item, distance: Math.abs(new Date(`${item.paymentDate}T12:00:00`).getTime() - target) }))
      .filter(candidate => candidate.distance <= 35 * 24 * 60 * 60 * 1000)
      .sort((left, right) => left.distance - right.distance)[0]?.item || null;
  }

  function setDividendScheduleStatus(message, state = '') {
    const status = byId('dividendScheduleStatus');
    if (!status) return;
    status.textContent = message;
    status.className = state;
  }

  async function fetchDividendHistory(master) {
    const code = String(master.code || '').trim();
    if (!code) throw new Error('missing_code');
    const kind = String(master.category || '').toUpperCase().includes('ETF') || code.toUpperCase() === 'VOO' ? 'etf' : 'stock';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/dividends?code=${encodeURIComponent(code)}&kind=${kind}`, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? 'not_found' : 'lookup_failed');
      const data = await response.json();
      if (!Array.isArray(data.items) || !data.items.length) throw new Error('empty_history');
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refreshDividendSchedules(force = true, markResearchComplete = false) {
    const button = byId('refreshDividendSchedules');
    if (!button || button.disabled) return;
    const targets = transactions
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === '\ubc30\ub2f9' && (force || !item.recordDate || !item.exDividendDate));
    if (!targets.length) {
      setDividendScheduleStatus('\ubc30\ub2f9\uc77c\uc815 \uc785\ub825 \uc644\ub8cc', 'success');
      return;
    }

    const groups = new Map();
    targets.forEach(entry => {
      if (!groups.has(entry.item.asset)) groups.set(entry.item.asset, []);
      groups.get(entry.item.asset).push(entry);
    });
    button.disabled = true;
    const originalLabel = button.innerHTML;
    let updated = 0;
    let unresolved = 0;
    let completedAssets = 0;
    try {
      for (const [asset, entries] of groups) {
        completedAssets++;
        button.textContent = `\uc870\ud68c \uc911 ${completedAssets}/${groups.size}`;
        setDividendScheduleStatus(`${asset} \uc77c\uc815 \ud655\uc778 \uc911`, 'loading');
        const master = masterForAsset(asset);
        try {
          const history = await fetchDividendHistory(master);
          entries.forEach(({ item }) => {
            const event = dividendEventForMonth(history.items, (item.date || '').slice(0, 7));
            if (!event) {
              unresolved++;
              return;
            }
            item.recordDate = event.recordDate || item.recordDate || '';
            item.exDividendDate = event.exDividendDate;
            item.paymentDate = event.paymentDate || '';
            item.dividendScheduleSource = history.source || '';
            item.dividendScheduleSourceUrl = history.sourceUrl || '';
            item.dividendScheduleUpdatedAt = new Date().toISOString();
            const derived = dividendDerivedValues(item);
            item.qty = derived.quantity;
            item.price = derived.perShare;
            updated++;
          });
        } catch {
          unresolved += entries.length;
        }
      }
      save();
      window.render();
      localStorage.setItem('wb-dividend-schedule-last-refresh', new Date().toISOString());
      if (markResearchComplete) localStorage.setItem('wb-dividend-schedule-research-version', '2026-08-05-v2');
      setDividendScheduleStatus(
        unresolved ? `${updated}\uac74 \ubc18\uc601 \u00b7 ${unresolved}\uac74 \ud655\uc778 \ud544\uc694` : `${updated}\uac74 \ubc30\ub2f9\uc77c\uc815 \ubc18\uc601`,
        unresolved ? 'warning' : 'success'
      );
    } finally {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }

  function updateDividendDerivedPreview(quantity, localAmount) {
    const currency = byId('transactionCurrency').value || 'KRW';
    const perShare = quantity ? localAmount / quantity : 0;
    byId('transactionPrice').value = perShare || '';
    byId('dividendDerivedQuantity').textContent = quantity
      ? `\uae30\uc900\uc218\ub7c9 ${quantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}\uc8fc`
      : '\uae30\uc900\uc218\ub7c9 \uacc4\uc0b0 \ubd88\uac00';
    byId('dividendDerivedPerShare').textContent = perShare
      ? `\uc138\ud6c4 \uc8fc\ub2f9 ${currency} ${dividendPerShareDisplay(perShare).toLocaleString('ko-KR')}`
      : '\uc138\ud6c4 \uc8fc\ub2f9 -';
    const referencePrice = number(masterForAsset(byId('transactionAsset').value).price);
    const warning = byId('dividendDerivedWarning');
    warning.textContent = !byId('dividendRecordDate').value
      ? '\uc800\uc7a5 \ud6c4 \ubc30\ub2f9\uc77c\uc815\uc744 \uc790\ub3d9 \uc870\ud68c\ud569\ub2c8\ub2e4.'
      : perShare && referencePrice && perShare / referencePrice >= 0.1
        ? '\uc785\ub825\ud55c \ubc30\ub2f9\uae08\uc774 \uae30\uc900\uc218\ub7c9\u00b7\uc885\ubaa9 \ud604\uc7ac\uac00\uc5d0 \ube44\ud574 \ud06d\ub2c8\ub2e4. \uc9c0\uae09\uc6d4\u00b7\uc885\ubaa9\u00b7\uae08\uc561\uc744 \ud655\uc778\ud558\uc138\uc694.'
        : '';
    warning.classList.toggle('visible', !!warning.textContent);
  }

  function applyDividendDefaults(forceQuantity = false) {
    if (byId('transactionType').value !== '\ubc30\ub2f9') return;
    const recordDate = byId('dividendRecordDate').value;
    if (recordDate && !byId('dividendExDate').value) byId('dividendExDate').value = previousBusinessDay(recordDate);
    const paymentMonth = byId('transactionDate').value.slice(0, 7);
    const cutoffDate = byId('dividendExDate').value || (paymentMonth ? `${paymentMonth}-31` : '');
    const quantity = quantityHeldOnDate('', byId('transactionAsset').value, cutoffDate, !!byId('dividendExDate').value);
    if (forceQuantity || !byId('transactionQty').value) byId('transactionQty').value = quantity || '';
    applyTransactionDefaults();
    updateDividendDerivedPreview(quantity, number(byId('transactionAmount').value));
  }

  function updateTransactionAmount() {
    if (byId('transactionType').value === '\ubc30\ub2f9') {
      applyDividendDefaults(true);
      return;
    }
    const qty = Math.abs(number(byId('transactionQty').value));
    const price = number(byId('transactionPrice').value);
    if (qty && price) byId('transactionAmount').value = +(qty * price).toFixed(4);
  }

  function updateTransactionMode() {
    const dividend = byId('transactionType').value === '\ubc30\ub2f9';
    const dateInput = byId('transactionDate');
    const previousDate = dateInput.value;
    dateInput.type = dividend ? 'month' : 'date';
    dateInput.value = dividend
      ? (previousDate || today()).slice(0, 7)
      : previousDate.length === 7 ? `${previousDate}-01` : (previousDate || today());
    dateInput.closest('label').childNodes[0].nodeValue = dividend ? '\uc9c0\uae09\uc6d4' : '\uac70\ub798\uc77c';
    byId('transactionAccount').closest('label').childNodes[0].nodeValue = dividend ? '\uc218\ub839\uacc4\uc88c' : '\uac70\ub798\uacc4\uc88c';
    byId('transactionAccount').closest('label').classList.toggle('dividend-auto-field', dividend);
    byId('transactionQty').closest('label').childNodes[0].nodeValue = dividend ? '\ubc30\ub2f9 \uae30\uc900 \uc218\ub7c9 (\uc790\ub3d9)' : '\uc218\ub7c9';
    byId('transactionPrice').closest('label').childNodes[0].nodeValue = dividend ? '\uc8fc\ub2f9 \ubc30\ub2f9\uae08 (\uac70\ub798\ud1b5\ud654)' : '\ub2e8\uac00';
    byId('transactionQty').closest('label').classList.remove('optional-field');
    byId('transactionPrice').closest('label').classList.remove('optional-field');
    byId('transactionAmount').closest('label').childNodes[0].nodeValue = dividend ? '\uc138\ud6c4 \ubc30\ub2f9\uae08 (\uac70\ub798\ud1b5\ud654)' : '\uac70\ub798\uae08\uc561 (\uac70\ub798\ud1b5\ud654)';
    ['transactionQty', 'transactionPrice', 'transactionFee', 'transactionTax'].forEach(id => {
      byId(id).closest('label').classList.toggle('dividend-auto-field', dividend);
    });
    document.querySelectorAll('#transactionModal .dividend-schedule-field').forEach(label => {
      label.classList.toggle('dividend-auto-field', !dividend);
    });
    byId('dividendFormNote').hidden = !dividend;
    if (dividend) applyDividendDefaults(false);
  }

  function resetAdvancedTransaction() {
    advancedEditingTransaction = -1;
    document.querySelector('#transactionModal h2').textContent = '\uac70\ub798 \ucd94\uac00';
    byId('transactionDate').type = 'date';
    byId('transactionDate').value = today();
    ['transactionQty', 'transactionPrice', 'transactionAmount', 'transactionFee', 'transactionTax', 'transactionNote', 'dividendRecordDate', 'dividendExDate'].forEach(id => byId(id).value = '');
    byId('transactionType').value = '\ub9e4\uc218';
    fillAccountSelects();
    applyTransactionDefaults();
    updateTransactionMode();
  }

  byId('openTransaction').onclick = () => {
    resetAdvancedTransaction();
    openModal('transactionModal');
  };
  byId('openDividend').onclick = () => {
    resetAdvancedTransaction();
    document.querySelector('#transactionModal h2').textContent = '\ubc30\ub2f9\uae08 \uc785\ub825';
    byId('transactionType').value = '\ubc30\ub2f9';
    byId('transactionPrice').value = '';
    byId('transactionAmount').value = '';
    updateTransactionMode();
    applyDividendDefaults(true);
    openModal('transactionModal');
  };
  byId('transactionAccount').addEventListener('change', () => { applyTransactionDefaults(); applyDividendDefaults(true); });
  byId('transactionAsset').addEventListener('change', () => { applyTransactionDefaults(); applyDividendDefaults(true); });
  byId('transactionDate').addEventListener('change', () => applyDividendDefaults(true));
  byId('dividendRecordDate').addEventListener('change', () => {
    byId('dividendExDate').value = previousBusinessDay(byId('dividendRecordDate').value);
    applyDividendDefaults(true);
  });
  byId('dividendExDate').addEventListener('change', () => applyDividendDefaults(true));
  byId('transactionType').addEventListener('change', () => {
    if (byId('transactionType').value === '\ubc30\ub2f9') {
      byId('transactionPrice').value = '';
      byId('transactionAmount').value = '';
    }
    updateTransactionMode();
  });
  byId('transactionCurrency').addEventListener('change', () => {
    const currency = byId('transactionCurrency').value;
    byId('transactionFx').value = currentExchangeRate(currency) || '';
    if (byId('transactionType').value === '\ubc30\ub2f9') applyDividendDefaults(true);
  });
  byId('transactionAmount').addEventListener('input', () => {
    if (byId('transactionType').value === '\ubc30\ub2f9') applyDividendDefaults(true);
  });
  byId('transactionQty').addEventListener('input', updateTransactionAmount);
  byId('transactionPrice').addEventListener('input', updateTransactionAmount);
  byId('accountMarket').addEventListener('change', () => {
    if (byId('accountMarket').value === '\ud574\uc678' && byId('accountCurrency').value === 'KRW') {
      byId('accountCurrency').value = 'USD';
    }
    if (byId('accountMarket').value === '\uad6d\ub0b4') {
      byId('accountCurrency').value = 'KRW';
      byId('accountFx').value = 1;
    }
  });
  byId('accountCurrency').addEventListener('change', () => {
    if (byId('accountCurrency').value === 'KRW') byId('accountFx').value = 1;
  });

  byId('saveTransaction').onclick = () => {
    const name = byId('transactionAsset').value;
    const type = byId('transactionType').value;
    const dividend = type === '\ubc30\ub2f9';
    const transactionDate = byId('transactionDate').value;
    if (!transactionDate) return alert(dividend ? '\uc9c0\uae09\uc6d4\uc744 \uc120\ud0dd\ud558\uc138\uc694.' : '\uac70\ub798\uc77c\uc744 \uc120\ud0dd\ud558\uc138\uc694.');
    const recordDate = dividend ? byId('dividendRecordDate').value : '';
    const exDividendDate = dividend ? (byId('dividendExDate').value || previousBusinessDay(recordDate)) : '';
    const effectiveDate = dividend ? (exDividendDate || `${transactionDate.slice(0, 7)}-31`) : transactionDate;
    const qty = dividend
      ? quantityHeldOnDate('', name, effectiveDate, true)
      : Math.abs(number(byId('transactionQty').value));
    const enteredPrice = number(byId('transactionPrice').value);
    const localAmount = number(byId('transactionAmount').value) || qty * enteredPrice;
    const price = dividend && qty ? localAmount / qty : enteredPrice;
    const currency = byId('transactionCurrency').value;
    const fxRate = currency === 'KRW' ? 1 : number(byId('transactionFx').value);
    if (!name) return alert('\uc885\ubaa9\uc744 \uc120\ud0dd\ud558\uc138\uc694.');
    if (!dividend && !qty) return alert('\uc218\ub7c9\uc744 \uc785\ub825\ud558\uc138\uc694.');
    if (!localAmount) return alert(dividend ? '\uc138\ud6c4 \ubc30\ub2f9\uae08\uc744 \uc785\ub825\ud558\uc138\uc694.' : '\uac70\ub798\uae08\uc561\uc744 \uc785\ub825\ud558\uc138\uc694.');
    if (currency !== 'KRW' && !fxRate) return alert('\ud574\uc678 \uac70\ub798\uc758 \uc801\uc6a9\ud658\uc728\uc744 \uc785\ub825\ud558\uc138\uc694.');
    const sign = type === '\ub9e4\ub3c4' ? -1 : 1;
    const item = {
      date: type === '\ubc30\ub2f9' ? transactionDate.slice(0, 7) : transactionDate,
      account: dividend ? '' : byId('transactionAccount').value,
      asset: name,
      type,
      qty: type === '\ubc30\ub2f9' ? qty : qty * sign,
      price,
      currency,
      fxRate: fxRate || 1,
      localAmount,
      amount: localAmount * (fxRate || 1) * sign,
      fee: dividend ? 0 : number(byId('transactionFee').value),
      tax: dividend ? 0 : number(byId('transactionTax').value),
      recordDate,
      exDividendDate,
      note: byId('transactionNote').value.trim()
    };
    if (advancedEditingTransaction < 0) transactions.unshift(item);
    else transactions[advancedEditingTransaction] = item;
    save();
    window.render();
    closeModal('transactionModal');
    if (dividend && (!recordDate || !exDividendDate)) {
      setTimeout(() => refreshDividendSchedules(false), 0);
    }
  };

  document.body.addEventListener('click', event => {
    const edit = event.target.closest('[data-transaction-edit]');
    if (!edit) return;
    advancedEditingTransaction = +edit.dataset.transactionEdit;
    const item = transactions[advancedEditingTransaction];
    setTimeout(() => {
      const dividendValues = item.type === '\ubc30\ub2f9' ? dividendDerivedValues(item) : null;
      document.querySelector('#transactionModal h2').textContent = item.type === '\ubc30\ub2f9' ? '\ubc30\ub2f9\uae08 \uc218\uc815' : '\uac70\ub798 \uc218\uc815';
      fillAccountSelects();
      byId('transactionAccount').value = item.account || '';
      if (![...byId('transactionAsset').options].some(option => option.value === item.asset)) {
        byId('transactionAsset').add(new Option(item.asset, item.asset));
      }
      byId('transactionAsset').value = item.asset || '';
      byId('transactionType').value = item.type || '\ub9e4\uc218';
      byId('transactionDate').type = item.type === '\ubc30\ub2f9' ? 'month' : 'date';
      byId('transactionDate').value = item.type === '\ubc30\ub2f9' ? (item.date || '').slice(0, 7) : (item.date || '');
      byId('transactionQty').value = dividendValues ? dividendValues.quantity || '' : Math.abs(number(item.qty)) || '';
      byId('transactionPrice').value = dividendValues ? dividendValues.perShare || '' : number(item.price) || '';
      byId('transactionCurrency').value = item.currency || 'KRW';
      byId('transactionFx').value = number(item.fxRate) || 1;
      byId('transactionAmount').value = dividendValues ? dividendValues.netLocal || '' : number(item.localAmount) || Math.abs(number(item.amount)) / (number(item.fxRate) || 1);
      byId('transactionFee').value = dividendValues ? '' : number(item.fee) || '';
      byId('transactionTax').value = dividendValues ? '' : number(item.tax) || '';
      byId('dividendRecordDate').value = item.recordDate || '';
      byId('dividendExDate').value = item.exDividendDate || previousBusinessDay(item.recordDate);
      byId('transactionNote').value = item.note || '';
      updateTransactionMode();
    }, 0);
  });

  renderTransactions = function () {
    const accountValue = byId('txAccountFilter')?.value || '';
    const assetValue = byId('txAssetFilter')?.value || '';
    const typeValue = byId('txTypeFilter')?.value || '';
    const ledger = portfolioLedger();
    const list = transactions
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (b.item.date || '').localeCompare(a.item.date || '') || b.index - a.index)
      .filter(({ item }) => (!accountValue || item.account === accountValue) && (!assetValue || item.asset === assetValue) && (!typeValue || item.type === typeValue));
    byId('transactionRows').innerHTML = list.map(({ item, index }) => {
      const result = ledger.transactionResults.get(index) || {};
      const performance = item.type === '\ubc30\ub2f9' ? result.dividend : item.type === '\ub9e4\ub3c4' ? result.realized : 0;
      const dividendValues = item.type === '\ubc30\ub2f9' ? dividendDerivedValues(item) : null;
      const displayQuantity = dividendValues ? dividendValues.quantity : Math.abs(number(item.qty));
      const displayPrice = dividendValues ? dividendPerShareDisplay(dividendValues.perShare) : number(item.price);
      const currency = item.currency || 'KRW';
      const currencyLabel = currency === 'KRW'
        ? '\uc6d0\ud654 \uac70\ub798'
        : `${esc(currency)} \u00b7 \ud658\uc728 ${number(item.fxRate).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}\uc6d0`;
      return `<tr>
        <td>${esc(item.date)}</td>
        <td>${item.type === '\ubc30\ub2f9' ? '\uc804\uccb4 \uacc4\uc88c' : esc(item.account || '-')}</td>
        <td><b>${esc(item.asset)}</b><div class="muted cell-note">${currencyLabel}</div></td>
        <td><span class="tag ${item.type === '\ub9e4\ub3c4' ? 'red' : item.type === '\ubc30\ub2f9' ? 'income' : ''}">${esc(item.type)}</span></td>
        <td>${displayQuantity ? displayQuantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : '-'}</td>
        <td>${displayPrice ? displayPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : '-'}</td>
        <td>${won(dividendValues ? dividendValues.netKrw : transactionGrossKrw(item))}${dividendValues ? '<div class="muted cell-note">\uc138\ud6c4 \ubc30\ub2f9\uae08</div>' : `<div class="muted cell-note">\ube44\uc6a9 ${won(number(item.fee) + number(item.tax))}</div>`}</td>
        <td class="${performance < 0 ? 'down' : performance > 0 ? 'up' : ''}">${performance ? won(performance) : '-'}</td>
        <td>${esc(item.note || '-')}</td>
        <td class="row-actions"><button class="row-action edit" data-transaction-edit="${index}" title="\uac70\ub798 \uc218\uc815">&#9998;</button><button class="row-action delete" data-transaction-delete="${index}" title="\uac70\ub798 \uc0ad\uc81c">&#128465;</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="10" class="empty">\uc870\uac74\uc5d0 \ub9de\ub294 \uac70\ub798 \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</td></tr>';
    if (byId('txResultCount')) byId('txResultCount').textContent = `${list.length}\uac74 / \uc804\uccb4 ${transactions.length}\uac74`;
  };

  document.querySelector('#transactions thead tr').innerHTML =
    ['\uac70\ub798\uc77c', '\uac70\ub798\uacc4\uc88c', '\uc885\ubaa9\uba85', '\uad6c\ubd84', '\uc218\ub7c9', '\ub2e8\uac00', '\uac70\ub798\uae08\uc561(\uc6d0)', '\ud655\uc815\uc218\uc775', '\ube44\uace0', '']
      .map(label => `<th>${label}</th>`).join('');
  const dividendFilter = byId('txTypeFilter');
  if (dividendFilter && ![...dividendFilter.options].some(option => option.value === '\ubc30\ub2f9')) {
    dividendFilter.add(new Option('\ubc30\ub2f9', '\ubc30\ub2f9'));
  }

  renderAssets = function () {
    const query = byId('search').value.toLowerCase();
    const account = byId('accountFilter').value;
    const positions = portfolioLedger().positions
      .filter(position => position.name.toLowerCase().includes(query) && (!account || position.account === account))
      .sort((left, right) => number(right.value) - number(left.value) || left.name.localeCompare(right.name, 'ko-KR'));
    byId('assetRows').innerHTML = positions.map(position => `
      <tr>
        <td><button type="button" class="plan-asset-name holding-asset-name" data-market-asset="${encodeURIComponent(position.name)}" title="클릭하여 시세와 뉴스 보기"><b>${esc(position.name)}</b><span class="muted cell-note">${esc(position.currency)} \u00b7 ${esc(position.market)}</span></button></td>
        <td>${esc(position.account)}</td>
        <td>${esc(position.category)}<div class="muted cell-note">${esc(position.risk)} \u00b7 ${esc(position.country)}</div></td>
        <td>${won(position.cost)}<div class="muted cell-note">\ud3c9\uade0 ${won(position.qty ? position.cost / position.qty : 0)}</div></td>
        <td>${won(position.value)}<div class="muted cell-note">${position.qty.toLocaleString('ko-KR')} \uc8fc${position.currency !== 'KRW' ? ` \u00b7 ${formatMasterPrice({ ...masterForAsset(position.name), price: position.currentPrice, currency: position.currency })} \u00b7 \ud658\uc728 ${position.currentFx.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}` : ''}</div></td>
        <td><span class="tag ${position.returnRate < 0 ? 'red' : ''}">${position.returnRate.toFixed(2)}%</span></td>
        <td><span class="market-badge ${position.market === '\ud574\uc678' ? 'overseas' : ''}">${esc(position.market)}</span></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">\ubcf4\uc720 \uc790\uc0b0\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</td></tr>';
    byId('assetRows').querySelectorAll('[data-market-asset]').forEach(button => {
      button.onclick = () => window.openMarketDetail?.(decodeURIComponent(button.dataset.marketAsset));
    });
    byId('assetCount').textContent = `${positions.length}\uac1c`;
  };

  // The former goal container is now the financial-planning view.
  renderGoals = function () {};

  const assetHeaders = document.querySelectorAll('#assets thead th');
  ['\uc885\ubaa9\uba85', '\uacc4\uc88c', '\ubd84\ub958', '\ucde8\ub4dd\uc6d0\uac00', '\ud3c9\uac00\uae08\uc561', '\ud3c9\uac00\uc218\uc775\ub960', '\uc2dc\uc7a5'].forEach((label, index) => {
    if (assetHeaders[index]) assetHeaders[index].textContent = label;
  });

  renderDashboard = function () {
    const ledger = portfolioLedger();
    const deposits = (window.WB_SAFE || []).reduce((sum, item) => sum + number(item.current), 0);
    const investmentValue = ledger.positions.reduce((sum, item) => sum + item.value, 0);
    const investmentCost = ledger.positions.reduce((sum, item) => sum + item.cost, 0);
    const unrealized = investmentValue - investmentCost;
    const total = investmentValue + deposits;
    const totalProfit = unrealized + ledger.realized + ledger.dividends;
    const overseas = ledger.positions.filter(item => item.market === '\ud574\uc678' || item.currency !== 'KRW').reduce((sum, item) => sum + item.value, 0);
    byId('total').textContent = won(total);
    byId('cost').textContent = won(investmentCost + deposits);
    byId('profit').textContent = won(totalProfit);
    byId('profit').className = 'num ' + (totalProfit < 0 ? 'down' : 'up');
    byId('return').textContent = (investmentCost ? totalProfit / investmentCost * 100 : 0).toFixed(2) + '%';
    byId('return').className = 'num ' + (totalProfit < 0 ? 'down' : 'up');
    byId('stockPct').textContent = (total ? investmentValue / total * 100 : 0).toFixed(1) + '%';
    byId('cashPct').textContent = (total ? deposits / total * 100 : 0).toFixed(1) + '%';
    byId('stockBar').style.width = (total ? investmentValue / total * 100 : 0) + '%';
    byId('cashBar').style.width = (total ? deposits / total * 100 : 0) + '%';
    byId('dashboardRealized').textContent = won(ledger.realized);
    byId('dashboardRealized').className = ledger.realized < 0 ? 'down' : 'up';
    byId('dashboardDividend').textContent = won(ledger.dividends);
    byId('dashboardOverseas').textContent = won(overseas);
    const fxDates = Object.values(exchangeRateMap()).map(item => item?.date).filter(Boolean).sort();
    byId('dashboardOverseas').parentElement.title = fxDates.length ? `ECB \ud658\uc728 ${fxDates.at(-1)} \uae30\uc900` : '\uc800\uc7a5\ub41c \ud658\uc728 \uae30\uc900';
    byId('dashboardCosts').textContent = won(ledger.fees + ledger.taxes);
    renderExposureCharts(ledger);
  };

  function filteredTransactionIndexes() {
    const from = byId('performanceFrom').value;
    const to = byId('performanceTo').value;
    const account = byId('performanceAccount').value;
    return transactions.map((item, index) => ({ item, index })).filter(({ item }) => {
      const monthlyDividend = item.type === '\ubc30\ub2f9' && /^\d{4}-\d{2}$/.test(item.date || '');
      const periodStart = monthlyDividend ? `${item.date}-01` : item.date;
      const periodEnd = monthlyDividend ? `${item.date}-31` : item.date;
      return (!from || periodEnd >= from) && (!to || periodStart <= to) && (!account || item.account === account);
    });
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportPerformanceCsv() {
    const ledger = portfolioLedger();
    const header = [
      '\uac70\ub798\uc77c\u00b7\uc9c0\uae09\uc6d4', '\ubc30\ub2f9 \uae30\uc900\uc77c', '\ubc30\ub2f9\ub77d\uc77c', '\uacc4\uc88c', '\uc885\ubaa9\uba85', '\uac70\ub798\uad6c\ubd84', '\uac70\ub798\ud1b5\ud654', '\uc801\uc6a9\ud658\uc728',
      '\uc218\ub7c9', '\ub2e8\uac00', '\uac70\ub798\uae08\uc561(\uc6d0)', '\uc218\uc218\ub8cc(\uc6d0)', '\uc138\uae08(\uc6d0)',
      '\uc2e4\ud604\uc190\uc775(\uc6d0)', '\ubc30\ub2f9\uc21c\uc218\ub839\uc561(\uc6d0)', '\ube44\uace0'
    ];
    const rows = filteredTransactionIndexes()
      .sort((a, b) => (b.item.date || '').localeCompare(a.item.date || ''))
      .map(({ item, index }) => {
        const result = ledger.transactionResults.get(index) || {};
        const dividendValues = item.type === '\ubc30\ub2f9' ? dividendDerivedValues(item) : null;
        return [
          item.date, item.recordDate || '', item.exDividendDate || '', item.account, item.asset, item.type, item.currency || 'KRW', number(item.fxRate) || 1,
          dividendValues ? dividendValues.quantity : Math.abs(number(item.qty)), dividendValues ? dividendPerShareDisplay(dividendValues.perShare) : number(item.price), dividendValues ? dividendValues.netKrw : transactionGrossKrw(item), number(item.fee),
          number(item.tax), number(result.realized), number(result.dividend), item.note || ''
        ];
      });
    const csv = '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `a-money-portfolio-\uc131\uacfc-${today()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function monthKeysEndingAt(endMonth, count, minimumMonth) {
    const [year, month] = endMonth.split('-').map(Number);
    const result = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(year, month - 1 - offset, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!minimumMonth || key >= minimumMonth) result.push(key);
    }
    return result;
  }

  function monthKeysBetween(startMonth, endMonth) {
    if (!startMonth || !endMonth) return [];
    const [startYear, startNumber] = startMonth.split('-').map(number);
    const [endYear, endNumber] = endMonth.split('-').map(number);
    const current = new Date(startYear, startNumber - 1, 1);
    const end = new Date(endYear, endNumber - 1, 1);
    const result = [];
    while (current <= end && result.length < 240) {
      result.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`);
      current.setMonth(current.getMonth() + 1);
    }
    return result;
  }

  function compactWon(value) {
    const amount = Math.abs(number(value));
    if (amount >= 100000000) return `\u20a9${(amount / 100000000).toFixed(amount >= 1000000000 ? 0 : 1)}\uc5b5`;
    if (amount >= 10000) return `\u20a9${(amount / 10000).toFixed(amount >= 100000 ? 0 : 1)}\ub9cc`;
    return won(amount);
  }

  function openDividendMonthDetail(month) {
    const entries = filteredTransactionIndexes()
      .filter(({ item }) => item.type === '\ubc30\ub2f9' && (item.date || '').slice(0, 7) === month)
      .map(({ item, index }) => ({ item, index, derived: dividendDerivedValues(item) }))
      .sort((left, right) => right.derived.netKrw - left.derived.netKrw);
    const total = entries.reduce((sum, entry) => sum + entry.derived.netKrw, 0);
    const assets = new Set(entries.map(entry => entry.item.asset)).size;
    const [year, monthNumber] = month.split('-').map(number);
    byId('dividendMonthTitle').textContent = `${year}\ub144 ${monthNumber}\uc6d4 \ubc30\ub2f9\uae08`;
    byId('dividendMonthPeriod').textContent = '\uc804\uccb4 \uacc4\uc88c \uae30\uc900 \u00b7 \uc138\ud6c4 \uc218\ub839\uc561';
    byId('dividendMonthSummary').innerHTML = `
      <div><span>\uc138\ud6c4 \ubc30\ub2f9\uae08</span><b>${won(total)}</b></div>
      <div><span>\uc9c0\uae09 \uc885\ubaa9</span><b>${assets}\uac1c</b></div>
      <div><span>\ubc30\ub2f9 \ub0b4\uc5ed</span><b>${entries.length}\uac74</b></div>`;
    byId('dividendMonthRows').innerHTML = entries.map(({ item, derived }) => {
      const currency = item.currency || 'KRW';
      const perShare = dividendPerShareDisplay(derived.perShare);
      const perShareLabel = `${currency === 'KRW' ? '' : `${esc(currency)} `}${perShare.toLocaleString('ko-KR')}${currency === 'KRW' ? '\uc6d0' : ''}`;
      return `<tr>
        <td><b>${esc(item.asset || '-')}</b></td>
        <td>${derived.schedule.recordDate ? `<b>${esc(derived.schedule.recordDate)}</b><div class="muted cell-note">\ubc30\ub2f9\ub77d ${esc(derived.schedule.exDividendDate || '-')}</div>${item.paymentDate ? `<div class="muted cell-note">\uc9c0\uae09 ${esc(item.paymentDate)}</div>` : ''}` : '<span class="setup-warning">\uc77c\uc815 \ud655\uc778 \ud544\uc694</span>'}</td>
        <td>${derived.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}\uc8fc</td>
        <td>${perShare ? perShareLabel : '-'}</td>
        <td class="up"><b>${won(derived.netKrw)}</b></td>
        <td>${esc(item.note || '-')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">\uc774 \ub2ec\uc5d0 \uc785\ub825\ub41c \ubc30\ub2f9\uae08 \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</td></tr>';
    openModal('dividendMonthModal');
  }

  function openIncomeDetail(asset, kind = 'all') {
    const ledger = portfolioLedger();
    const filtered = filteredTransactionIndexes().filter(({ item }) => item.asset === asset);
    const realizedTotal = filtered.reduce((sum, { item, index }) => {
      if (item.type !== '\ub9e4\ub3c4') return sum;
      return sum + number(ledger.transactionResults.get(index)?.realized);
    }, 0);
    const dividendTotal = filtered.reduce((sum, { item, index }) => {
      if (item.type !== '\ubc30\ub2f9') return sum;
      return sum + number(ledger.transactionResults.get(index)?.dividend);
    }, 0);
    const entries = filtered
      .filter(({ item }) => (kind === 'all' && (item.type === '\ub9e4\ub3c4' || item.type === '\ubc30\ub2f9')) || (kind === 'realized' && item.type === '\ub9e4\ub3c4') || (kind === 'dividend' && item.type === '\ubc30\ub2f9'))
      .map(({ item, index }) => ({ item, index, result: ledger.transactionResults.get(index) || {}, derived: item.type === '\ubc30\ub2f9' ? dividendDerivedValues(item) : null }))
      .sort((left, right) => (right.item.date || '').localeCompare(left.item.date || '') || right.index - left.index);
    const kindLabel = kind === 'realized' ? '\uc2e4\ud604\uc190\uc775' : kind === 'dividend' ? '\ubc30\ub2f9' : '\ud655\uc815\uc218\uc775';
    const from = byId('performanceFrom').value || '\uc804\uccb4';
    const to = byId('performanceTo').value || '\ud604\uc7ac';
    const account = byId('performanceAccount').value || '\uc804\uccb4 \uacc4\uc88c';
    byId('incomeDetailTitle').textContent = `${asset} \u00b7 ${kindLabel} \ub0b4\uc5ed`;
    byId('incomeDetailPeriod').textContent = `${from} ~ ${to} \u00b7 ${account}`;
    byId('incomeDetailSummary').innerHTML = `
      <div><span>\uc2e4\ud604\uc190\uc775</span><b class="${realizedTotal < 0 ? 'down' : 'up'}">${won(realizedTotal)}</b></div>
      <div><span>\ubc30\ub2f9</span><b class="up">${won(dividendTotal)}</b></div>
      <div><span>\ud569\uacc4</span><b class="${realizedTotal + dividendTotal < 0 ? 'down' : 'up'}">${won(realizedTotal + dividendTotal)}</b></div>`;
    byId('incomeDetailRows').innerHTML = entries.map(({ item, result, derived }) => {
      const dividend = item.type === '\ubc30\ub2f9';
      const currency = item.currency || 'KRW';
      const quantity = dividend ? derived.quantity : Math.abs(number(item.qty));
      const price = dividend ? dividendPerShareDisplay(derived.perShare) : number(item.price);
      const priceLabel = price ? `${currency === 'KRW' ? '' : `${esc(currency)} `}${price.toLocaleString('ko-KR', { maximumFractionDigits: dividend ? 0 : 4 })}${currency === 'KRW' ? '\uc6d0' : ''}` : '-';
      const context = dividend
        ? (derived.schedule.recordDate ? `<b>\uae30\uc900 ${esc(derived.schedule.recordDate)}</b><div class="muted cell-note">\ubc30\ub2f9\ub77d ${esc(derived.schedule.exDividendDate || '-')}</div>` : '<span class="setup-warning">\uc77c\uc815 \ud655\uc778 \ud544\uc694</span>')
        : `<b>${esc(item.account || '-')}</b><div class="muted cell-note">\ube44\uc6a9 ${won(number(item.fee) + number(item.tax))}</div>`;
      const confirmed = dividend ? number(result.dividend) : number(result.realized);
      return `<tr>
        <td><span class="tag ${dividend ? 'income' : 'red'}">${dividend ? '\ubc30\ub2f9' : '\ub9e4\ub3c4'}</span></td>
        <td><b>${esc(item.date || '-')}</b></td>
        <td>${context}</td>
        <td>${quantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}\uc8fc</td>
        <td>${priceLabel}</td>
        <td>${won(dividend ? derived.netKrw : transactionGrossKrw(item))}</td>
        <td class="${confirmed < 0 ? 'down' : 'up'}"><b>${won(confirmed)}</b></td>
      </tr>`;
    }).join('') || `<tr><td colspan="7" class="empty">${kindLabel} \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</td></tr>`;
    openModal('incomeDetailModal');
  }

  function renderPerformance() {
    const ledger = portfolioLedger();
    const filtered = filteredTransactionIndexes();
    const byAsset = new Map();
    const byMonth = new Map();
    let realized = 0;
    let dividends = 0;

    filtered.forEach(({ item, index }) => {
      const result = ledger.transactionResults.get(index) || {};
      realized += number(result.realized);
      dividends += number(result.dividend);
      if (!byAsset.has(item.asset)) byAsset.set(item.asset, { realized: 0, dividends: 0 });
      byAsset.get(item.asset).realized += number(result.realized);
      byAsset.get(item.asset).dividends += number(result.dividend);
      if (number(result.dividend)) {
        const month = (item.date || '').slice(0, 7);
        byMonth.set(month, (byMonth.get(month) || 0) + number(result.dividend));
      }
    });

    const net = realized + dividends;
    byId('performanceRealized').textContent = won(realized);
    byId('performanceRealized').className = 'num ' + (realized < 0 ? 'down' : 'up');
    byId('performanceDividend').textContent = won(dividends);
    byId('performanceNet').textContent = won(net);
    byId('performanceNet').className = 'num ' + (net < 0 ? 'down' : 'up');

    const allMonths = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const visibleMonths = !allMonths.length
      ? []
      : (dividendChartMonths === 'all'
          ? monthKeysBetween(allMonths[0][0], allMonths.at(-1)[0])
          : monthKeysEndingAt(allMonths.at(-1)[0], number(dividendChartMonths)))
        .map(month => [month, byMonth.get(month) || 0]);
    const max = Math.max(1, ...visibleMonths.map(item => item[1]));
    const visibleMonthMap = new Map(visibleMonths);
    const visibleYears = [...new Set(visibleMonths.map(([month]) => month.slice(0, 4)))];
    byId('incomeChart').innerHTML = visibleMonths.length ? visibleYears.map(year => {
      const yearMonths = Array.from({ length: 12 }, (_, index) => {
        const month = `${year}-${String(index + 1).padStart(2, '0')}`;
        return [month, visibleMonthMap.get(month), visibleMonthMap.has(month)];
      });
      const yearTotal = yearMonths.reduce((sum, [, value, visible]) => sum + (visible ? number(value) : 0), 0);
      const paidMonths = yearMonths.filter(([, value, visible]) => visible && number(value) > 0).length;
      return `<section class="income-year-group">
        <div class="income-year-summary"><b>${year}\ub144</b><span>${paidMonths}\uac1c\uc6d4 \uc9c0\uae09</span><strong>${won(yearTotal)}</strong></div>
        <div class="income-month-grid">${yearMonths.map(([month, value, visible], index) => {
          const paid = visible && number(value) > 0;
          const height = paid ? Math.max(8, number(value) / max * 100) : 0;
          return `<button type="button" class="income-month-cell ${visible ? '' : 'outside-range'} ${paid ? 'has-income' : 'no-income'}" ${visible ? `data-dividend-month="${month}" aria-label="${month} \ubc30\ub2f9\uae08 ${won(value)} \uc0c1\uc138 \ubcf4\uae30"` : 'disabled'} title="${month} \u00b7 ${visible ? `${won(value)} \u00b7 \ud074\ub9ad\ud558\uc5ec \uc0c1\uc138 \ubcf4\uae30` : '\uc870\ud68c \uae30\uac04 \uc678'}">
            <span>${index + 1}\uc6d4</span>
            <b>${paid ? compactWon(value) : visible ? '-' : ''}</b>
            <div class="income-mini-track"><i style="height:${height}%"></i></div>
          </button>`;
        }).join('')}</div>
      </section>`;
    }).join('') : '<div class="empty">\uc120\ud0dd\ud55c \uae30\uac04\uc758 \ubc30\ub2f9 \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</div>';
    const visibleDividendTotal = visibleMonths.reduce((sum, [, value]) => sum + value, 0);
    const paidMonthValues = visibleMonths.map(([, value]) => number(value)).filter(Boolean);
    const averageDividend = paidMonthValues.length ? visibleDividendTotal / paidMonthValues.length : 0;
    const bestMonth = visibleMonths.reduce((best, current) => current[1] > best[1] ? current : best, ['', 0]);
    byId('dividendPeriod').textContent = visibleMonths.length
      ? `${visibleMonths[0][0]} ~ ${visibleMonths.at(-1)[0]} \u00b7 \ud569\uacc4 ${won(visibleDividendTotal)} \u00b7 \uc9c0\uae09\uc6d4 \ud3c9\uade0 ${won(averageDividend)}${bestMonth[1] ? ` \u00b7 \ucd5c\uace0 ${bestMonth[0]} ${won(bestMonth[1])}` : ''}`
      : '\ubc30\ub2f9 \ub0b4\uc5ed \uc5c6\uc74c';

    const rows = [...byAsset.entries()]
      .map(([name, value]) => ({ name, ...value, total: value.realized + value.dividends }))
      .filter(item => item.realized || item.dividends)
      .sort((a, b) => b.total - a.total);
    byId('performanceRows').innerHTML = rows.map(item => `
      <tr>
        <td><button type="button" class="income-detail-link asset" data-income-asset="${esc(encodeURIComponent(item.name))}" data-income-kind="all" title="\ub9e4\ub9e4\u00b7\ubc30\ub2f9 \uc804\uccb4 \ub0b4\uc5ed">${esc(item.name)}</button></td>
        <td><button type="button" class="income-detail-link ${item.realized < 0 ? 'down' : 'up'}" data-income-asset="${esc(encodeURIComponent(item.name))}" data-income-kind="realized" title="\ub9e4\ub3c4 \uac70\ub798\uc640 \uc2e4\ud604\uc190\uc775 \ub0b4\uc5ed">${won(item.realized)}</button></td>
        <td><button type="button" class="income-detail-link up" data-income-asset="${esc(encodeURIComponent(item.name))}" data-income-kind="dividend" title="\ubc30\ub2f9\uae08 \ub0b4\uc5ed">${won(item.dividends)}</button></td>
        <td><button type="button" class="income-detail-link total ${item.total < 0 ? 'down' : 'up'}" data-income-asset="${esc(encodeURIComponent(item.name))}" data-income-kind="all" title="\ud655\uc815\uc218\uc775 \uc804\uccb4 \ub0b4\uc5ed">${won(item.total)}</button></td>
      </tr>`
    ).join('') || '<tr><td colspan="4" class="empty">\ud655\uc815\uc218\uc775 \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</td></tr>';

    const dividendEntries = filtered
      .filter(({ item }) => item.type === '\ubc30\ub2f9')
      .sort((left, right) => (right.item.date || '').localeCompare(left.item.date || '') || right.index - left.index);
    byId('dividendResultCount').textContent = `${dividendEntries.length}\uac74`;
    byId('dividendRows').innerHTML = dividendEntries.map(({ item, index }) => {
      const currency = item.currency || 'KRW';
      const derived = dividendDerivedValues(item);
      const perShareLabel = derived.perShare
        ? `${currency === 'KRW' ? '' : `${esc(currency)} `}${dividendPerShareDisplay(derived.perShare).toLocaleString('ko-KR')}${currency === 'KRW' ? '\uc6d0' : ''}`
        : '-';
      const netLabel = currency === 'KRW'
        ? won(derived.netKrw)
        : `${esc(currency)} ${derived.netLocal.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}<div class="muted cell-note">${won(derived.netKrw)} \u00b7 \ud658\uc728 ${number(item.fxRate).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}</div>`;
      return `<tr>
        <td>${esc((item.date || '').slice(0, 7) || '-')}</td>
        <td><b>${esc(item.asset || '-')}</b></td>
        <td title="${esc(item.dividendScheduleSource || '')}">${derived.schedule.recordDate ? `<b>${esc(derived.schedule.recordDate)}</b><div class="muted cell-note">\ubc30\ub2f9\ub77d ${esc(derived.schedule.exDividendDate)}</div>${item.paymentDate ? `<div class="muted cell-note">\uc2e4\uc81c \uc9c0\uae09 ${esc(item.paymentDate)}</div>` : ''}` : '<span class="setup-warning">\uae30\uc900\uc77c \uc785\ub825</span>'}</td>
        <td>${derived.quantity ? `${derived.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}\uc8fc` : '<span class="setup-warning">\uac70\ub798\ub0b4\uc5ed \ud655\uc778</span>'}</td>
        <td>${perShareLabel}${derived.suspicious ? '<div class="dividend-anomaly visible">\uc785\ub825\uac12 \ud655\uc778</div>' : ''}</td>
        <td class="up"><b>${netLabel}</b></td>
        <td>${esc(item.note || '-')}</td>
        <td class="row-actions"><button class="row-action edit" data-transaction-edit="${index}" title="\ubc30\ub2f9\uae08 \uc218\uc815" aria-label="\ubc30\ub2f9\uae08 \uc218\uc815">&#9998;</button><button class="row-action delete" data-transaction-delete="${index}" title="\ubc30\ub2f9\uae08 \uc0ad\uc81c" aria-label="\ubc30\ub2f9\uae08 \uc0ad\uc81c">&#128465;</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">\uc785\ub825\ub41c \ubc30\ub2f9\uae08 \ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</td></tr>';
  }

  byId('dividendChartRange').addEventListener('click', event => {
    const button = event.target.closest('[data-dividend-months]');
    if (!button) return;
    dividendChartMonths = button.dataset.dividendMonths;
    byId('dividendChartRange').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    renderPerformance();
  });
  byId('incomeChart').addEventListener('click', event => {
    const month = event.target.closest('[data-dividend-month]')?.dataset.dividendMonth;
    if (month) openDividendMonthDetail(month);
  });
  byId('performanceRows').addEventListener('click', event => {
    const button = event.target.closest('[data-income-asset]');
    if (!button) return;
    openIncomeDetail(decodeURIComponent(button.dataset.incomeAsset), button.dataset.incomeKind || 'all');
  });
  const closeDividendMonth = () => closeModal('dividendMonthModal');
  byId('closeDividendMonth').onclick = closeDividendMonth;
  byId('closeDividendMonthIcon').onclick = closeDividendMonth;
  dividendMonthModal.addEventListener('click', event => {
    if (event.target === dividendMonthModal) closeDividendMonth();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dividendMonthModal.classList.contains('open')) closeDividendMonth();
  });
  const closeIncomeDetail = () => closeModal('incomeDetailModal');
  byId('closeIncomeDetail').onclick = closeIncomeDetail;
  byId('closeIncomeDetailIcon').onclick = closeIncomeDetail;
  incomeDetailModal.addEventListener('click', event => {
    if (event.target === incomeDetailModal) closeIncomeDetail();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && incomeDetailModal.classList.contains('open')) closeIncomeDetail();
  });
  ['performanceFrom', 'performanceTo', 'performanceAccount'].forEach(id => byId(id).addEventListener('change', renderPerformance));
  byId('resetPerformance').onclick = () => {
    byId('performanceFrom').value = '';
    byId('performanceTo').value = '';
    byId('performanceAccount').value = '';
    renderPerformance();
  };
  byId('exportPerformance').onclick = exportPerformanceCsv;
  byId('refreshDividendSchedules').onclick = () => refreshDividendSchedules(true);

  const dashboard = byId('dashboard');
  const dashboardDataManagement = byId('export')?.closest('.panel');
  if (dashboardDataManagement) {
    dashboardDataManagement.classList.add('settings-data-management');
    byId('settings').appendChild(dashboardDataManagement);
  }
  const dashboardLegacy = document.createElement('div');
  dashboardLegacy.hidden = true;
  dashboardLegacy.id = 'dashboardLegacy';
  while (dashboard.firstChild) dashboardLegacy.appendChild(dashboard.firstChild);
  dashboard.appendChild(dashboardLegacy);
  const dashboardWorkspace = document.createElement('div');
  dashboardWorkspace.className = 'dashboard-workspace';
  dashboardWorkspace.innerHTML = `
    <div class="dashboard-commandbar">
      <div><h2>\uc790\uc0b0 \ud604\ud669</h2><p id="dbDataBasis">\uc800\uc7a5\ub41c \uac70\ub798\uc640 \ucd5c\uc2e0 \uc2dc\uc138 \uae30\uc900</p></div>
      <div class="dashboard-actions">
        <button type="button" class="btn light" id="dbRefresh">&#8635; \uc2dc\uc138\u00b7\ud658\uc728 \uac31\uc2e0</button>
        <button type="button" class="btn" id="dbAddTransaction">+ \uac70\ub798 \ucd94\uac00</button>
      </div>
    </div>
    <section class="dashboard-kpis" aria-label="\ud575\uc2ec \uc790\uc0b0 \uc9c0\ud45c">
      <div><span>\uc21c\uc790\uc0b0</span><strong id="dbNetWorth">-</strong><small>\ud22c\uc790\uc790\uc0b0 + \uc608\u00b7\uc801\uae08</small></div>
      <div><span>\ucd1d \ud22c\uc790\uc6d0\uae08</span><strong id="dbInvested">-</strong><small>\ud604\uc7ac \ubcf4\uc720 \ucde8\ub4dd\uc6d0\uac00</small></div>
      <div><span>\ub204\uc801 \uc190\uc775</span><strong id="dbProfit">-</strong><small id="dbProfitDetail">\ud3c9\uac00 + \uc2e4\ud604 + \ubc30\ub2f9</small></div>
      <div><span>\ud22c\uc790 \uc218\uc775\ub960</span><strong id="dbReturn">-</strong><small>\ud22c\uc790\uc6d0\uae08 \ub300\ube44</small></div>
      <div><span>\uc608\u00b7\uc801\uae08</span><strong id="dbDeposits">-</strong><small id="dbMonthlySaving">\uc6d4 \ub0a9\uc785 -</small></div>
    </section>
    <section class="dashboard-section net-worth-trend-section">
      <div class="dashboard-section-head net-worth-trend-head">
        <div><h3>\uc6d4\ubcc4 \uc21c\uc790\uc0b0 \ubcc0\ub3d9</h3><p>\uc6d4\ub9d0 \ubcf4\uc720\uc218\ub7c9\u00b7\uac70\ub798\ub2e8\uac00\u00b7\uc608\u00b7\uc801\uae08 \ub0a9\uc785 \uae30\uc900</p></div>
        <div class="net-worth-trend-summary"><span>\uc804\uc6d4 \ub300\ube44</span><b id="dbTrendChange">-</b></div>
        <div class="period-control net-worth-period" id="dbTrendRange" aria-label="\uc21c\uc790\uc0b0 \uadf8\ub798\ud504 \uae30\uac04">
          <button type="button" data-months="6">6\uac1c\uc6d4</button><button type="button" class="active" data-months="12">1\ub144</button><button type="button" data-months="all">\uc804\uccb4</button>
        </div>
      </div>
      <div class="net-worth-chart" id="dbNetWorthChart"></div>
      <div class="net-worth-chart-note"><i></i><span>\ucd1d \uc21c\uc790\uc0b0</span><small>\uacfc\uac70 \uc2dc\uc138\uac00 \uc5c6\ub294 \uad6c\uac04\uc740 \ud574\ub2f9 \uc6d4\uae4c\uc9c0\uc758 \ucd5c\uc2e0 \uac70\ub798\ub2e8\uac00\ub85c \ucd94\uc815\ud569\ub2c8\ub2e4.</small></div>
    </section>
    <section class="dashboard-signals" aria-label="\ud3ec\ud2b8\ud3f4\ub9ac\uc624 \ud575\uc2ec \uc2e0\ud638">
      <div><span>\ucd5c\ub300 \uc885\ubaa9 \uc9d1\uc911\ub3c4</span><b id="dbConcentration">-</b><small id="dbConcentrationName">-</small></div>
      <div><span>\uace0\uc704\ud5d8 \uc790\uc0b0</span><b id="dbHighRisk">-</b><small>\ud22c\uc790\uc790\uc0b0 \uae30\uc900</small></div>
      <div><span>\ud574\uc678\uc790\uc0b0</span><b id="dbOverseas">-</b><small id="dbFxBasis">\ud658\uc728 \uae30\uc900 -</small></div>
      <div><span>\uc7ac\ubb34\uc124\uacc4 \uc870\uc815 \ud6c4\ubcf4</span><b id="dbPlanActions">-</b><small id="dbPlanDetail">\ub9e4\uc218 0 \u00b7 \ucd95\uc18c 0</small></div>
    </section>
    <div class="dashboard-primary-grid">
      <section class="dashboard-section">
        <div class="dashboard-section-head"><div><h3>\uc790\uc0b0\uad70 \ubc30\ubd84</h3><p>\uc21c\uc790\uc0b0 \uae30\uc900</p></div><b id="dbAllocationTotal">-</b></div>
        <div class="allocation-stack" id="dbAllocationStack"></div>
        <div class="dashboard-bar-list" id="dbAllocationRows"></div>
      </section>
      <section class="dashboard-section">
        <div class="dashboard-section-head"><div><h3>\uc190\uc775 \uad6c\uc131</h3><p>\ud604\uc7ac \ud3ec\ud2b8\ud3f4\ub9ac\uc624 \uae30\uc5ec\ub3c4</p></div><b id="dbPerformanceTotal">-</b></div>
        <div class="performance-bridge" id="dbPerformanceBridge"></div>
        <div class="dashboard-contributors" id="dbContributors"></div>
      </section>
    </div>
    <section class="dashboard-section dashboard-holdings-section">
      <div class="dashboard-section-head"><div><h3>\uc0c1\uc704 \ubcf4\uc720\uc885\ubaa9</h3><p>\ud3c9\uac00\uae08\uc561\u00b7\ube44\uc911\u00b7\uc218\uc775\ub960 \ube44\uad50</p></div><button type="button" class="text-command" data-dashboard-view="assets">\uc804\uccb4 \ubcf4\uae30</button></div>
      <div class="dashboard-holdings-head"><span>\uc885\ubaa9</span><span>\ud3c9\uac00\uae08\uc561</span><span>\ube44\uc911</span><span>\uc218\uc775\ub960</span></div>
      <div id="dbHoldingRows"></div>
    </section>
    <div class="dashboard-secondary-grid">
      <section class="dashboard-section">
        <div class="dashboard-section-head"><div><h3>\uc704\ud5d8 \ubd84\ud3ec</h3><p>\ud22c\uc790\uc790\uc0b0 \ud3c9\uac00\uae08\uc561 \uae30\uc900</p></div></div>
        <div class="risk-overview"><svg id="dbRiskDonut" viewBox="0 0 100 100" aria-label="\uc704\ud5d8\ub3c4 \ubd84\ud3ec"></svg><div id="dbRiskLegend"></div></div>
      </section>
      <section class="dashboard-section">
        <div class="dashboard-section-head"><div><h3>\uc810\uac80 \uc54c\ub9bc</h3><p>\uc9d1\uc911\ub3c4\u00b7\uc704\ud5d8\u00b7\ub370\uc774\ud130 \uc0c1\ud0dc</p></div><b id="dbAlertCount">0\uac74</b></div>
        <div class="dashboard-alerts" id="dbAlerts"></div>
      </section>
      <section class="dashboard-section">
        <div class="dashboard-section-head"><div><h3>\ucd5c\uadfc \uac70\ub798</h3><p>\uac70\ub798\uc77c \ucd5c\uc2e0\uc21c</p></div><button type="button" class="text-command" data-dashboard-view="transactions">\uc804\uccb4 \ubcf4\uae30</button></div>
        <div class="dashboard-compact-list" id="dbRecentTransactions"></div>
      </section>
      <section class="dashboard-section">
        <div class="dashboard-section-head"><div><h3>\uc608\u00b7\uc801\uae08 \uc77c\uc815</h3><p>\uc6b4\uc6a9 \uc911\uc778 \uc0c1\ud488 \ub9cc\uae30\uc21c</p></div><button type="button" class="text-command" data-dashboard-view="safe">\uc804\uccb4 \ubcf4\uae30</button></div>
        <div class="dashboard-compact-list" id="dbMaturities"></div>
      </section>
    </div>`;
  dashboard.appendChild(dashboardWorkspace);

  const dashboardColors = ['#216e8c', '#168166', '#d69a24', '#b64d47', '#5576a3', '#8b6aa8'];
  const dashboardRiskColors = { '\uace0\uc704\ud5d8': '#c9554f', '\uc911\uc704\ud5d8': '#d69a24', '\uc800\uc704\ud5d8': '#4f83b5', '\uc548\uc804': '#3d9277', '\ubbf8\ubd84\ub958': '#88959c' };
  let dashboardTrendRange = localStorage.getItem('wb-dashboard-trend-range') || '12';

  function dashboardMonthSequence() {
    const current = new Date();
    const currentMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
    const activeSafe = (window.WB_SAFE || []).filter(item => !item.closedDate && number(item.current) > 0);
    const candidates = transactions.map(item => (item.date || '').slice(0, 7)).filter(value => /^\d{4}-\d{2}$/.test(value));
    activeSafe.forEach(item => {
      const month = (item.openDate || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) candidates.push(month);
    });
    const start = candidates.sort()[0] || currentMonth;
    const [startYear, startMonth] = start.split('-').map(Number);
    const months = [];
    const cursor = new Date(startYear, startMonth - 1, 1);
    while (`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}` <= currentMonth && months.length < 180) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }

  function estimatedSafeBalanceAtMonth(item, month, isCurrentMonth) {
    const current = number(item.current);
    if (current <= 0) return 0;
    const openMonth = (item.openDate || '').slice(0, 7);
    const closedMonth = (item.closedDate || '').slice(0, 7);
    if (openMonth && month < openMonth) return 0;
    if (closedMonth && month >= closedMonth) return 0;
    if (isCurrentMonth || !openMonth) return current;
    const paid = Math.max(1, number(item.paid));
    if (paid <= 1) return current;
    const [openYear, openMonthNumber] = openMonth.split('-').map(Number);
    const [year, monthNumber] = month.split('-').map(Number);
    const elapsed = Math.max(0, (year - openYear) * 12 + monthNumber - openMonthNumber + 1);
    return current * Math.min(paid, elapsed) / paid;
  }

  function monthlyNetWorthSeries(currentInvestmentValue, currentDepositValue) {
    const months = dashboardMonthSequence();
    const activeSafe = (window.WB_SAFE || []).filter(item => !item.closedDate && number(item.current) > 0);
    const orderedTransactions = [...transactions]
      .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date || ''))
      .sort((left, right) => left.date.localeCompare(right.date));
    const states = new Map();
    let transactionIndex = 0;
    return months.map((month, monthIndex) => {
      while (transactionIndex < orderedTransactions.length && orderedTransactions[transactionIndex].date.slice(0, 7) <= month) {
        const item = orderedTransactions[transactionIndex++];
        if (item.type === '\ubc30\ub2f9') continue;
        const key = accountKey(item.account || '-', item.asset || '-');
        if (!states.has(key)) states.set(key, { qty: 0, price: 0, fx: 1 });
        const state = states.get(key);
        const quantity = Math.abs(number(item.qty));
        const isSell = item.type === '\ub9e4\ub3c4' || number(item.qty) < 0 || number(item.amount) < 0;
        state.qty = isSell ? Math.max(0, state.qty - quantity) : state.qty + quantity;
        state.price = number(item.price) || (quantity ? transactionGrossKrw(item) / quantity / (number(item.fxRate) || 1) : state.price);
        state.fx = number(item.fxRate) || state.fx || 1;
      }
      const isCurrentMonth = monthIndex === months.length - 1;
      const investment = isCurrentMonth
        ? currentInvestmentValue
        : [...states.values()].reduce((sum, state) => sum + state.qty * state.price * state.fx, 0);
      const deposits = isCurrentMonth
        ? currentDepositValue
        : activeSafe.reduce((sum, item) => sum + estimatedSafeBalanceAtMonth(item, month, false), 0);
      return { month, investment, deposits, value: investment + deposits };
    });
  }

  function compactDashboardWon(value) {
    const absolute = Math.abs(value);
    if (absolute >= 100000000) return `\u20a9${(value / 100000000).toFixed(1)}\uc5b5`;
    if (absolute >= 10000) return `\u20a9${Math.round(value / 10000).toLocaleString('ko-KR')}\ub9cc`;
    return won(value);
  }

  function renderNetWorthTrend(currentInvestmentValue, currentDepositValue) {
    const fullSeries = monthlyNetWorthSeries(currentInvestmentValue, currentDepositValue);
    const limit = dashboardTrendRange === 'all' ? fullSeries.length : number(dashboardTrendRange);
    const series = fullSeries.slice(-Math.max(2, limit));
    const container = byId('dbNetWorthChart');
    byId('dbTrendRange').querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.months === dashboardTrendRange));
    if (series.length < 2) {
      container.innerHTML = '<div class="dashboard-empty">\uadf8\ub798\ud504\ub97c \uad6c\uc131\ud560 \uc6d4\ubcc4 \ub370\uc774\ud130\uac00 \ubd80\uc871\ud569\ub2c8\ub2e4.</div>';
      byId('dbTrendChange').textContent = '-';
      return;
    }
    const latest = series.at(-1);
    const previous = series.at(-2);
    const change = latest.value - previous.value;
    const changeRate = previous.value ? change / previous.value * 100 : 0;
    byId('dbTrendChange').textContent = `${change >= 0 ? '+' : ''}${won(change)} (${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(1)}%)`;
    byId('dbTrendChange').className = change < 0 ? 'negative' : 'positive';

    const width = 1000;
    const height = 260;
    const padding = { left: 76, right: 22, top: 22, bottom: 38 };
    const values = series.map(item => item.value);
    const rawMinimum = Math.min(...values);
    const rawMaximum = Math.max(...values);
    const rawSpan = rawMaximum - rawMinimum || Math.max(1, rawMaximum * .1);
    const minimum = Math.max(0, rawMinimum - rawSpan * .12);
    const maximum = rawMaximum + rawSpan * .12;
    const span = maximum - minimum || 1;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const points = series.map((item, index) => ({
      ...item,
      x: padding.left + index * plotWidth / (series.length - 1),
      y: padding.top + (maximum - item.value) / span * plotHeight
    }));
    const linePath = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${points.at(-1).x.toFixed(1)} ${(height - padding.bottom).toFixed(1)} L${points[0].x.toFixed(1)} ${(height - padding.bottom).toFixed(1)} Z`;
    const grid = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const y = padding.top + ratio * plotHeight;
      const value = maximum - ratio * span;
      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="net-worth-grid-line"></line><text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" class="net-worth-axis-label">${compactDashboardWon(value)}</text>`;
    }).join('');
    const labelStep = Math.max(1, Math.ceil(series.length / 6));
    const xLabels = points.filter((point, index) => index === 0 || index === points.length - 1 || index % labelStep === 0)
      .map(point => `<text x="${point.x}" y="${height - 10}" text-anchor="middle" class="net-worth-axis-label">${point.month.slice(2).replace('-', '.')}</text>`).join('');
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="\uc6d4\ubcc4 \uc21c\uc790\uc0b0 \ubcc0\ub3d9 \uadf8\ub798\ud504">${grid}<path d="${areaPath}" class="net-worth-area"></path><path d="${linePath}" class="net-worth-line"></path><line id="dbTrendGuide" y1="${padding.top}" y2="${height - padding.bottom}" class="net-worth-guide" visibility="hidden"></line><circle id="dbTrendPoint" r="5" class="net-worth-point" visibility="hidden"></circle>${xLabels}</svg><div class="net-worth-tooltip" id="dbTrendTooltip"></div>`;
    const svg = container.querySelector('svg');
    const guide = byId('dbTrendGuide');
    const point = byId('dbTrendPoint');
    const tooltip = byId('dbTrendTooltip');
    svg.onpointermove = event => {
      const rect = svg.getBoundingClientRect();
      const svgX = Math.max(padding.left, Math.min(width - padding.right, (event.clientX - rect.left) / rect.width * width));
      const index = Math.max(0, Math.min(points.length - 1, Math.round((svgX - padding.left) / plotWidth * (points.length - 1))));
      const selected = points[index];
      const selectedChange = index ? selected.value - points[index - 1].value : 0;
      guide.setAttribute('x1', selected.x);
      guide.setAttribute('x2', selected.x);
      guide.setAttribute('visibility', 'visible');
      point.setAttribute('cx', selected.x);
      point.setAttribute('cy', selected.y);
      point.setAttribute('visibility', 'visible');
      tooltip.innerHTML = `<b>${selected.month.replace('-', '\ub144 ')}\uc6d4</b><strong>${won(selected.value)}</strong><span>\uc804\uc6d4 \ub300\ube44 ${index ? `${selectedChange >= 0 ? '+' : ''}${won(selectedChange)}` : '-'}</span>`;
      tooltip.style.display = 'grid';
      tooltip.style.left = `${Math.max(86, Math.min(rect.width - 86, selected.x / width * rect.width))}px`;
      tooltip.style.top = `${Math.max(6, selected.y / height * rect.height - 74)}px`;
    };
    svg.onpointerleave = () => {
      guide.setAttribute('visibility', 'hidden');
      point.setAttribute('visibility', 'hidden');
      tooltip.style.display = 'none';
    };
  }

  function dashboardAssetClass(position) {
    const category = position.category || '';
    if (category.includes('\ucc44\uad8c')) return '\ucc44\uad8c';
    if (category === '\uae08' || category.includes('\uae08\ud604\ubb3c')) return '\uae08';
    if (category.includes('\uae08\ub9ac') || category.includes('\ud604\uae08')) return '\ud604\uae08\uc131';
    if (category.includes('\ub9ac\uce20')) return '\ub9ac\uce20';
    return '\uc8fc\uc2dd';
  }

  function dashboardDonut(svg, legend, entries, colors) {
    const visible = entries.filter(([, value]) => value > 0);
    const total = visible.reduce((sum, [, value]) => sum + value, 0) || 1;
    const circumference = 2 * Math.PI * 35;
    let offset = 0;
    svg.innerHTML = '<circle cx="50" cy="50" r="35" class="donut-track"></circle>' + visible.map(([label, value]) => {
      const length = value / total * circumference;
      const color = colors[label] || '#88959c';
      const circle = `<circle cx="50" cy="50" r="35" stroke="${color}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"></circle>`;
      offset += length;
      return circle;
    }).join('');
    legend.innerHTML = visible.map(([label, value]) => `<div><i style="background:${colors[label] || '#88959c'}"></i><span>${esc(label)}</span><b>${(value / total * 100).toFixed(1)}%</b></div>`).join('');
  }

  function renderDecisionDashboard() {
    const ledger = portfolioLedger();
    const safeAssets = window.WB_SAFE || [];
    const activeSafe = safeAssets.filter(item => !item.closedDate && number(item.current) > 0);
    const deposits = activeSafe.reduce((sum, item) => sum + number(item.current), 0);
    const monthlySaving = activeSafe.reduce((sum, item) => sum + number(item.monthly), 0);
    const investmentValue = ledger.positions.reduce((sum, item) => sum + item.value, 0);
    const investmentCost = ledger.positions.reduce((sum, item) => sum + item.cost, 0);
    const unrealized = investmentValue - investmentCost;
    const totalProfit = unrealized + ledger.realized + ledger.dividends;
    const netWorth = investmentValue + deposits;
    const invested = investmentCost + deposits;
    const returnRate = investmentCost ? totalProfit / investmentCost * 100 : 0;
    const overseas = ledger.positions.filter(item => item.currency !== 'KRW' || item.market === '\ud574\uc678').reduce((sum, item) => sum + item.value, 0);

    byId('dbNetWorth').textContent = won(netWorth);
    byId('dbInvested').textContent = won(invested);
    byId('dbProfit').textContent = won(totalProfit);
    byId('dbProfit').className = totalProfit < 0 ? 'negative' : 'positive';
    byId('dbProfitDetail').textContent = `\ud3c9\uac00 ${won(unrealized)} \u00b7 \uc2e4\ud604 ${won(ledger.realized)} \u00b7 \ubc30\ub2f9 ${won(ledger.dividends)}`;
    byId('dbReturn').textContent = `${returnRate.toFixed(2)}%`;
    byId('dbReturn').className = returnRate < 0 ? 'negative' : 'positive';
    byId('dbDeposits').textContent = won(deposits);
    byId('dbMonthlySaving').textContent = `\uc6d4 \ub0a9\uc785 ${won(monthlySaving)}`;
    renderNetWorthTrend(investmentValue, deposits);

    const groupedHoldings = new Map();
    ledger.positions.forEach(position => {
      if (!groupedHoldings.has(position.name)) groupedHoldings.set(position.name, { name: position.name, value: 0, cost: 0, risk: position.risk, currency: position.currency });
      const holding = groupedHoldings.get(position.name);
      holding.value += position.value;
      holding.cost += position.cost;
    });
    const holdings = [...groupedHoldings.values()].sort((a, b) => b.value - a.value);
    const largest = holdings[0] || { name: '-', value: 0 };
    const concentration = investmentValue ? largest.value / investmentValue * 100 : 0;
    const highRiskValue = ledger.positions.filter(item => item.risk === '\uace0\uc704\ud5d8').reduce((sum, item) => sum + item.value, 0);
    const highRiskRate = investmentValue ? highRiskValue / investmentValue * 100 : 0;
    const planningPositions = aggregatePlanningPositions();
    const planningTotal = planningPositions.reduce((sum, item) => sum + item.value, 0) || 1;
    const plans = planningPositions.map(position => buildAdvancedPlan(position, planningTotal, securityMasters(), marketSignalMap()));
    const buyCount = plans.filter(plan => plan.action === '\ubd84\ud560\ub9e4\uc218').length;
    const reduceCount = plans.filter(plan => ['\ubd84\ud560\ub9e4\ub3c4', '\uc704\ud5d8\ucd95\uc18c'].includes(plan.action)).length;
    byId('dbConcentration').textContent = `${concentration.toFixed(1)}%`;
    byId('dbConcentrationName').textContent = largest.name;
    byId('dbHighRisk').textContent = `${highRiskRate.toFixed(1)}%`;
    byId('dbOverseas').textContent = `${(netWorth ? overseas / netWorth * 100 : 0).toFixed(1)}%`;
    const fxDates = Object.values(exchangeRateMap()).map(item => item?.date).filter(Boolean).sort();
    byId('dbFxBasis').textContent = `${won(overseas)} \u00b7 ${fxDates.at(-1) || '\ud658\uc728 \ubbf8\uac31\uc2e0'}`;
    byId('dbPlanActions').textContent = `${buyCount + reduceCount}\uac1c`;
    byId('dbPlanDetail').textContent = `\ub9e4\uc218 ${buyCount} \u00b7 \ucd95\uc18c ${reduceCount}`;

    const allocation = new Map([['\uc608\u00b7\uc801\uae08', deposits]]);
    ledger.positions.forEach(position => {
      const label = dashboardAssetClass(position);
      allocation.set(label, (allocation.get(label) || 0) + position.value);
    });
    const allocationRows = [...allocation.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    byId('dbAllocationTotal').textContent = won(netWorth);
    byId('dbAllocationStack').innerHTML = allocationRows.map(([label, value], index) => `<div style="width:${netWorth ? value / netWorth * 100 : 0}%;background:${dashboardColors[index % dashboardColors.length]}" title="${esc(label)} ${(netWorth ? value / netWorth * 100 : 0).toFixed(1)}%"></div>`).join('');
    byId('dbAllocationRows').innerHTML = allocationRows.map(([label, value], index) => `<div><i style="background:${dashboardColors[index % dashboardColors.length]}"></i><span>${esc(label)}</span><div><b>${won(value)}</b><small>${(netWorth ? value / netWorth * 100 : 0).toFixed(1)}%</small></div></div>`).join('');

    const components = [
      ['\ud3c9\uac00\uc190\uc775', unrealized], ['\uc2e4\ud604\uc190\uc775', ledger.realized], ['\ubc30\ub2f9', ledger.dividends], ['\uc218\uc218\ub8cc\u00b7\uc138\uae08', -(ledger.fees + ledger.taxes)]
    ];
    const maxComponent = Math.max(1, ...components.map(([, value]) => Math.abs(value)));
    byId('dbPerformanceTotal').textContent = won(totalProfit);
    byId('dbPerformanceTotal').className = totalProfit < 0 ? 'negative' : 'positive';
    byId('dbPerformanceBridge').innerHTML = components.map(([label, value]) => `<div><span>${label}</span><div class="bridge-track"><i class="${value < 0 ? 'negative-bar' : 'positive-bar'}" style="width:${Math.max(2, Math.abs(value) / maxComponent * 100)}%"></i></div><b class="${value < 0 ? 'negative' : 'positive'}">${won(value)}</b></div>`).join('');
    const contributors = holdings.map(item => ({ ...item, gain: item.value - item.cost })).sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain)).slice(0, 4);
    byId('dbContributors').innerHTML = '<h4>\uc190\uc775 \uae30\uc5ec \uc885\ubaa9</h4>' + contributors.map(item => `<div><span>${esc(item.name)}</span><b class="${item.gain < 0 ? 'negative' : 'positive'}">${won(item.gain)}</b></div>`).join('');

    byId('dbHoldingRows').innerHTML = holdings.slice(0, 8).map(item => {
      const weight = investmentValue ? item.value / investmentValue * 100 : 0;
      const rate = item.cost ? (item.value - item.cost) / item.cost * 100 : 0;
      return `<button type="button" class="dashboard-holding-row" data-market-asset="${encodeURIComponent(item.name)}"><span><b>${esc(item.name)}</b><small>${esc(item.currency || 'KRW')}</small></span><strong>${won(item.value)}</strong><span><i style="width:${Math.min(100, weight)}%"></i><small>${weight.toFixed(1)}%</small></span><b class="${rate < 0 ? 'negative' : 'positive'}">${rate.toFixed(1)}%</b></button>`;
    }).join('') || '<div class="dashboard-empty">\ubcf4\uc720\uc885\ubaa9\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</div>';

    const risks = new Map([['\uace0\uc704\ud5d8', 0], ['\uc911\uc704\ud5d8', 0], ['\uc800\uc704\ud5d8', 0], ['\uc548\uc804', 0]]);
    ledger.positions.forEach(position => risks.set(position.risk || '\ubbf8\ubd84\ub958', (risks.get(position.risk || '\ubbf8\ubd84\ub958') || 0) + position.value));
    dashboardDonut(byId('dbRiskDonut'), byId('dbRiskLegend'), [...risks.entries()], dashboardRiskColors);

    const alerts = [];
    if (concentration >= 25) alerts.push(['warn', '\uc9d1\uc911\ub3c4', `${largest.name} \ube44\uc911\uc774 ${concentration.toFixed(1)}%\uc785\ub2c8\ub2e4.`]);
    if (highRiskRate >= 50) alerts.push(['danger', '\uc704\ud5d8\ub3c4', `\uace0\uc704\ud5d8 \uc790\uc0b0\uc774 ${highRiskRate.toFixed(1)}%\uc785\ub2c8\ub2e4.`]);
    const priceRefresh = localStorage.getItem('wb-price-last-refresh');
    if (!priceRefresh || Date.now() - new Date(priceRefresh).getTime() > 24 * 60 * 60 * 1000) alerts.push(['info', '\ub370\uc774\ud130', '\uc2dc\uc138\u00b7\ud658\uc728 \uac31\uc2e0\uc774 \ud544\uc694\ud569\ub2c8\ub2e4.']);
    const nearMaturity = activeSafe.filter(item => item.maturity && new Date(item.maturity) >= new Date() && new Date(item.maturity) - new Date() <= 90 * 86400000);
    if (nearMaturity.length) alerts.push(['info', '\ub9cc\uae30', `90\uc77c \uc774\ub0b4 \ub9cc\uae30 \uc0c1\ud488 ${nearMaturity.length}\uac1c\uac00 \uc788\uc2b5\ub2c8\ub2e4.`]);
    if (!alerts.length) alerts.push(['ok', '\uc0c1\ud0dc', '\uc989\uc2dc \ud655\uc778\ud560 \uc8fc\uc694 \uc54c\ub9bc\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.']);
    byId('dbAlertCount').textContent = `${alerts.length}\uac74`;
    byId('dbAlerts').innerHTML = alerts.slice(0, 4).map(([type, title, description]) => `<div class="alert-${type}"><i></i><span><b>${title}</b><small>${esc(description)}</small></span></div>`).join('');

    const recent = [...transactions].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
    byId('dbRecentTransactions').innerHTML = recent.map(item => `<div><span><b>${esc(item.asset)}</b><small>${esc(item.date || '-')} \u00b7 ${esc(item.account || '-')}</small></span><div><b class="${item.type === '\ub9e4\ub3c4' ? 'negative' : item.type === '\ubc30\ub2f9' ? 'income-color' : 'positive'}">${esc(item.type)}</b><small>${won(transactionGrossKrw(item))}</small></div></div>`).join('') || '<div class="dashboard-empty">\uac70\ub798\ub0b4\uc5ed\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</div>';
    const maturities = [...activeSafe].sort((a, b) => (a.maturity || '9999-12-31').localeCompare(b.maturity || '9999-12-31')).slice(0, 5);
    byId('dbMaturities').innerHTML = maturities.map(item => `<div><span><b>${esc(item.name)}</b><small>${esc(item.bank || '-')}</small></span><div><b>${item.maturity ? esc(item.maturity) : '\ub9cc\uae30 \ubbf8\uc815'}</b><small>${won(item.current)}</small></div></div>`).join('') || '<div class="dashboard-empty">\uc6b4\uc6a9 \uc911\uc778 \uc608\u00b7\uc801\uae08\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</div>';

    const priceTime = localStorage.getItem('wb-price-last-refresh');
    byId('dbDataBasis').textContent = `${priceTime ? formatRefreshTime(priceTime) : '\uc2dc\uc138 \uac31\uc2e0 \uc804'} \u00b7 ${fxDates.length ? `\ud658\uc728 ${fxDates.at(-1)}` : '\ud658\uc728 \uac31\uc2e0 \uc804'}`;
  }

  const previousDashboardRenderer = renderDashboard;
  renderDashboard = function () {
    previousDashboardRenderer();
    renderDecisionDashboard();
  };
  byId('dbRefresh').onclick = () => refreshPlanPrices(true);
  byId('dbAddTransaction').onclick = () => byId('openTransaction').click();
  byId('dbTrendRange').onclick = event => {
    const button = event.target.closest('[data-months]');
    if (!button) return;
    dashboardTrendRange = button.dataset.months;
    localStorage.setItem('wb-dashboard-trend-range', dashboardTrendRange);
    renderDecisionDashboard();
  };
  dashboardWorkspace.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-dashboard-view]');
    if (viewButton) document.querySelector(`.tab[data-view="${CSS.escape(viewButton.dataset.dashboardView)}"]`)?.click();
    const holding = event.target.closest('[data-market-asset]');
    if (holding) window.openMarketDetail?.(decodeURIComponent(holding.dataset.marketAsset));
  });

  const tableToolStates = new Map();
  const tableCollator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });

  function tableCellPrimaryText(cell) {
    if (!cell) return '';
    const directText = [...cell.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (directText) return directText.textContent.trim();
    const primary = cell.querySelector(':scope > b, :scope > .tag, :scope > button > b, :scope > span');
    return (primary || cell).textContent.trim();
  }

  function tableComparable(text) {
    const value = String(text || '').trim();
    const isoDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (isoDate) return { type: 'number', value: Date.parse(isoDate) };
    const numberText = value.match(/-?\d[\d,]*(?:\.\d+)?/)?.[0];
    if (numberText && (/[%\u20a9$]/.test(value) || /^-?[\d,.]+(?:\uc8fc|\uac1c|\uac74|\ud68c)?$/.test(value))) {
      return { type: 'number', value: Number(numberText.replace(/,/g, '')) };
    }
    return { type: 'text', value: value.toLocaleLowerCase('ko-KR') };
  }

  function tableFilterMatches(cell, query) {
    const fullText = (cell?.textContent || '').trim();
    const primaryText = tableCellPrimaryText(cell);
    const normalizedQuery = query.trim();
    const comparison = normalizedQuery.match(/^(>=|<=|>|<|=)\s*(-?[\d,]+(?:\.\d+)?)/);
    if (comparison) {
      const current = tableComparable(primaryText);
      const target = Number(comparison[2].replace(/,/g, ''));
      if (current.type !== 'number' || !Number.isFinite(target)) return false;
      if (comparison[1] === '>=') return current.value >= target;
      if (comparison[1] === '<=') return current.value <= target;
      if (comparison[1] === '>') return current.value > target;
      if (comparison[1] === '<') return current.value < target;
      return current.value === target;
    }
    const range = normalizedQuery.split('~').map(value => value.trim());
    if (range.length === 2 && range[0] && range[1]) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(range[0]) && /^\d{4}-\d{2}-\d{2}$/.test(range[1])) {
        return primaryText.slice(0, 10) >= range[0] && primaryText.slice(0, 10) <= range[1];
      }
      const current = tableComparable(primaryText);
      const minimum = Number(range[0].replace(/,/g, ''));
      const maximum = Number(range[1].replace(/,/g, ''));
      if (current.type === 'number' && Number.isFinite(minimum) && Number.isFinite(maximum)) {
        return current.value >= minimum && current.value <= maximum;
      }
    }
    return fullText.toLocaleLowerCase('ko-KR').includes(normalizedQuery.toLocaleLowerCase('ko-KR'));
  }

  function applyTableTools(table) {
    if (!table?.tBodies[0]) return;
    if (table.dataset.tableToolMutating === '1') {
      table.dataset.tableToolPending = '1';
      return;
    }
    const tbody = table.tBodies[0];
    const state = tableToolStates.get(tbody.id);
    if (!state) return;
    const columnCount = table.tHead?.rows[0]?.cells.length || 0;
    const rows = [...tbody.rows].filter(row => row.cells.length === columnCount && !row.querySelector('.empty'));
    rows.forEach((row, index) => {
      if (!row.dataset.tableOrder) row.dataset.tableOrder = String(index);
      row.hidden = [...state.filters.entries()].some(([column, query]) => query && !tableFilterMatches(row.cells[column], query));
    });
    const sorted = [...rows].sort((left, right) => {
      if (state.column < 0 || !state.direction) return number(left.dataset.tableOrder) - number(right.dataset.tableOrder);
      const a = tableComparable(tableCellPrimaryText(left.cells[state.column]));
      const b = tableComparable(tableCellPrimaryText(right.cells[state.column]));
      const result = a.type === 'number' && b.type === 'number'
        ? a.value - b.value
        : tableCollator.compare(String(a.value), String(b.value));
      return (state.direction === 'asc' ? result : -result) || number(left.dataset.tableOrder) - number(right.dataset.tableOrder);
    });
    const orderChanged = sorted.some((row, index) => rows[index] !== row);
    if (orderChanged) {
      table.dataset.tableToolMutating = '1';
      sorted.forEach(row => tbody.appendChild(row));
      queueMicrotask(() => {
        delete table.dataset.tableToolMutating;
        if (table.dataset.tableToolPending === '1') {
          delete table.dataset.tableToolPending;
          applyTableTools(table);
        }
      });
    }
    [...table.tHead.rows[0].cells].forEach((header, index) => {
      header.classList.toggle('table-sort-active', index === state.column && !!state.direction);
      const indicator = header.querySelector('.table-sort-indicator');
      if (indicator) indicator.textContent = index === state.column ? (state.direction === 'asc' ? '\u25b2' : state.direction === 'desc' ? '\u25bc' : '') : '';
      header.setAttribute('aria-sort', index === state.column ? (state.direction === 'asc' ? 'ascending' : state.direction === 'desc' ? 'descending' : 'none') : 'none');
    });
  }

  function setupTableTools(tbody) {
    const table = tbody?.closest('table');
    const headerRow = table?.tHead?.rows[0];
    if (!table || !headerRow || !tbody.id) return;
    let state = tableToolStates.get(tbody.id);
    if (!state) {
      state = { column: -1, direction: '', filters: new Map() };
      tableToolStates.set(tbody.id, state);
    }
    table.classList.add('managed-table');
    table.dataset.tableBody = tbody.id;
    [...headerRow.cells].forEach((header, index) => {
      const label = header.dataset.columnLabel ?? header.textContent.trim();
      header.dataset.columnLabel = label;
      header.dataset.sortColumn = String(index);
      header.dataset.sortable = label ? 'true' : 'false';
      header.tabIndex = label ? 0 : -1;
      header.title = label ? '\ub354\ube14\ud074\ub9ad: \uc624\ub984\ucc28\uc21c \u2192 \ub0b4\ub9bc\ucc28\uc21c \u2192 \uc815\ub82c \ud574\uc81c' : '';
      if (!header.querySelector('.table-sort-indicator')) header.insertAdjacentHTML('beforeend', '<span class="table-sort-indicator" aria-hidden="true"></span>');
    });
    let filterRow = table.tHead.querySelector('[data-table-filter-row]');
    if (!filterRow || filterRow.cells.length !== headerRow.cells.length) {
      filterRow?.remove();
      filterRow = document.createElement('tr');
      filterRow.dataset.tableFilterRow = 'true';
      [...headerRow.cells].forEach((header, index, headers) => {
        const cell = document.createElement('td');
        const label = header.dataset.columnLabel || '';
        const isActionColumn = !label;
        cell.innerHTML = isActionColumn
          ? '<button type="button" class="table-filter-reset" title="\ud544\ud130\u00b7\uc815\ub82c \ucd08\uae30\ud654" aria-label="\ud544\ud130\u00b7\uc815\ub82c \ucd08\uae30\ud654">&#8634;</button>'
          : `<div class="table-filter-control"><input type="search" data-filter-column="${index}" value="${esc(state.filters.get(index) || '')}" placeholder="${esc(label)} \ud544\ud130" aria-label="${esc(label)} \ud544\ud130">${index === headers.length - 1 ? '<button type="button" class="table-filter-reset" title="\ud544\ud130\u00b7\uc815\ub82c \ucd08\uae30\ud654" aria-label="\ud544\ud130\u00b7\uc815\ub82c \ucd08\uae30\ud654">&#8634;</button>' : ''}</div>`;
        filterRow.appendChild(cell);
      });
      headerRow.after(filterRow);
      filterRow.addEventListener('input', event => {
        const input = event.target.closest('[data-filter-column]');
        if (!input) return;
        const column = number(input.dataset.filterColumn);
        if (input.value) state.filters.set(column, input.value);
        else state.filters.delete(column);
        applyTableTools(table);
      });
      filterRow.addEventListener('click', event => {
        if (!event.target.closest('.table-filter-reset')) return;
        state.column = -1;
        state.direction = '';
        state.filters.clear();
        filterRow.querySelectorAll('input').forEach(input => input.value = '');
        applyTableTools(table);
      });
    }
    applyTableTools(table);
    if (table.dataset.tableToolsReady !== '1') {
      table.dataset.tableToolsReady = '1';
      headerRow.addEventListener('dblclick', event => {
        const header = event.target.closest('th[data-sort-column]');
        if (!header || header.dataset.sortable !== 'true') return;
        event.preventDefault();
        const column = number(header.dataset.sortColumn);
        if (state.column !== column || !state.direction) {
          state.column = column;
          state.direction = 'asc';
        } else if (state.direction === 'asc') {
          state.direction = 'desc';
        } else {
          state.column = -1;
          state.direction = '';
        }
        applyTableTools(table);
      });
      headerRow.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });
      new MutationObserver(() => setupTableTools(tbody)).observe(tbody, { childList: true });
    }
  }

  ['assetRows', 'safeRows', 'transactionRows', 'planRows', 'performanceRows', 'dividendRows', 'accountRows', 'masterRows']
    .forEach(id => setupTableTools(byId(id)));

  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab,.view').forEach(item => item.classList.remove('active'));
      tab.classList.add('active');
      byId(tab.dataset.view).classList.add('active');
      if (tab.dataset.view === 'performance') {
        renderPerformance();
        if (!automaticDividendLookupStarted) {
          automaticDividendLookupStarted = true;
          const needsResearch = localStorage.getItem('wb-dividend-schedule-research-version') !== '2026-08-05-v2';
          setTimeout(() => refreshDividendSchedules(needsResearch, needsResearch), 80);
        }
      }
      if (tab.dataset.view === 'goals') {
        scheduleAdvancedPlan();
        refreshPlanPrices(false);
      }
      if (tab.dataset.view === 'settings') updateDataManagementStats();
      const tabs = tab.parentElement;
      tabs.scrollLeft = Math.max(0, tab.offsetLeft - (tabs.clientWidth - tab.offsetWidth) / 2);
      const url = new URL(location.href);
      url.searchParams.set('view', tab.dataset.view);
      history.replaceState(null, '', url);
    };
  });

  const previousRender = window.render;
  window.render = function () {
    syncAssetsFromLedger();
    previousRender();
    renderAccounts();
    renderPerformance();
    scheduleAdvancedPlan();
  };

  renderAccounts();
  syncAssetsFromLedger();
  window.render();
  refreshExchangeRates(false).then(() => {
    syncAssetsFromLedger();
    window.render();
    updateVisibleMasterPrices(securityMasters());
    scheduleAdvancedPlan();
  });
  const requestedView = new URLSearchParams(location.search).get('view');
  const requestedTab = requestedView && document.querySelector(`.tab[data-view="${CSS.escape(requestedView)}"]`);
  if (requestedTab) requestedTab.click();
  if (new URLSearchParams(location.search).get('action') === 'new-transaction') {
    byId('openTransaction').click();
  }
  if (new URLSearchParams(location.search).get('action') === 'new-dividend') {
    byId('openDividend').click();
  }
  if (requestedView === 'goals') refreshPlanPrices(false);
})();
