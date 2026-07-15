const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let now = 0;
let intervalCallback = null;
const storage = {};
const listeners = {};
const createdMenus = [];
const iconCalls = [];
const titleCalls = [];

class MockContext {
  clearRect() {}
  fillRect() {}
  getImageData(x, y, width, height) {
    return { x, y, width, height };
  }
}

class MockOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return new MockContext();
  }
}

function event(name) {
  return {
    addListener(callback) {
      listeners[name] = callback;
    },
  };
}

const chrome = {
  storage: {
    local: {
      async get(keys) {
        const result = {};
        for (const key of keys) result[key] = storage[key];
        return result;
      },
      async set(values) {
        Object.assign(storage, values);
      },
    },
  },
  alarms: {
    create() {},
    clear() {},
    onAlarm: event("alarm"),
  },
  action: {
    async setIcon(payload) {
      iconCalls.push(payload);
    },
    async setTitle(payload) {
      titleCalls.push(payload.title);
    },
    onClicked: event("actionClick"),
  },
  contextMenus: {
    removeAll(callback) {
      createdMenus.length = 0;
      callback();
    },
    create(payload) {
      createdMenus.push(payload);
    },
    onClicked: event("menuClick"),
  },
  runtime: {
    onInstalled: event("installed"),
    onStartup: event("startup"),
  },
};

const sandbox = {
  chrome,
  console,
  Date: { now: () => now },
  OffscreenCanvas: MockOffscreenCanvas,
  Promise,
  Math,
  Number,
  Object,
  String,
  setInterval(callback) {
    intervalCallback = callback;
    return 1;
  },
  clearInterval() {
    intervalCallback = null;
  },
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("background.js", "utf8"), sandbox);

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  await flush();
  assert.match(titleCalls.at(-1), /^00:00:00\.0/);

  listeners.installed();
  await flush();
  assert.deepEqual(
    createdMenus.filter((item) => item.type === "radio").map((item) => item.title),
    ["Dark", "Light"],
  );

  listeners.actionClick();
  await flush();
  assert.equal(titleCalls.at(-1), "");
  const runningTitleCount = titleCalls.length;

  now = 3_723_650;
  intervalCallback();
  await flush();
  assert.equal(titleCalls.length, runningTitleCount);

  now = 3_724_050;
  intervalCallback();
  await flush();
  assert.equal(titleCalls.length, runningTitleCount);
  assert.equal(storage.stopwatchState.running, true);

  listeners.menuClick({ menuItemId: "theme-light" });
  await flush();
  assert.equal(storage.theme, "light");
  assert.equal(titleCalls.at(-1), "");
  assert.ok(iconCalls.length > 0);

  now = 3_724_150;
  listeners.actionClick();
  await flush();
  assert.equal(storage.stopwatchState.running, false);
  assert.equal(storage.stopwatchState.elapsedMs, 3_724_150);
  assert.match(titleCalls.at(-1), /^01:02:04\.1 — Tiny Stopwatch — stopped/);

  listeners.menuClick({ menuItemId: "reset-stopwatch" });
  await flush();
  assert.equal(storage.stopwatchState.elapsedMs, 0);
  assert.match(titleCalls.at(-1), /^00:00:00\.0/);

  console.log("smoke test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
