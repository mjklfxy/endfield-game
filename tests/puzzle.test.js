'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const puzzle = require('../game/src/puzzle');

test('rotations preserve cell count, normalize anchors, and return after four turns', () => {
  const shape = [[0, 0], [0, 1], [1, 1]];
  assert.deepEqual(puzzle.rotated(shape, 0), puzzle.rotated(shape, 4));
  for (let turn = 0; turn < 4; turn += 1) {
    const cells = puzzle.rotated(shape, turn);
    assert.equal(new Set(cells.map(JSON.stringify)).size, 3);
    assert.equal(Math.min(...cells.map(([x]) => x)), 0);
    assert.equal(Math.min(...cells.map(([, y]) => y)), 0);
  }
});

test('eighteen deterministic puzzles have valid witnesses and independently solved layouts', () => {
  const levels = puzzle.createLevels();
  assert.equal(levels.length, 18);
  assert.deepEqual(levels, puzzle.createLevels());
  for (const level of levels) {
    assert.ok(puzzle.isSolved(level, level.solution), `Invalid witness ${level.number}`);
    const result = puzzle.findSolution(level, Array(level.pieces.length).fill(null));
    assert.equal(result.status, 'solved', `Unsolved level ${level.number}`);
    assert.ok(puzzle.isSolved(level, result.placements));
    assert.ok(level.pieces.reduce((sum, piece) => sum + piece.cells.length, 0) < level.size ** 2);
  }
});

test('completion accepts equivalent arrangements and checks each color independently', () => {
  const level = { size: 2, colors: 1, pieces: [{ cells: [[0, 0]], color: 0 }, { cells: [[0, 0]], color: 0 }],
    rows: [[1, 1]], columns: [[1, 1]] };
  assert.ok(puzzle.isSolved(level, [{ x: 0, y: 0, rotation: 0 }, { x: 1, y: 1, rotation: 0 }]));
  assert.ok(puzzle.isSolved(level, [{ x: 1, y: 0, rotation: 0 }, { x: 0, y: 1, rotation: 0 }]));
  const colored = { ...level, colors: 2, pieces: [{ cells: [[0, 0]], color: 0 }, { cells: [[0, 0]], color: 1 }],
    rows: [[1, 0], [0, 1]], columns: [[1, 0], [0, 1]] };
  assert.equal(puzzle.isSolved(colored, [{ x: 1, y: 0, rotation: 0 }, { x: 0, y: 1, rotation: 0 }]), false);
  assert.equal(puzzle.isSolved(colored, [{ x: 0, y: 0, rotation: 0 }, { x: 1, y: 1, rotation: 0 }]), true);
});

test('geometry rejects overlap and off-board moves while permitting count mistakes', () => {
  const level = puzzle.createLevels()[0];
  const blank = Array(level.pieces.length).fill(null);
  assert.equal(puzzle.canPlace(level, blank, 0, { x: -1, y: 0, rotation: 0 }), false);
  assert.equal(puzzle.canPlace(level, blank, 0, { x: 3, y: 3, rotation: 0 }), false);
  const placements = [{ x: 0, y: 0, rotation: 0 }, null];
  assert.equal(puzzle.canPlace(level, placements, 1, { x: 0, y: 0, rotation: 0 }), false);
  assert.equal(puzzle.canPlace(level, placements, 0, { x: 2, y: 0, rotation: 0 }), true);
  assert.ok(puzzle.measure(level, placements).valid);
});

test('hints preserve existing placements and distinguish impossible layouts from search budgets', () => {
  const level = puzzle.createLevels()[10];
  const partial = level.solution.map((placement, index) => index === 0 ? placement : null);
  const solved = puzzle.findSolution(level, partial);
  assert.equal(solved.status, 'solved');
  assert.deepEqual(solved.placements[0], partial[0]);
  assert.equal(puzzle.findSolution(level, partial, 0).status, 'limit');
  const one = { size: 2, colors: 1, pieces: [{ cells: [[0, 0]], color: 0 }],
    rows: [[1, 0]], columns: [[1, 0]] };
  assert.equal(puzzle.findSolution(one, [{ x: 1, y: 1, rotation: 0 }]).status, 'unsolvable');
});

test('save restore rejects invalid layouts and never unlocks gaps in the campaign', () => {
  const levels = puzzle.createLevels();
  const partial = Array(levels[1].pieces.length).fill(null);
  partial[0] = levels[1].solution[0];
  const restored = puzzle.restoreProgress({ version: 1, current: 17, completed: [true, false, true],
    placements: partial, rotations: [0, 1, 2], sound: false }, levels);
  assert.equal(restored.current, 1);
  assert.deepEqual(restored.completed.slice(0, 3), [true, false, false]);
  assert.deepEqual(restored.placements, partial);
  assert.equal(restored.sound, false);
  assert.equal(puzzle.restoreProgress({ version: 1, placements: [{ x: -2, y: 9, rotation: 0 }] }, levels).placements, null);
});

test('editable overlapping and partial out-of-bounds placements remain red and survive reload', () => {
  const levels = puzzle.createLevels();
  const level = levels[0];
  const overlap = [{ x: 0, y: 0, rotation: 0 }, { x: 0, y: 0, rotation: 0 }];
  assert.equal(puzzle.canDrop(level, 1, overlap[1]), true);
  assert.equal(puzzle.isSolved(level, overlap), false);
  assert.deepEqual(puzzle.measure(level, overlap).invalidPieces, [true, true]);
  assert.deepEqual(puzzle.restoreProgress({ version: 1, placements: overlap }, levels).placements, overlap);
  const partial = [{ x: -1, y: 0, rotation: 0 }, null];
  assert.equal(puzzle.canDrop(level, 0, partial[0]), true);
  assert.equal(puzzle.measure(level, partial).rows[0][0], 1);
  assert.equal(puzzle.moduleErrors(level, partial)[0], true);
  assert.equal(puzzle.canDrop(level, 0, { x: -10, y: 0, rotation: 0 }), false);
  assert.equal(puzzle.findSolution(level, overlap).status, 'unsolvable');
});

test('charge mismatch does not mark geometrically valid modules as red', () => {
  const level = { size: 2, colors: 1, pieces: [{ cells: [[0, 0]], color: 0 }],
    rows: [[1, 0]], columns: [[1, 0]] };
  const misplaced = [{ x: 1, y: 1, rotation: 0 }];
  assert.equal(puzzle.isSolved(level, misplaced), false);
  assert.equal(puzzle.measure(level, misplaced).rows[0][1], 1);
  assert.deepEqual(puzzle.moduleErrors(level, misplaced), [false]);
});
