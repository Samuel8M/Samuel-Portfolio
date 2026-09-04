// Wires the ported timer/blocklist/readingTime logic (js/timer.js,
// js/blocklist.js, js/readingTime.js) up to this page's DOM. In the real
// extension this glue lives in background.js (timer + blocklist, driven by
// chrome.alarms) and content.js (reading time, driven by a DOM read on page
// load). Here everything runs in one page on a plain setInterval, but the
// state machine and matching/estimation math underneath are unchanged.

(function () {
  'use strict';

  const { FGTimer, FGBlocklist, FGReadingTime } = window;

  /* ---------------------------------------------------------------- */
  /* Pomodoro timer                                                    */
  /* ---------------------------------------------------------------- */

  const clockEl = document.getElementById('clock');
  const phaseLabelEl = document.getElementById('phaseLabel');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');

  let timerState = FGTimer.createInitialTimerState();

  function renderTimer() {
    const remaining = FGTimer.getRemainingSeconds(timerState);
    clockEl.textContent = FGTimer.formatClock(remaining);
    phaseLabelEl.textContent = timerState.phase === 'focus' ? 'Focus' : 'Break';
    phaseLabelEl.dataset.phase = timerState.phase;
    startBtn.hidden = timerState.isRunning;
    pauseBtn.hidden = !timerState.isRunning;
  }

  function tick() {
    if (FGTimer.isPhaseComplete(timerState)) {
      timerState = FGTimer.advancePhase(timerState);
    }
    renderTimer();
  }

  startBtn.addEventListener('click', () => {
    timerState = FGTimer.startTimer(timerState);
    renderTimer();
  });

  pauseBtn.addEventListener('click', () => {
    timerState = FGTimer.pauseTimer(timerState);
    renderTimer();
  });

  resetBtn.addEventListener('click', () => {
    timerState = FGTimer.resetTimer(timerState);
    renderTimer();
  });

  renderTimer();
  setInterval(tick, 1000);

  /* ---------------------------------------------------------------- */
  /* Site blocklist                                                    */
  /* ---------------------------------------------------------------- */

  const addDomainInput = document.getElementById('addDomainInput');
  const addDomainBtn = document.getElementById('addDomainBtn');
  const addDomainError = document.getElementById('addDomainError');
  const blocklistItemsEl = document.getElementById('blocklistItems');
  const testUrlInput = document.getElementById('testUrlInput');
  const testUrlBtn = document.getElementById('testUrlBtn');
  const testResultEl = document.getElementById('testResult');

  // Seed with a couple of example entries so the panel isn't empty on load.
  // FGBlocklist.parseBlocklistText is the exact textarea-parsing function
  // from the extension's options/popup save flow.
  let domains = FGBlocklist.parseBlocklistText('reddit.com\nyoutube.com');

  function renderBlocklist() {
    blocklistItemsEl.innerHTML = '';
    if (domains.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'blocklist-empty';
      empty.textContent = 'No sites blocked yet.';
      blocklistItemsEl.appendChild(empty);
      return;
    }
    for (const domain of domains) {
      const li = document.createElement('li');
      li.className = 'blocklist-item';

      const span = document.createElement('span');
      span.className = 'blocklist-domain';
      span.textContent = domain;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.setAttribute('aria-label', `Remove ${domain}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        domains = domains.filter((d) => d !== domain);
        renderBlocklist();
        renderTestResult();
      });

      li.appendChild(span);
      li.appendChild(removeBtn);
      blocklistItemsEl.appendChild(li);
    }
  }

  function addDomainFromInput() {
    const raw = addDomainInput.value;
    const domain = FGBlocklist.normalizeDomain(raw);
    addDomainError.textContent = '';
    if (!raw.trim()) return;
    if (!domain) {
      addDomainError.textContent = `"${raw.trim()}" doesn't look like a valid domain.`;
      return;
    }
    if (!domains.includes(domain)) {
      domains.push(domain);
      renderBlocklist();
      renderTestResult();
    }
    addDomainInput.value = '';
    addDomainInput.focus();
  }

  addDomainBtn.addEventListener('click', addDomainFromInput);
  addDomainInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDomainFromInput();
    }
  });

  function renderTestResult() {
    const raw = testUrlInput.value;
    if (!raw.trim()) {
      testResultEl.textContent = '';
      testResultEl.className = 'test-result';
      return;
    }
    const hostname = FGBlocklist.extractHostname(raw);
    if (!hostname) {
      testResultEl.textContent = 'Enter a URL or hostname to test.';
      testResultEl.className = 'test-result';
      return;
    }
    const blocked = FGBlocklist.hostnameMatchesBlocklist(hostname, domains);
    if (blocked) {
      testResultEl.textContent = `⛔ Blocked — "${hostname}" matches your blocklist.`;
      testResultEl.className = 'test-result blocked';
    } else {
      testResultEl.textContent = `✓ Allowed — "${hostname}" is not on your blocklist.`;
      testResultEl.className = 'test-result allowed';
    }
  }

  testUrlBtn.addEventListener('click', renderTestResult);
  testUrlInput.addEventListener('input', renderTestResult);
  testUrlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });

  renderBlocklist();

  /* ---------------------------------------------------------------- */
  /* Reading-time estimator                                            */
  /* ---------------------------------------------------------------- */

  const readingInput = document.getElementById('readingInput');
  const wordCountEl = document.getElementById('wordCount');
  const readingTimeEl = document.getElementById('readingTime');

  function renderReadingTime() {
    const text = readingInput.value;
    const { words, minutes } = FGReadingTime.estimateReadingMinutes(text);
    wordCountEl.textContent = `${words} word${words === 1 ? '' : 's'}`;
    if (FGReadingTime.shouldShowBadge(words)) {
      readingTimeEl.textContent = FGReadingTime.formatReadingTimeLabel(minutes);
      readingTimeEl.hidden = false;
    } else {
      readingTimeEl.textContent = `Badge appears at ${FGReadingTime.MIN_WORDS_FOR_ESTIMATE}+ words`;
      readingTimeEl.hidden = false;
    }
  }

  readingInput.addEventListener('input', renderReadingTime);
  renderReadingTime();
})();
