(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitPuzzle = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHAPTERS = ['基础校准', '双路耦合', '三相协同'];
  const SHAPES = [
    [[0, 0], [1, 0]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [3, 0]],
  ];

  /** Rotates clockwise in grid coordinates, then normalizes the shape to a top-left anchor. */
  function rotated(cells, turns) {
    let transformed = cells.map(([x, y]) => [x, y]);
    for (let turn = 0; turn < ((turns % 4) + 4) % 4; turn += 1) {
      transformed = transformed.map(([x, y]) => [-y, x]);
    }
    const left = Math.min(...transformed.map(([x]) => x));
    const top = Math.min(...transformed.map(([, y]) => y));
    return transformed.map(([x, y]) => [x - left, y - top])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  function dimensions(cells) {
    return { width: Math.max(...cells.map(([x]) => x)) + 1,
      height: Math.max(...cells.map(([, y]) => y)) + 1 };
  }

  /** Maps a module to coordinates while retaining out-of-bounds cells for editable invalid placements. */
  function placementCoordinates(level, pieceIndex, placement) {
    if (!placement || !Number.isInteger(placement.x) || !Number.isInteger(placement.y)
      || !Number.isInteger(placement.rotation) || placement.rotation < 0 || placement.rotation > 3
      || !level.pieces[pieceIndex]) return null;
    return rotated(level.pieces[pieceIndex].cells, placement.rotation)
      .map(([x, y]) => [x + placement.x, y + placement.y]);
  }

  /** Returns complete in-bounds cell indices for solver candidates and collision checks. */
  function occupiedCells(level, pieceIndex, placement) {
    const cells = placementCoordinates(level, pieceIndex, placement);
    if (!cells) return null;
    if (cells.some(([x, y]) => x < 0 || y < 0 || x >= level.size || y >= level.size)) return null;
    return cells.map(([x, y]) => y * level.size + x);
  }

  /** Allows a released module to remain editable whenever at least one of its cells intersects the board. */
  function canDrop(level, pieceIndex, placement) {
    const cells = placementCoordinates(level, pieceIndex, placement);
    return Boolean(cells && cells.some(([x, y]) => x >= 0 && y >= 0 && x < level.size && y < level.size));
  }

  /** Counts installed cells and marks every overlapping or out-of-bounds module without discarding it. */
  function measure(level, placements) {
    const owners = Array(level.size ** 2).fill(-1);
    const rows = Array.from({ length: level.colors }, () => Array(level.size).fill(0));
    const columns = rows.map((row) => row.slice());
    const invalidPieces = Array(level.pieces.length).fill(false);
    let valid = Array.isArray(placements) && placements.length === level.pieces.length;
    if (!valid) return { valid: false, owners, rows, columns, invalidPieces };
    placements.forEach((placement, index) => {
      if (placement === null) return;
      const cells = placementCoordinates(level, index, placement);
      if (!cells) { valid = false; invalidPieces[index] = true; return; }
      const color = level.pieces[index].color;
      cells.forEach(([x, y]) => {
        if (x < 0 || y < 0 || x >= level.size || y >= level.size) {
          valid = false;
          invalidPieces[index] = true;
          return;
        }
        const cell = y * level.size + x;
        if (owners[cell] !== -1) {
          valid = false;
          invalidPieces[index] = true;
          invalidPieces[owners[cell]] = true;
        }
        owners[cell] = index;
        rows[color][Math.floor(cell / level.size)] += 1;
        columns[color][cell % level.size] += 1;
      });
    });
    return { valid, owners, rows, columns, invalidPieces };
  }

  /** Marks geometric conflicts only; charge mismatches belong to row and column indicators. */
  function moduleErrors(level, placements) {
    return measure(level, placements).invalidPieces.slice();
  }

  /** Checks geometric placement only; over-target counts remain legal and are shown as errors in the UI. */
  function canPlace(level, placements, index, placement) {
    if (index < 0 || index >= level.pieces.length) return false;
    const proposed = placements.slice();
    proposed[index] = placement;
    return measure(level, proposed).valid;
  }

  /** Requires every supplied module and every color's row/column counts; unused board cells stay empty. */
  function isSolved(level, placements) {
    const counts = measure(level, placements);
    return counts.valid && placements.every(Boolean)
      && counts.rows.every((row, color) => row.every((count, index) => count === level.rows[color][index]))
      && counts.columns.every((column, color) => column.every((count, index) => count === level.columns[color][index]));
  }

  /** Searches only extensions of the player's current layout; a node budget avoids freezing the host. */
  function findSolution(level, fixed, budget) {
    const placements = fixed.map((placement) => placement ? { ...placement } : null);
    const initial = measure(level, placements);
    if (!initial.valid) return { status: 'unsolvable', placements: null, nodes: 0 };
    const owners = initial.owners.slice();
    const rows = initial.rows.map((row) => row.slice());
    const columns = initial.columns.map((column) => column.slice());
    const overTarget = () => rows.some((row, color) => row.some((count, index) => count > level.rows[color][index]))
      || columns.some((column, color) => column.some((count, index) => count > level.columns[color][index]));
    if (overTarget()) return { status: 'unsolvable', placements: null, nodes: 0 };

    const candidates = level.pieces.map((piece, index) => {
      if (placements[index]) return [];
      const options = [];
      const seen = new Set();
      for (let rotation = 0; rotation < 4; rotation += 1) {
        const shape = rotated(piece.cells, rotation);
        const key = JSON.stringify(shape);
        if (seen.has(key)) continue;
        seen.add(key);
        const { width, height } = dimensions(shape);
        for (let y = 0; y <= level.size - height; y += 1) {
          for (let x = 0; x <= level.size - width; x += 1) {
            options.push({ x, y, rotation, cells: shape.map(([dx, dy]) => (y + dy) * level.size + x + dx) });
          }
        }
      }
      return options;
    });
    let nodes = 0;
    let limited = false;
    const limit = budget === undefined ? 12000 : budget;

    function fits(option, color) {
      if (option.cells.some((cell) => owners[cell] !== -1)) return false;
      const addRows = Array(level.size).fill(0);
      const addColumns = Array(level.size).fill(0);
      option.cells.forEach((cell) => {
        addRows[Math.floor(cell / level.size)] += 1;
        addColumns[cell % level.size] += 1;
      });
      return addRows.every((count, index) => rows[color][index] + count <= level.rows[color][index])
        && addColumns.every((count, index) => columns[color][index] + count <= level.columns[color][index]);
    }

    /** Chooses the most constrained unused module, propagating counts on both placement and rollback. */
    function search(remaining) {
      nodes += 1;
      if (nodes > limit) { limited = true; return false; }
      if (!remaining) return isSolved(level, placements);
      let selected = -1;
      let options = null;
      for (let index = 0; index < placements.length; index += 1) {
        if (placements[index]) continue;
        const available = candidates[index].filter((option) => fits(option, level.pieces[index].color));
        if (!available.length) return false;
        if (!options || available.length < options.length) {
          selected = index;
          options = available;
        }
      }
      const color = level.pieces[selected].color;
      for (const option of options) {
        placements[selected] = { x: option.x, y: option.y, rotation: option.rotation };
        option.cells.forEach((cell) => {
          owners[cell] = selected;
          rows[color][Math.floor(cell / level.size)] += 1;
          columns[color][cell % level.size] += 1;
        });
        if (search(remaining - 1)) return true;
        option.cells.forEach((cell) => {
          owners[cell] = -1;
          rows[color][Math.floor(cell / level.size)] -= 1;
          columns[color][cell % level.size] -= 1;
        });
        placements[selected] = null;
        if (limited) return false;
      }
      return false;
    }

    const solved = search(placements.filter((placement) => !placement).length);
    return { status: solved ? 'solved' : limited ? 'limit' : 'unsolvable',
      placements: solved ? placements : null, nodes };
  }

  /** Builds eighteen original puzzles from valid layouts; counts permit equivalent valid solutions. */
  function createLevels() {
    let seed = 541027;
    function random() {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }
    const levels = [];
    for (let index = 0; index < 18; index += 1) {
      const chapter = Math.floor(index / 6);
      const stage = index % 6;
      const size = 4 + chapter;
      const count = chapter === 0 ? Math.min(2 + stage, 4) : chapter === 1 ? Math.min(4 + stage, 5) : Math.min(5 + stage, 6);
      let pieces;
      let solution;
      let attempts = 0;
      do {
        pieces = Array.from({ length: count }, (_, piece) => ({
          id: piece, color: piece % (chapter + 1),
          cells: SHAPES[index === 0 ? [0, 2][piece] : Math.floor(random() * SHAPES.length)]
            .map((cell) => cell.slice()),
        }));
        const provisional = { size, colors: chapter + 1, pieces };
        solution = Array(count).fill(null);
        for (let piece = 0; piece < count; piece += 1) {
          const choices = [];
          for (let rotation = 0; rotation < 4; rotation += 1) {
            for (let y = 0; y < size; y += 1) {
              for (let x = 0; x < size; x += 1) {
                const placement = { x, y, rotation };
                if (canPlace(provisional, solution, piece, placement)) choices.push(placement);
              }
            }
          }
          if (!choices.length) break;
          solution[piece] = choices[Math.floor(random() * choices.length)];
        }
        attempts += 1;
        if (attempts > 1000) throw new Error('Puzzle generation exhausted');
      } while (solution.some((placement) => !placement));
      const level = { number: index + 1, chapter, title: CHAPTERS[chapter], size, colors: chapter + 1, pieces };
      const counts = measure(level, solution);
      level.rows = counts.rows;
      level.columns = counts.columns;
      level.solution = solution;
      levels.push(level);
    }
    return levels;
  }

  /** Restores only structurally valid saves and contiguous campaign unlocks. */
  function restoreProgress(saved, levels) {
    const progress = { current: 0, completed: Array(levels.length).fill(false),
      sound: true, display: 'bars', placements: null, rotations: null };
    if (!saved || saved.version !== 1) return progress;
    if (Array.isArray(saved.completed)) {
      for (let index = 0; index < levels.length && saved.completed[index] === true; index += 1) {
        progress.completed[index] = true;
      }
    }
    const unlocked = Math.min(progress.completed.filter(Boolean).length, levels.length - 1);
    progress.current = Number.isInteger(saved.current) ? Math.max(0, Math.min(saved.current, unlocked)) : 0;
    progress.sound = saved.sound !== false;
    progress.display = saved.display === 'numbers' ? 'numbers' : 'bars';
    const level = levels[progress.current];
    if (Array.isArray(saved.placements) && saved.placements.length === level.pieces.length
      && saved.placements.every((placement, index) => placement === null || canDrop(level, index, placement))) {
      progress.placements = saved.placements.map((placement) => placement ? { ...placement } : null);
    }
    if (Array.isArray(saved.rotations) && saved.rotations.length === level.pieces.length
      && saved.rotations.every((turn) => Number.isInteger(turn) && turn >= 0 && turn <= 3)) {
      progress.rotations = saved.rotations.slice();
    }
    return progress;
  }

  return { CHAPTERS, rotated, dimensions, occupiedCells, canDrop, measure, moduleErrors, canPlace, isSolved,
    findSolution, createLevels, restoreProgress };
});
