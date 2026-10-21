'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../game');

/** Enumerates the full import directory because the IDE compiles scripts beyond the entry dependency graph. */
function scripts(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? scripts(filename) : filename.endsWith('.js') ? [filename] : [];
  });
}

test('the complete native import directory has no Node or browser dependencies', () => {
  for (const filename of scripts(root)) {
    const source = fs.readFileSync(filename, 'utf8');
    assert.doesNotMatch(source, /\b(?:document|window|process)\./, filename);
    for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      assert.ok(match[1].startsWith('./') || match[1].startsWith('../'), `${filename}: ${match[1]}`);
      const target = path.resolve(path.dirname(filename), `${match[1]}.js`);
      assert.ok(target.startsWith(root + path.sep));
      assert.ok(fs.existsSync(target));
    }
  }
});

test('tt-only entry survives immediate onShow registration, backgrounding, warm return, and resizing', () => {
  const callbacks = {};
  let record;
  let width = 1280;
  let height = 720;
  const context = new Proxy({}, {
    get: (target, key) => target[key] || (key === 'createLinearGradient'
      ? () => ({ addColorStop() {} }) : () => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const canvas = { getContext: () => context };
  const api = {
    createCanvas: () => canvas,
    getSystemInfoSync: () => ({ windowWidth: width, windowHeight: height, screenWidth: width,
      screenHeight: height, pixelRatio: 2, safeArea: { top: 0, bottom: height, left: 0, right: width } }),
    getStorageSync: () => null,
    setStorageSync: (_, progress) => { record = progress; },
    onShow(callback) { callbacks.show = callback; callback({}); },
    onHide(callback) { callbacks.hide = callback; },
    onTouchStart(callback) { callbacks.start = callback; },
    onTouchMove(callback) { callbacks.move = callback; },
    onTouchEnd(callback) { callbacks.end = callback; },
    onTouchCancel(callback) { callbacks.cancel = callback; },
    onWindowResize(callback) { callbacks.resize = callback; },
    checkScene: ({ success }) => success({ isExist: true }),
  };
  const sandbox = vm.createContext({ tt: api, console, requestAnimationFrame: () => 1,
    cancelAnimationFrame() {}, Date });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8');
    const factory = vm.runInContext(`(function(require,module,exports){${source}\n})`, sandbox, { filename });
    factory((specifier) => load(path.resolve(path.dirname(filename), `${specifier}.js`)), module, module.exports);
    return module.exports;
  }
  assert.doesNotThrow(() => load(path.join(root, 'game.js')));
  assert.ok(callbacks.move);
  callbacks.hide();
  assert.equal(record.version, 1);
  assert.equal(record.display, 'bars');
  assert.doesNotThrow(() => callbacks.show({ launch_from: 'homepage', location: 'sidebar_card' }));
  width = 390;
  height = 844;
  assert.doesNotThrow(() => callbacks.resize());
  assert.equal(canvas.width, 780);
});
