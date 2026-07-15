const STORAGE_KEY = "stopwatchState";
const RESET_MENU_ID = "reset-stopwatch";
const HEARTBEAT_ALARM = "stopwatch-heartbeat";
const HOUR_MS = 60 * 60 * 1000;

const DEFAULT_STATE = Object.freeze({
  running: false,
  elapsedMs: 0,
  startedAt: null,
});

const DIGITS = Object.freeze({
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
});

let state = null;
let initializePromise = null;
let tickerId = null;
let lastRenderedKey = "";
let operationQueue = Promise.resolve();

function enqueue(operation) {
  operationQueue = operationQueue.then(operation, operation);
  return operationQueue;
}

function normalizeState(value) {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_STATE };
  }

  const running = value.running === true;
  const elapsedMs =
    Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0
      ? value.elapsedMs % HOUR_MS
      : 0;
  const startedAt =
    running && Number.isFinite(value.startedAt) ? value.startedAt : null;

  if (running && startedAt === null) {
    return { ...DEFAULT_STATE };
  }

  return { running, elapsedMs, startedAt };
}

async function ensureInitialized() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      state = normalizeState(stored[STORAGE_KEY]);

      if (state.running) {
        ensureHeartbeat();
        startTicker();
      }

      await render(true);
    })().catch((error) => {
      initializePromise = null;
      console.error("Tiny Stopwatch failed to initialize.", error);
      throw error;
    });
  }

  return initializePromise;
}

function currentElapsedMs(now = Date.now()) {
  if (!state.running) {
    return state.elapsedMs % HOUR_MS;
  }

  return (state.elapsedMs + Math.max(0, now - state.startedAt)) % HOUR_MS;
}

function displayedSeconds(now = Date.now()) {
  return Math.floor(currentElapsedMs(now) / 1000) % 3600;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function ensureHeartbeat() {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
}

function clearHeartbeat() {
  chrome.alarms.clear(HEARTBEAT_ALARM);
}

function startTicker() {
  if (tickerId !== null) {
    return;
  }

  tickerId = setInterval(() => {
    void render();
  }, 250);
}

function stopTicker() {
  if (tickerId === null) {
    return;
  }

  clearInterval(tickerId);
  tickerId = null;
}

async function toggle() {
  await ensureInitialized();

  if (state.running) {
    state = {
      running: false,
      elapsedMs: currentElapsedMs(),
      startedAt: null,
    };
    stopTicker();
    clearHeartbeat();
  } else {
    state = {
      running: true,
      elapsedMs: state.elapsedMs,
      startedAt: Date.now(),
    };
    ensureHeartbeat();
    startTicker();
  }

  await saveState();
  await render(true);
}

async function reset() {
  await ensureInitialized();

  state = { ...DEFAULT_STATE };
  stopTicker();
  clearHeartbeat();

  await saveState();
  await render(true);
}

function drawDigit(context, digit, x, y, scale) {
  const pattern = DIGITS[digit];

  for (let row = 0; row < pattern.length; row += 1) {
    for (let column = 0; column < pattern[row].length; column += 1) {
      if (pattern[row][column] === "1") {
        context.fillRect(
          x + column * scale,
          y + row * scale,
          scale,
          scale,
        );
      }
    }
  }
}

function drawTwoDigits(context, value, x, y, scale) {
  const [first, second] = String(value).padStart(2, "0");
  drawDigit(context, first, x, y, scale);
  drawDigit(context, second, x + 4 * scale, y, scale);
}

function makeIcon(size, minutes, seconds, running) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");

  context.clearRect(0, 0, size, size);
  context.fillStyle = "#111318";
  context.fillRect(0, 0, size, size);

  const scale = size >= 32 ? Math.max(2, Math.floor(size / 16)) : 1;
  const digitsWidth = 7 * scale;
  const rowHeight = 5 * scale;
  const gap = Math.max(scale, Math.floor(size / 16) * scale);
  const blockHeight = rowHeight * 2 + gap;
  const startX = Math.floor((size - digitsWidth) / 2);
  const startY = Math.floor((size - blockHeight) / 2);

  context.fillStyle = running ? "#7CFF9B" : "#AEB4BF";
  drawTwoDigits(context, minutes, startX, startY, scale);
  drawTwoDigits(context, seconds, startX, startY + rowHeight + gap, scale);

  if (running) {
    const indicatorSize = Math.max(1, Math.floor(size / 16));
    context.fillRect(
      size - indicatorSize * 2,
      indicatorSize,
      indicatorSize,
      indicatorSize,
    );
  }

  return context.getImageData(0, 0, size, size);
}

async function render(force = false) {
  if (!state) {
    return;
  }

  const totalSeconds = displayedSeconds();
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const renderKey = `${state.running}:${totalSeconds}`;

  if (!force && renderKey === lastRenderedKey) {
    return;
  }

  lastRenderedKey = renderKey;

  await Promise.all([
    chrome.action.setIcon({
      imageData: {
        16: makeIcon(16, minutes, seconds, state.running),
        32: makeIcon(32, minutes, seconds, state.running),
      },
    }),
    chrome.action.setTitle({
      title: `Tiny Stopwatch — ${formatTime(totalSeconds)} — ${
        state.running ? "running; click to stop" : "stopped; click to start"
      }`,
    }),
  ]);
}

function installContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: RESET_MENU_ID,
      title: "Reset to 00:00",
      contexts: ["action"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  installContextMenu();
  void ensureInitialized();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureInitialized();
});

chrome.action.onClicked.addListener(() => {
  void enqueue(toggle).catch((error) => {
    console.error("Tiny Stopwatch failed to toggle.", error);
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === RESET_MENU_ID) {
    void enqueue(reset).catch((error) => {
      console.error("Tiny Stopwatch failed to reset.", error);
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) {
    return;
  }

  void ensureInitialized()
    .then(() => {
      if (state.running) {
        startTicker();
        return render(true);
      }

      clearHeartbeat();
      return undefined;
    })
    .catch((error) => {
      console.error("Tiny Stopwatch heartbeat failed.", error);
    });
});

void ensureInitialized();
