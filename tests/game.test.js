'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const puzzle = require('../game/src/puzzle');
const { createGame } = require('../game/src/game-app');
const guideLevels = puzzle.createLevels();

/** Drives the real game's pointer callbacks using rendered hit rectangles and logical board coordinates. */
function createHarness(saved) {
  let clock = 10000;
  let pointer;
  let visibility;
  let resize;
  let key;
  let nextFrame;
  let record = saved;
  let frameCount = 0;
  let paintCount = 0;
  let viewportCount = 0;
  const whiteFrames = [];
  let width = 390;
  let height = 840;
  const context = new Proxy({
    strokeRect(x, y, width, height) {
      if (context.strokeStyle === '#ffffff') whiteFrames.push({ x, y, width, height });
    },
    setTransform(a, b, c, d, x, y) {
      if (a === 1 && b === 0 && c === 0 && d === 1 && x === 0 && y === 0) paintCount += 1;
    },
  }, {
    get: (target, name) => target[name] || (name === 'createLinearGradient'
      ? () => ({ addColorStop() {} }) : () => {}),
    set: (target, name, value) => { target[name] = value; return true; },
  });
  const platform = {
    canvas: { getContext: () => context },
    viewport() {
      viewportCount += 1;
      return { width, height, pixelRatio: 2, top: 0, bottom: 0 };
    },
    now: () => clock,
    load: () => ({ data: record }),
    save: (progress) => { record = JSON.parse(JSON.stringify(progress)); return null; },
    play() {}, pauseAudio() {}, destroy() {},
    requestFrame(callback) { nextFrame = callback; frameCount += 1; return frameCount; },
    cancelFrame() { nextFrame = null; },
    onPointer(callback) { pointer = callback; },
    onVisibility(callback) { visibility = callback; },
    onResize(callback) { resize = callback; },
    onKey(callback) { key = callback; },
    checkSidebar: (callback) => callback(false),
  };
  const game = createGame(platform);
  function send(phase, x, y, id = 1) {
    const transform = game.getSnapshot().transform;
    pointer(phase, { id, x: transform.x + x * transform.scale, y: transform.y + y * transform.scale });
  }
  function tap(x, y) { send('start', x, y); send('end', x, y); }
  function click(id) {
    const target = game.getSnapshot().buttons.find((button) => button.id === id);
    if (!target) return false;
    tap(target.x + target.width / 2, target.y + target.height / 2);
    return true;
  }
  function card(index) {
    const target = game.getSnapshot().cards.find((entry) => entry.index === index);
    assert.ok(target);
    return { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  }
  return { game, click, tap, send, card, key: (pressed) => key(pressed),
    record: () => record,
    advance(milliseconds) { clock += milliseconds; if (nextFrame) nextFrame(); },
    hide: () => visibility(false, {}), show: () => visibility(true, {}),
    frames: () => frameCount,
    paints: () => paintCount,
    viewportReads: () => viewportCount,
    whiteFrames: () => whiteFrames.slice(),
    resize(w, h) { width = w; height = h; resize(); },
  };
}

/** Installs a guide placement through selection, rotation, and real pointer dragging rather than mutating state. */
function installModule(host, index, placement) {
  const level = guideLevels[host.game.getSnapshot().current];
  const card = host.card(index);
  host.tap(card.x, card.y);
  while (host.game.getSnapshot().rotations[index] !== placement.rotation) host.key('r');
  const bounds = puzzle.dimensions(puzzle.rotated(level.pieces[index].cells, placement.rotation));
  const grid = host.game.getSnapshot().layout.grid;
  const unit = grid.width / level.size;
  const x = grid.x + (placement.x + bounds.width / 2) * unit;
  const y = grid.y + (placement.y + bounds.height / 2) * unit;
  host.send('start', card.x, card.y);
  host.send('move', x, y);
  host.send('end', x, y);
  host.advance(220);
}

test('two-stage hints reveal the whole shape and assembly without placing pieces across all eighteen puzzles', () => {
  const host = createHarness();
  const levels = puzzle.createLevels();
  for (let index = 0; index < 18; index += 1) {
    const before = host.game.getSnapshot().placements;
    const rotationsBefore = host.game.getSnapshot().rotations;
    assert.ok(host.click('hint'));
    assert.equal(host.game.getSnapshot().hint.stage, 'shape');
    const solution = host.game.getSnapshot().hint.solution;
    assert.ok(puzzle.isSolved(levels[index], solution));
    assert.ok(host.click('hint'));
    assert.equal(host.game.getSnapshot().hint.stage, 'assembly');
    assert.deepEqual(host.game.getSnapshot().placements, before);
    assert.deepEqual(host.game.getSnapshot().rotations, rotationsBefore);
    assert.ok(host.click('hint'));
    assert.equal(host.game.getSnapshot().hint, null);
    solution.forEach((placement, piece) => installModule(host, piece, placement));
    assert.ok(puzzle.isSolved(levels[index], host.game.getSnapshot().placements));
    host.advance(450);
    assert.equal(host.game.getSnapshot().modal, 'win');
    assert.equal(host.click('next'), false);
    host.advance(1000);
    assert.ok(host.click('next'));
    if (index < 17) assert.equal(host.game.getSnapshot().current, index);
    host.advance(250);
  }
  assert.equal(host.record().completed.filter(Boolean).length, 18);
  assert.equal(host.game.getSnapshot().modal, 'levels');
  host.game.destroy();
});

test('dragging and rotation install every witness module across all board sizes', () => {
  const levels = puzzle.createLevels();
  for (const level of levels) {
    const host = createHarness({ version: 1, current: level.number - 1,
      completed: levels.map((_, index) => index < level.number - 1) });
    for (let index = 0; index < level.pieces.length; index += 1) {
      const card = host.card(index);
      host.tap(card.x, card.y);
      const target = level.solution[index];
      for (let turn = 0; turn < target.rotation; turn += 1) host.click('rotate');
      const shape = puzzle.rotated(level.pieces[index].cells, target.rotation);
      const bounds = puzzle.dimensions(shape);
      const grid = host.game.getSnapshot().layout.grid;
      const unit = grid.width / level.size;
      const x = grid.x + (target.x + bounds.width / 2) * unit;
      const y = grid.y + (target.y + bounds.height / 2) * unit;
      host.send('start', card.x, card.y);
      host.send('move', x, y);
      assert.ok(host.game.getSnapshot().drag);
      host.send('end', x, y);
      assert.deepEqual(host.game.getSnapshot().placements[index], target);
    }
    assert.ok(puzzle.isSolved(level, host.game.getSnapshot().placements));
    host.game.destroy();
  }
});

test('completion locks actions through its entrance and lets replay preserve unlocked progress', () => {
  const host = createHarness();
  guideLevels[0].solution.forEach((placement, index) => installModule(host, index, placement));
  assert.equal(host.game.getSnapshot().modal, 'win');
  assert.equal(host.click('next'), false);
  assert.equal(host.click('replay'), false);
  const pulseFrames = host.whiteFrames();
  const grid = host.game.getSnapshot().layout.grid;
  assert.ok(pulseFrames.length > 0);
  assert.ok(pulseFrames.every((rectangle) => rectangle.width === rectangle.height));
  assert.ok(pulseFrames.some((rectangle) => rectangle.width < grid.width && rectangle.x > grid.x));
  assert.ok(pulseFrames.some((rectangle) => rectangle.width > grid.width && rectangle.x < grid.x));
  host.advance(650);
  assert.equal(host.click('next'), false);
  host.advance(800);
  assert.equal(host.whiteFrames().length, pulseFrames.length);
  assert.ok(host.game.getSnapshot().buttons.some((entry) => entry.id === 'next'));
  for (const [width, height] of [[390, 844], [1280, 720]]) {
    host.resize(width, height);
    const state = host.game.getSnapshot();
    for (const target of state.buttons) {
      assert.ok(state.transform.x + target.x * state.transform.scale >= 0);
      assert.ok(state.transform.y + target.y * state.transform.scale >= 0);
      assert.ok(state.transform.x + (target.x + target.width) * state.transform.scale <= width);
      assert.ok(state.transform.y + (target.y + target.height) * state.transform.scale <= height);
    }
  }
  assert.ok(host.click('replay'));
  host.advance(250);
  assert.equal(host.game.getSnapshot().current, 0);
  assert.deepEqual(host.game.getSnapshot().placements, [null, null]);
  assert.equal(host.game.getSnapshot().completed[0], true);
  host.game.destroy();
});

test('conflicting drops stay installed and red; undo, cancellation, and retrieval remain reversible', () => {
  const host = createHarness({ version: 1, current: 1, completed: [true] });
  host.click('hint');
  host.click('hint');
  const guide = host.game.getSnapshot().hint.solution;
  installModule(host, 0, guide[0]);
  installModule(host, 1, guide[1]);
  const before = host.game.getSnapshot().placements;
  const level = puzzle.createLevels()[1];
  const grid = host.game.getSnapshot().layout.grid;
  const unit = grid.width / level.size;
  const installed = before.findIndex(Boolean);
  const cells = puzzle.occupiedCells(level, installed, before[installed]);
  const x = grid.x + ((cells[0] % level.size) + 0.5) * unit;
  const y = grid.y + (Math.floor(cells[0] / level.size) + 0.5) * unit;
  const shape = puzzle.rotated(level.pieces[installed].cells, before[installed].rotation);
  const bounds = puzzle.dimensions(shape);
  let collision;
  for (let row = 0; row <= level.size - bounds.height; row += 1) {
    for (let column = 0; column <= level.size - bounds.width; column += 1) {
      const target = { x: column, y: row, rotation: before[installed].rotation };
      if (!puzzle.canPlace(level, before, installed, target)) collision = target;
    }
  }
  assert.ok(collision);
  const grabX = (cells[0] % level.size) + 0.5 - before[installed].x;
  const grabY = Math.floor(cells[0] / level.size) + 0.5 - before[installed].y;
  host.send('start', x, y);
  host.send('move', grid.x + (collision.x + grabX) * unit, grid.y + (collision.y + grabY) * unit);
  host.send('end', grid.x + (collision.x + grabX) * unit, grid.y + (collision.y + grabY) * unit);
  assert.deepEqual(host.game.getSnapshot().placements[installed], collision);
  assert.equal(puzzle.moduleErrors(level, host.game.getSnapshot().placements)[installed], true);
  assert.ok(host.game.getSnapshot().settling);
  host.advance(200);
  const conflictingPlacements = host.game.getSnapshot().placements;
  host.click('hint');
  assert.equal(host.game.getSnapshot().hint.stage, 'shape');
  assert.ok(puzzle.isSolved(level, host.game.getSnapshot().hint.solution));
  assert.deepEqual(host.game.getSnapshot().placements, conflictingPlacements);
  host.click('undo');
  assert.deepEqual(host.game.getSnapshot().placements, before);
  host.send('start', x, y);
  host.send('move', 180, 310);
  host.send('cancel', 180, 310);
  assert.deepEqual(host.game.getSnapshot().placements, before);
  host.tap(x, y);
  assert.equal(host.game.getSnapshot().selected, installed);
  assert.deepEqual(host.game.getSnapshot().placements, before);
  assert.equal(host.game.getSnapshot().drag, null);
  host.send('start', x, y);
  host.advance(299);
  assert.equal(host.game.getSnapshot().drag, null);
  host.advance(1);
  assert.equal(host.game.getSnapshot().drag.index, installed);
  assert.deepEqual(host.game.getSnapshot().placements, before);
  const socket = host.card(installed);
  host.send('move', socket.x, socket.y);
  host.send('end', socket.x, socket.y);
  assert.equal(host.game.getSnapshot().placements[installed], null);
  host.click('undo');
  assert.deepEqual(host.game.getSnapshot().placements, before);
  host.game.destroy();
});

test('held drags stay continuous and rotate with R or a second finger; only release snaps to cells', () => {
  const host = createHarness();
  host.resize(1280, 720);
  const card = host.card(0);
  const grid = host.game.getSnapshot().layout.grid;
  host.send('start', card.x, card.y);
  host.send('move', grid.x + 100.3, grid.y + 100.8);
  const before = host.game.getSnapshot();
  assert.ok(before.drag);
  assert.equal(before.placements[0], null);
  assert.notEqual((before.drag.x - grid.x) % (grid.width / 4), 0);
  host.key('r');
  assert.equal(host.game.getSnapshot().rotations[0], 1);
  assert.ok(host.game.getSnapshot().rotating);
  const rotate = host.game.getSnapshot().layout.rotate;
  host.send('start', rotate.x + rotate.width / 2, rotate.y + rotate.height / 2, 2);
  host.send('end', rotate.x + rotate.width / 2, rotate.y + rotate.height / 2, 2);
  assert.equal(host.game.getSnapshot().rotations[0], 2);
  assert.ok(host.game.getSnapshot().drag);
  host.send('cancel', grid.x + 100.3, grid.y + 100.8);
  assert.equal(host.game.getSnapshot().drag, null);
  assert.equal(host.game.getSnapshot().rotations[0], 0);
  assert.equal(host.game.getSnapshot().placements[0], null);
  host.send('start', card.x, card.y);
  host.send('move', grid.x + 121.2, grid.y + 111.7);
  const floating = host.game.getSnapshot().drag;
  host.send('end', grid.x + 121.2, grid.y + 111.7);
  const landed = host.game.getSnapshot();
  assert.equal(landed.drag, null);
  assert.ok(landed.settling);
  assert.equal(landed.placements[0].x, Math.round((floating.x - grid.x) / (grid.width / 4)) || 0);
  assert.equal(landed.placements[0].y, Math.round((floating.y - grid.y) / (grid.width / 4)) || 0);
  host.advance(200);
  assert.equal(host.game.getSnapshot().settling, null);
  host.game.destroy();
});

test('rotation paints every host frame without synchronous viewport reads between resizes', () => {
  const host = createHarness();
  const card = host.card(0);
  host.tap(card.x, card.y);
  host.key('r');
  const paintsBefore = host.paints();
  const viewportReadsBefore = host.viewportReads();
  for (let frame = 0; frame < 12; frame += 1) host.advance(16);
  assert.equal(host.paints() - paintsBefore, 12);
  assert.equal(host.viewportReads(), viewportReadsBefore);
  assert.ok(host.game.getSnapshot().rotating);
  host.advance(16);
  assert.equal(host.game.getSnapshot().rotating, null);
  assert.equal(host.game.getSnapshot().rotationControlAngle, Math.PI / 2);
  host.key('r');
  host.advance(80);
  const intermediateAngle = host.game.getSnapshot().rotationControlAngle;
  assert.ok(intermediateAngle > Math.PI / 2 && intermediateAngle < Math.PI);
  host.key('r');
  assert.equal(host.game.getSnapshot().rotationControlAngle, intermediateAngle);
  host.advance(220);
  assert.equal(host.game.getSnapshot().rotationControlAngle, 3 * Math.PI / 2);
  host.resize(1280, 720);
  assert.equal(host.viewportReads(), viewportReadsBefore + 1);
  host.hide();
  const hiddenPaints = host.paints();
  host.advance(16);
  assert.equal(host.paints(), hiddenPaints);
  host.game.destroy();
});

test('graphic indicators are the default, numeric mode persists, and reset returns every module', () => {
  const host = createHarness();
  assert.equal(host.game.getSnapshot().display, 'bars');
  host.click('display-numbers');
  assert.equal(host.record().display, 'numbers');
  const resumed = createHarness(host.record());
  assert.equal(resumed.game.getSnapshot().display, 'numbers');
  host.click('hint');
  host.click('hint');
  installModule(host, 0, host.game.getSnapshot().hint.solution[0]);
  host.click('restart');
  host.click('confirm');
  assert.equal(host.game.getSnapshot().resetting, true);
  assert.ok(host.game.getSnapshot().placements.every((placement) => placement === null));
  assert.ok(host.game.getSnapshot().rotations.every((rotation) => rotation === 0));
  assert.equal(host.game.getSnapshot().hint, null);
  host.advance(350);
  assert.equal(host.game.getSnapshot().resetting, false);
  host.game.destroy();
  resumed.game.destroy();
});

test('free dragging previews row and column counts without committing or snapping the module', () => {
  const host = createHarness();
  host.resize(1280, 720);
  const card = host.card(0);
  const grid = host.game.getSnapshot().layout.grid;
  const unit = grid.width / 4;
  host.send('start', card.x, card.y);
  host.send('move', grid.x + 3.1 * unit, grid.y + 1.6 * unit);
  const moving = host.game.getSnapshot();
  assert.equal(moving.placements[0], null);
  assert.deepEqual(moving.counts.rows[0], [0, 2, 0, 0]);
  assert.deepEqual(moving.counts.columns[0], [0, 0, 1, 1]);
  assert.notEqual((moving.drag.x - grid.x) % unit, 0);
  host.send('cancel', grid.x + 3.1 * unit, grid.y + 1.6 * unit);
  assert.deepEqual(host.game.getSnapshot().counts.rows[0], [0, 0, 0, 0]);
  host.game.destroy();
});

test('reload restores an unfinished puzzle; reset confirmation and background pausing are respected', () => {
  const host = createHarness();
  host.click('hint');
  host.click('hint');
  installModule(host, 0, host.game.getSnapshot().hint.solution[0]);
  const resumed = createHarness(host.record());
  assert.deepEqual(resumed.game.getSnapshot().placements, host.game.getSnapshot().placements);
  resumed.click('restart');
  resumed.click('cancel');
  assert.equal(resumed.game.getSnapshot().placements.filter(Boolean).length, 1);
  resumed.click('restart');
  resumed.click('confirm');
  assert.equal(resumed.game.getSnapshot().placements.filter(Boolean).length, 0);
  resumed.hide();
  const frames = resumed.frames();
  resumed.advance(1000);
  assert.equal(resumed.frames(), frames);
  resumed.show();
  assert.equal(resumed.frames(), frames + 1);
  host.game.destroy();
  resumed.game.destroy();
});

test('locked puzzles cannot be selected and every control fits short and wide screens', () => {
  const host = createHarness();
  host.click('levels');
  assert.equal(host.click('level-1'), false);
  assert.equal(host.game.getSnapshot().cards.length, 0);
  host.click('close');
  for (const [width, height] of [[320, 568], [390, 844], [430, 932], [1280, 800]]) {
    host.resize(width, height);
    const state = host.game.getSnapshot();
    for (const target of [...state.buttons, ...state.cards]) {
      const { x, y, scale } = state.transform;
      assert.ok(x + target.x * scale >= 0);
      assert.ok(y + target.y * scale >= 0);
      assert.ok(x + (target.x + target.width) * scale <= width + 0.01);
      assert.ok(y + (target.y + target.height) * scale <= height + 0.01);
    }
  }
  host.game.destroy();
});
