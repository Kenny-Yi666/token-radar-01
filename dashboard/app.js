// Token Radar's dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan, and a model sandbox that re-ranks the board live. No
// network: every byte it shows is in data.js. The farm plan is the same derivation main.ts writes
// to board.json, so the page and the board always agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', candidacy: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = { growth_weight: null, maturity_peak_days: null, chain_weight: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the page recomputes a row from the snapshot figures and the sandbox
  // constants, so the page's code and the board's data are visibly the same arithmetic. Category
  // multiple is the stored median of the row's live comps; the sandbox moves growth, maturity and
  // chain breadth only.
  function modelNow() {
    var m = DATA.model;
    return {
      growth_weight: sandbox.growth_weight === null ? m.growth_weight : sandbox.growth_weight,
      growth_floor: m.growth_floor, growth_cap: m.growth_cap,
      maturity_base: m.maturity_base,
      maturity_peak_days: sandbox.maturity_peak_days === null ? m.maturity_peak_days : sandbox.maturity_peak_days,
      maturity_decay: m.maturity_decay,
      unknown_age_days: m.unknown_age_days,
      chain_weight: sandbox.chain_weight === null ? m.chain_weight : sandbox.chain_weight,
      chain_cap: m.chain_cap
    };
  }
  function maturityOf(age, m) {
    var a = age === null || age === undefined ? m.unknown_age_days : age;
    if (a <= m.maturity_peak_days) return m.maturity_base + (1 - m.maturity_base) * (a / m.maturity_peak_days);
    return 1 - m.maturity_decay * (Math.min(a - m.maturity_peak_days, 1095) / 1095);
  }
  function impliedOf(row, m) {
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var maturity = maturityOf(row.age_days, m);
    var chainMult = Math.min(m.chain_cap, 1 + m.chain_weight * Math.log(Math.max(1, (row.chains || []).length)));
    return { implied: Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * chainMult)), growthMult: growthMult, maturity: maturity, chainMult: chainMult };
  }
  function sandboxActive() {
    return sandbox.growth_weight !== null || sandbox.maturity_peak_days !== null || sandbox.chain_weight !== null;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan: the same derivation main.ts writes to board.json. Category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasUsd(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return 12;
    if (c === 'bitcoin') return 2;
    if (c === 'solana') return 0.05;
    if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'blast' || c === 'linea' || c === 'scroll' || c === 'zksync' || c === 'mode') return 0.4;
    if (c === 'polygon' || c === 'bsc' || c === 'binance' || c === 'avalanche' || c === 'fantom' || c === 'celo') return 0.3;
    if (c === 'monad' || c === 'berachain' || c === 'sonic' || c === 'sui' || c === 'aptos') return 0.1;
    return 1;
  }
  function gasText(chain) {
    var g = gasUsd(chain);
    return g < 1 ? 'about ' + Math.round(g * 100) + ' cents of gas' : 'about $' + g + ' of gas';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('basis') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('farm') >= 0 || c.indexOf('aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s vault on " + chain + ' and keep the shares.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + small + ' against the deposit on ' + name + ' and repay it the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Swap $' + small + ' through ' + name + "'s router on " + chain + ' once a week.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back through ' + name + ' so the record shows two-way use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim the staking rewards ' + name + ' shows, even a small amount, and restake them.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Close the hedge on ' + name + ' and open a fresh one, so the record shows repeated use.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market on ' + name + ' and place a second, smaller position.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Vote on one vault proposal or rebalance the deposit inside ' + name + '.';
    return 'Do one more on-chain action inside ' + name + ' on ' + chain + ', such as a swap, a vote or a claim.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasText(chain);
    var small = Math.max(10, Math.round(capital / 5));
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas + ' for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: '$' + small + ' of capital and ' + gas, time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, then unwind in the reverse order you entered so nothing is left locked.', cost: 'nothing but the log', time: '5 minutes to log, 15 minutes to unwind' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('candidacy')) state.candidacy = params.get('candidacy');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.candidacy !== 'all') params.set('candidacy', state.candidacy);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.candidacy !== 'all' && r.candidacy !== state.candidacy) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var m = modelNow();
    var active = sandboxActive();
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = active ? impliedOf(a, m).implied : a.implied_value_usd; bv = active ? impliedOf(b, m).implied : b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, el('b', { text: DATA.model_version }), ' model')
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor, ', el('b', { text: String(DATA.candidate_size) }),
          ' of the board genuine launch candidates. Implied value is a model, not a promise — the top row, ',
          el('b', { text: top ? top.name : '' }), ', is valued at ', el('b', { text: top ? fmtUsd(top.implied_value_usd) : '' }), '.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Launch candidates' }), el('b', { text: String(DATA.candidate_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function topTen() {
    var list = DATA.rows.slice(0, 10);
    var max = list[0] ? list[0].implied_value_usd : 1;
    var box = el('section', { class: 'panel topten' },
      el('h2', null, 'Top 10 by implied value ', el('span', { text: '— select any row for its model and farm plan' }))
    );
    list.forEach(function (r) {
      box.appendChild(el('div', { class: 'toprow', tabindex: '0', role: 'button', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('span', { class: 'toprank', text: String(r.rank) }),
        el('span', { class: 'topname', text: r.name }, el('span', { text: (r.category || 'Other') + ' · ' + fmtAge(r.age_days) })),
        el('span', { class: 'topbar' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'topval', text: fmtUsd(r.implied_value_usd) })
        )
      ));
    });
    return box;
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var candAll = el('button', { type: 'button', 'aria-pressed': state.candidacy === 'all' ? 'true' : 'false', text: 'All rows', onclick: function () { state.candidacy = 'all'; writeHash(); render(); } });
    var candYes = el('button', { type: 'button', 'aria-pressed': state.candidacy === 'candidate' ? 'true' : 'false', text: 'Launch candidates', onclick: function () { state.candidacy = 'candidate'; writeHash(); render(); } });
    var candWatch = el('button', { type: 'button', 'aria-pressed': state.candidacy === 'watch' ? 'true' : 'false', text: 'Watch', onclick: function () { state.candidacy = 'watch'; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Candidacy' }), el('div', { class: 'tabs' }, candAll, candYes, candWatch)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var m = modelNow();
    var active = sandboxActive();
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.candidacy = 'all'; writeHash(); render(); } })
      ));
    }
    var max = (active ? impliedOf(list[0], m).implied : list[0].implied_value_usd) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var shown = active ? impliedOf(r, m).implied : r.implied_value_usd;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((shown / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(shown) })
        )),
        el('td', { class: 'num', text: 'x' + r.category_multiple.toFixed(2) }),
        el('td', null, el('span', { class: 'chip ' + r.candidacy, text: r.candidacy === 'candidate' ? 'candidate' : 'watch' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: active ? 'Pre-token protocols, re-ranked by the sandbox model. Select a row for its model and farm plan.' : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'Chains' }),
            sortHeader('implied', 'Implied value'),
            sortHeader('multiple', 'Category x'),
            el('th', { scope: 'col', text: 'Candidacy' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'chip candidate', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap-per-TVL is what prices each pre-token category.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var gw = el('input', { type: 'range', min: '0', max: '1.2', step: '0.05', value: String(sandbox.growth_weight === null ? m.growth_weight : sandbox.growth_weight), 'aria-label': 'Growth weight' });
    var gwOut = el('b', { text: String(sandbox.growth_weight === null ? m.growth_weight : sandbox.growth_weight) });
    gw.addEventListener('input', function () { sandbox.growth_weight = parseFloat(gw.value); gwOut.textContent = gw.value; render(); });
    var mp = el('input', { type: 'range', min: '180', max: '1460', step: '10', value: String(sandbox.maturity_peak_days === null ? m.maturity_peak_days : sandbox.maturity_peak_days), 'aria-label': 'Maturity peak in days' });
    var mpOut = el('b', { text: String(sandbox.maturity_peak_days === null ? m.maturity_peak_days : sandbox.maturity_peak_days) + 'd' });
    mp.addEventListener('input', function () { sandbox.maturity_peak_days = parseInt(mp.value, 10); mpOut.textContent = mp.value + 'd'; render(); });
    var cw = el('input', { type: 'range', min: '0', max: '0.15', step: '0.01', value: String(sandbox.chain_weight === null ? m.chain_weight : sandbox.chain_weight), 'aria-label': 'Chain breadth weight' });
    var cwOut = el('b', { text: String(sandbox.chain_weight === null ? m.chain_weight : sandbox.chain_weight) });
    cw.addEventListener('input', function () { sandbox.chain_weight = parseFloat(cw.value); cwOut.textContent = cw.value; render(); });
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset the sandbox', onclick: function () { sandbox.growth_weight = null; sandbox.maturity_peak_days = null; sandbox.chain_weight = null; render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x categoryMultiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x maturity(age) x min(' + m.chain_cap + ', 1 + ' + m.chain_weight + ' x ln(chains)) )'
      ),
      el('p', { class: 'sub', text: 'Category multiple: the median market-cap-per-TVL of the live-token protocols in the same category (at least ' + m.category_min_comps + ' of them, else the whole snapshot median), clamped to [' + m.category_multiple_floor + ', ' + m.category_multiple_cap + ']. Maturity rises from ' + m.maturity_base + ' to 1.00 over ' + m.maturity_peak_days + ' days, then eases back to ' + m.maturity_late_floor + ' by day 1825; an unknown age counts as ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      el('div', { class: 'sandbox' },
        el('div', { class: 'slider' }, el('label', null, 'Growth weight ', gwOut), gw),
        el('div', { class: 'slider' }, el('label', null, 'Maturity peak ', mpOut), mp),
        el('div', { class: 'slider' }, el('label', null, 'Chain breadth weight ', cwOut), cw),
        el('p', { class: 'sandbox-note', text: 'Move a slider and the board re-ranks on the same figures: the sandbox changes the weights, never the data. ' }, reset)
      )
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Source: ' + DATA.source + '. Implied value is this dashboard\u2019s model, never a price and never a promise of a token launch.' }),
      el('p', { text: 'A protocol records no token when its DefiLlama record carries none; that is not proof it has none. Farm plans are a starting point: check the protocol\u2019s own pages before moving funds.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var m = modelNow();
    var calc = impliedOf(row, m);
    var capital = capitalFor(row);
    var gas = gasUsd(chainOf(row));
    var txCount = 6;
    var note = row.candidacy === 'candidate'
      ? el('p', { class: 'note teal', text: 'Launch candidate: it records no token and passes the watchlist\u2019s own exclusion — no bridge, staking or wrapped product, no version marker, not named for an exchange.' })
      : el('p', { class: 'note', text: 'Watch: it records no token, but its category is a bridged, staked or wrapped product of a token that already trades, so a token of its own is less likely. It is still farmable, and still ranked.' });
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(note);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ', ' + (row.category_comps >= DATA.model.category_min_comps ? row.category_comps + ' live comps' : row.category_comps + (row.category_comps === 1 ? ' live comp' : ' live comps') + ' — below the ' + DATA.model.category_min_comps + '-comp floor, so the whole-snapshot median') + ')' }), el('b', { class: 'num', text: 'x' + row.category_multiple.toFixed(2) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(calc.growthMult.toFixed(2)) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(calc.maturity.toFixed(2)) })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: 'x' + calc.chainMult.toFixed(2) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(calc.implied) + (calc.implied === row.implied_value_usd ? ', the same number board.json carries.' : ' under the sandbox weights; the board carries ' + fmtUsd(row.implied_value_usd) + '.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('div', { class: 'plan-total' },
        el('span', null, 'Capital ', el('b', { text: '$' + capital })),
        el('span', null, 'Gas, about ', el('b', { text: gas < 1 ? Math.round(gas * 100) + 'c x ' + txCount : '$' + (gas * txCount).toFixed(0) })),
        el('span', null, 'Time ', el('b', { text: 'about 1 hour plus a ' + holdDaysFor(row.age_days) + '-day hold' }))
      )
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(topTen());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
