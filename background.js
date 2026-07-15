const STORAGE_KEY = "stopwatchState";
const THEME_KEY = "theme";
const RESET_MENU_ID = "reset-stopwatch";
const THEME_MENU_ID = "theme";
const THEME_DARK_MENU_ID = "theme-dark";
const THEME_LIGHT_MENU_ID = "theme-light";
const HEARTBEAT_ALARM = "stopwatch-heartbeat";
const DEFAULT_THEME = "dark";

const DEFAULT_STATE = Object.freeze({
  running: false,
  elapsedMs: 0,
  startedAt: null,
});

const THEMES = Object.freeze({
  dark: Object.freeze({
    background: "#111318",
    running: "#7CFF9B",
    stopped: "#AEB4BF",
  }),
  light: Object.freeze({
    background: "#F3F4F6",
    running: "#087A3E",
    stopped: "#3E4652",
  }),
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
let theme = DEFAULT_THEME;
let initializePromise = null;
let tickerId = null;
let lastIconKey = "";
let lastTitleKey = "";
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
      ? value.elapsedMs
      : 0;
  const startedAt =
    running && Number.isFinite(value.startedAt) ? value.startedAt : null;

  if (running && startedAt === null) {
    return { ...DEFAULT_STATE };
  }

  return { running, elapsedMs, startedAt };
}

function normalizeTheme(value) {
  return Object.hasOwn(THEMES, value) ? value : DEFAULT_THEME;
}

async function ensureInitialized() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const stored = await chrome.storage.local.get([STORAGE_KEY, THEME_KEY]);
      state = normalizeState(stored[STORAGE_KEY]);
      theme = normalizeTheme(stored[THEME_KEY]);

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
    return state.elapsedMs;
  }

  return state.elapsedMs + Math.max(0, now - state.startedAt);
}

function iconTime(elapsedMs) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  return {
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
  };
}

function detailedTimeParts(elapsedMs) {
  const totalTenths = Math.floor(elapsedMs / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return {
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
    tenths,
  };
}

function formatHoverTime(elapsedMs, running) {
  const parts = detailedTimeParts(elapsedMs);
  const wholeSeconds = `${parts.hours}:${parts.minutes}:${parts.seconds}`;
  return running ? wholeSeconds : `${wholeSeconds}.${parts.tenths}`;
}

async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function saveTheme() {
  await chrome.storage.local.set({ [THEME_KEY]: theme });
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
  }, 100);
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

async function setTheme(nextTheme) {
  await ensureInitialized();

  const normalizedTheme = normalizeTheme(nextTheme);
  if (theme === normalizedTheme) {
    return;
  }

  theme = normalizedTheme;
  await saveTheme();
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

function makeIcon(
  size,
  minutes,
  seconds,
  running,
  indicatorVisible,
  palette,
) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");

  context.clearRect(0, 0, size, size);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, size, size);

  const scale = size >= 32 ? Math.max(2, Math.floor(size / 16)) : 1;
  const digitsWidth = 7 * scale;
  const rowHeight = 5 * scale;
  const gap = Math.max(scale, Math.floor(size / 16) * scale);
  const blockHeight = rowHeight * 2 + gap;
  const startX = Math.floor((size - digitsWidth) / 2);
  const startY = Math.floor((size - blockHeight) / 2);

  context.fillStyle = running ? palette.running : palette.stopped;
  drawTwoDigits(context, minutes, startX, startY, scale);
  drawTwoDigits(context, seconds, startX, startY + rowHeight + gap, scale);

  if (indicatorVisible) {
    const indicatorSize = Math.max(1, Math.floor(size / 16));
    context.fillRect(
      size - indicatorSize * 2,
      size - indicatorSize * 2,
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

  const now = Date.now();
  const elapsedMs = currentElapsedMs(now);
  const { minutes, seconds } = iconTime(elapsedMs);
  const hoverTime = formatHoverTime(elapsedMs, state.running);
  const indicatorVisible =
    state.running && Math.floor(elapsedMs / 500) % 2 === 0;
  const iconKey = `${theme}:${state.running}:${minutes}:${seconds}:${indicatorVisible}`;
  const titleKey = `${state.running}:${hoverTime}`;
  const tasks = [];

  if (force || iconKey !== lastIconKey) {
    lastIconKey = iconKey;
    const palette = THEMES[theme];
    tasks.push(
      chrome.action.setIcon({
        imageData: {
          16: makeIcon(
            16,
            minutes,
            seconds,
            state.running,
            indicatorVisible,
            palette,
          ),
          32: makeIcon(
            32,
            minutes,
            seconds,
            state.running,
            indicatorVisible,
            palette,
          ),
        },
      }),
    );
  }

  if (force || titleKey !== lastTitleKey) {
    lastTitleKey = titleKey;
    tasks.push(
      chrome.action.setTitle({
        title: `${hoverTime} — Tiny Stopwatch — ${
          state.running ? "running; click to stop" : "stopped; click to start"
        }`,
      }),
    );
  }

  await Promise.all(tasks);
}

function installContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: RESET_MENU_ID,
      title: "Reset to 00:00",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: "menu-separator",
      type: "separator",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: THEME_MENU_ID,
      title: "Theme",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: THEME_DARK_MENU_ID,
      parentId: THEME_MENU_ID,
      type: "radio",
      title: "Dark",
      checked: theme === "dark",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: THEME_LIGHT_MENU_ID,
      parentId: THEME_MENU_ID,
      type: "radio",
      title: "Light",
      checked: theme === "light",
      contexts: ["action"],
    });
  });
}

function initializeAndInstallMenu() {
  void enqueue(async () => {
    await ensureInitialized();
    installContextMenu();
  }).catch((error) => {
    console.error("Tiny Stopwatch failed to install its menu.", error);
  });
}

chrome.runtime.onInstalled.addListener(initializeAndInstallMenu);
chrome.runtime.onStartup.addListener(initializeAndInstallMenu);

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
    return;
  }

  if (info.menuItemId === THEME_DARK_MENU_ID) {
    void enqueue(() => setTheme("dark")).catch((error) => {
      console.error("Tiny Stopwatch failed to select the dark theme.", error);
    });
    return;
  }

  if (info.menuItemId === THEME_LIGHT_MENU_ID) {
    void enqueue(() => setTheme("light")).catch((error) => {
      console.error("Tiny Stopwatch failed to select the light theme.", error);
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
