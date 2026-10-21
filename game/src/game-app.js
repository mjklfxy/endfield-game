(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./puzzle'));
  else root.CircuitApp = factory(root.CircuitPuzzle);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (puzzle) {
  'use strict';

  const COLORS = ['#d0f526', '#86d8e0', '#ec9a81'];
  const INSTALLED_COLORS = ['#e0ff46', '#63b2bc', '#ce8b70'];
  const NAMES = ['A', 'B', 'C'];
  const INK = '#edf0e8';
  const MUTED = '#8b969b';
  const FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';
  const COMPLETION_READY_MS = 1500;

  /** Reflows the same puzzle into a reference-style landscape terminal or a readable portrait preview. */
  function createLayout(portrait) {
    if (portrait) return {
      portrait: true, width: 420, height: 930,
      grid: { x: 84, y: 276, width: 312 },
      tray: { x: 24, y: 644, columns: 3, cellWidth: 118, cellHeight: 58, gap: 9 },
      rotate: { x: 116, y: 792, width: 88, height: 48 },
      undo: { x: 24, y: 792, width: 83, height: 48 },
      reset: { x: 213, y: 792, width: 88, height: 48 },
      hint: { x: 310, y: 792, width: 86, height: 48 },
      toggle: { x: 116, y: 858, width: 190, height: 32 },
      levels: { x: 24, y: 858, width: 84, height: 32 },
      help: { x: 310, y: 24, width: 36, height: 36 },
      sound: { x: 358, y: 24, width: 38, height: 36 },
    };
    return {
      portrait: false, width: 1280, height: 720,
      grid: { x: 440, y: 202, width: 380 },
      tray: { x: 986, y: 172, columns: 2, cellWidth: 108, cellHeight: 118, gap: 12 },
      rotate: { x: 120, y: 324, width: 140, height: 140 },
      undo: { x: 84, y: 590, width: 96, height: 38 },
      reset: { x: 84, y: 648, width: 208, height: 38 },
      hint: { x: 192, y: 590, width: 100, height: 38 },
      toggle: { x: 535, y: 650, width: 190, height: 32 },
      levels: { x: 84, y: 540, width: 208, height: 36 },
      help: { x: 1142, y: 24, width: 38, height: 38 },
      sound: { x: 1190, y: 24, width: 38, height: 38 },
    };
  }

  function text(ctx, label, x, y, size, color, align, weight) {
    ctx.fillStyle = color || INK;
    ctx.font = `${weight || 400} ${size}px ${FONT}`;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }

  function panel(ctx, x, y, width, height, fill, stroke) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    }
  }

  function check(ctx, x, y, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x - 1, y + 3);
    ctx.lineTo(x + 5, y - 4);
    ctx.stroke();
  }

  /** Draws rounded surfaces using paths supported by both the native Canvas and browser preview. */
  function roundedPanel(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Coordinates module manipulation, count feedback, local progress, and host-independent Canvas UI. */
  function createGame(platform) {
    const ctx = platform.canvas.getContext('2d');
    const levels = puzzle.createLevels();
    const loaded = platform.load();
    const progress = puzzle.restoreProgress(loaded.data, levels);
    let current = progress.current;
    let placements = progress.placements || Array(levels[current].pieces.length).fill(null);
    let rotations = progress.rotations || levels[current].pieces.map(() => 0);
    let selected = -1;
    let history = [];
    let modal = null;
    let hint = null;
    let hintVisual = null;
    const presentationFades = new Map();
    const labelTransitions = new Map();
    let labelScope = 'main';
    let interfaceStartedAt = platform.now();
    let levelTransition = null;
    let rotationControl = { from: 0, target: 0, startedAt: platform.now() };
    let gesture = null;
    let drag = null;
    let settling = null;
    let rotationTween = null;
    let resetTween = null;
    const overflowRibbons = new Map();
    const indicatorBars = new Map();
    const selectionTweens = new Map();
    let boardDimming = { from: 0, target: 0, startedAt: 0 };
    let layout = createLayout(false);
    let buttons = [];
    let cards = [];
    let transform = { x: 0, y: 0, scale: 1 };
    let completedAt = 0;
    let toast = loaded.error ? '读取进度失败，已开始新的练习' : '';
    let toastUntil = toast ? platform.now() + 3500 : 0;
    let toastStartedAt = platform.now();
    let retiringToasts = [];
    let frame = 0;
    let pixelRatio = 1;
    let active = true;
    let destroyed = false;
    let sidebar = false;
    let fromSidebar = false;
    let storageWarningShown = false;
    const unsubscribers = [];

    function level() { return levels[current]; }
    function play(name) { if (progress.sound) platform.play(name); }
    /** Cross-fades replacement notices rather than abruptly replacing visible feedback. */
    function notify(message) {
      const now = platform.now();
      if (toast && now < toastUntil) {
        retiringToasts.push({ message: toast, startedAt: toastStartedAt, until: Math.min(toastUntil, now + 220) });
      }
      toast = message;
      toastStartedAt = now;
      toastUntil = now + 3100;
    }

    /** Retargets short presentation fades from their current opacity, including interrupted entrances. */
    function presentationOpacity(key, visible, now) {
      let fade = presentationFades.get(key);
      if (!fade) {
        fade = { from: 0, target: 0, startedAt: now };
        presentationFades.set(key, fade);
      }
      const fraction = Math.min(1, Math.max(0, (now - fade.startedAt) / (fade.target ? 240 : 200)));
      const eased = fraction * fraction * (3 - 2 * fraction);
      const opacity = fade.from + (fade.target - fade.from) * eased;
      const target = visible ? 1 : 0;
      if (fade.target !== target) {
        fade.from = opacity;
        fade.target = target;
        fade.startedAt = now;
      }
      return opacity;
    }

    /** Keeps the control glyph at its accumulated quarter-turn instead of snapping back after each animation. */
    function rotationControlAngle(now) {
      const fraction = Math.min(1, Math.max(0, (now - rotationControl.startedAt) / 200));
      const eased = fraction * fraction * (3 - 2 * fraction);
      return rotationControl.from + (rotationControl.target - rotationControl.from) * eased;
    }

    /** Cross-fades changing captions, retaining the previous text until its exit completes. */
    function animatedLabel(key, label, x, y, size, color, align, weight) {
      const now = platform.now();
      let transition = labelTransitions.get(key);
      if (!transition) {
        transition = { label, previous: '', startedAt: now };
        labelTransitions.set(key, transition);
      }
      if (transition.label !== label) {
        transition.previous = transition.label;
        transition.label = label;
        transition.startedAt = now;
      }
      const fraction = Math.min(1, Math.max(0, (now - transition.startedAt) / 180));
      const opacity = fraction * fraction * (3 - 2 * fraction);
      ctx.save();
      const inheritedAlpha = ctx.globalAlpha;
      if (transition.previous && opacity < 1) {
        ctx.globalAlpha = inheritedAlpha * (1 - opacity);
        text(ctx, transition.previous, x, y - opacity * 4, size, color, align, weight);
      }
      ctx.globalAlpha = inheritedAlpha * opacity;
      text(ctx, label, x, y + (1 - opacity) * 4, size, color, align, weight);
      ctx.restore();
    }

    /** Announces meaningful state changes for keyboard and screen-reader users of the browser preview. */
    function announce() {
      if (!platform.announce) return;
      const counts = puzzle.measure(level(), placements);
      const installed = placements.filter(Boolean).length;
      const matched = counts.rows.reduce((sum, row, color) => sum
        + row.filter((count, index) => count === level().rows[color][index]).length, 0)
        + counts.columns.reduce((sum, column, color) => sum
          + column.filter((count, index) => count === level().columns[color][index]).length, 0);
      platform.announce(`第 ${current + 1} 关，${level().size} 乘 ${level().size} 电路，`
        + `已安装 ${installed}/${level().pieces.length} 个模块，${matched} 项行列计数匹配。`
        + (completedAt ? '电路校准完成。' : '')
        + (selected >= 0 ? `已选择模块 ${selected + 1}，旋转 ${rotations[selected] * 90} 度。` : ''));
    }

    /** Saves placements with versioned metadata; storage failures stay visible without interrupting play. */
    function persist() {
      const error = platform.save({ version: 1, current, completed: progress.completed.slice(),
        placements: placements.map((placement) => placement ? { ...placement } : null),
        rotations: rotations.slice(), sound: progress.sound, display: progress.display });
      if (error && !storageWarningShown) {
        storageWarningShown = true;
        notify('存档写入失败，退出后可能无法保留进度');
      }
      announce();
    }

    /** Loads only unlocked puzzles and drops transient drag, hint, and undo state. */
    function loadLevel(index) {
      const unlocked = Math.min(progress.completed.filter(Boolean).length, levels.length - 1);
      if (index < 0 || index > unlocked) return;
      overflowRibbons.clear();
      indicatorBars.clear();
      selectionTweens.clear();
      boardDimming = { from: 0, target: 0, startedAt: platform.now() };
      interfaceStartedAt = platform.now();
      levelTransition = null;
      labelTransitions.clear();
      hintVisual = null;
      presentationFades.delete('hint-shape');
      presentationFades.delete('hint-assembly');
      current = index;
      placements = Array(level().pieces.length).fill(null);
      rotations = level().pieces.map(() => 0);
      history = [];
      selected = -1;
      modal = null;
      hint = null;
      drag = null;
      settling = null;
      rotationTween = null;
      resetTween = null;
      gesture = null;
      completedAt = 0;
      if (toast && platform.now() < toastUntil) {
        retiringToasts.push({ message: toast, startedAt: toastStartedAt, until: Math.min(toastUntil, platform.now() + 220) });
      }
      toast = '';
      toastUntil = 0;
      persist();
    }

    /** Lets the old task fade out before replacing its board and fading the new interface in. */
    function transitionLevel(index) {
      const unlocked = Math.min(progress.completed.filter(Boolean).length, levels.length - 1);
      if (index < 0 || index > unlocked || levelTransition) return;
      cancelGesture();
      modal = null;
      levelTransition = { index, startedAt: platform.now() };
    }

    function remember() {
      history.push({ placements: placements.map((placement) => placement ? { ...placement } : null),
        rotations: rotations.slice() });
    }

    /** Retains released modules, including conflicts; only placements satisfying all rules can complete a task. */
    function place(index, placement) {
      if (modal || completedAt) return false;
      if (!puzzle.canDrop(level(), index, placement)) {
        notify('请将模块拖到盘面上');
        return false;
      }
      if (JSON.stringify(placements[index]) === JSON.stringify(placement)) return true;
      remember();
      placements[index] = { ...placement };
      rotations[index] = placement.rotation;
      selected = -1;
      hint = null;
      play('tap');
      if (puzzle.moduleErrors(level(), placements)[index]) notify('红色模块存在冲突，可继续拖动调整');
      if (puzzle.isSolved(level(), placements)) {
        completedAt = platform.now();
        toastUntil = Math.min(toastUntil, completedAt + 220);
        progress.completed[current] = true;
        play('win');
      }
      persist();
      return true;
    }

    /** Returns one installed module to the tray; removal is reversible through the normal undo action. */
    function takeBack(index) {
      settling = null;
      if (placements[index]) {
        remember();
        placements[index] = null;
        hint = null;
        play('tap');
      }
      selected = index;
      persist();
    }

    /** Rotates around the held contact point; installed modules may remain red until their layout is corrected. */
    function rotateSelected() {
      if (completedAt || modal) return;
      if (gesture && gesture.kind === 'piece') {
        const index = gesture.index;
        startRotationTween(index, rotations[index], gesture.grabX, gesture.grabY);
        const before = puzzle.dimensions(puzzle.rotated(level().pieces[index].cells, rotations[index]));
        const grabX = gesture.grabX;
        gesture.grabX = before.height - gesture.grabY;
        gesture.grabY = grabX;
        rotationTween.toGrabX = gesture.grabX;
        rotationTween.toGrabY = gesture.grabY;
        rotations[index] = (rotations[index] + 1) % 4;
        gesture.dragging = true;
        hint = null;
        updateDrag(gesture.point);
        play('tap');
        return;
      }
      if (selected < 0) return;
      const rotation = (rotations[selected] + 1) % 4;
      startRotationTween(selected, rotations[selected]);
      hint = null;
      if (placements[selected]) {
        const index = selected;
        if (place(index, { ...placements[index], rotation })) selected = index;
      } else {
        rotations[selected] = rotation;
        play('tap');
        persist();
      }
    }
    /** Restores one placement transaction; selecting and rotating unused pieces do not consume undo steps. */
    function undo() {
      if (!history.length || completedAt) return;
      settling = null;
      const previous = history.pop();
      placements = previous.placements;
      rotations = previous.rotations;
      selected = -1;
      hint = null;
      play('tap');
      persist();
    }

    /** Reveals the completed silhouette first, then its numbered module decomposition, without installing any pieces. */
    function showHint() {
      if (completedAt) return;
      if (hint) {
        hint = hint.stage === 'shape' ? { ...hint, stage: 'assembly', startedAt: platform.now() } : null;
        if (hint) notify('按编号查看每个模块的位置和方向');
        return;
      }
      let result = puzzle.findSolution(level(), placements);
      if (result.status === 'unsolvable') result = puzzle.findSolution(level(), Array(placements.length).fill(null));
      if (result.status !== 'solved') {
        notify(result.status === 'limit' ? '当前布局较复杂，试试取回一个模块'
          : '当前布局无法完成，请撤销或取回模块调整');
        return;
      }
      hint = { stage: 'shape', solution: result.placements.map((placement) => ({ ...placement })),
        startedAt: platform.now() };
      notify('这是完成后的整体形状，再点「查看拼法」可看模块组合');
      play('hint');
      persist();
    }

    function hitButton(id, x, y, width, height, action, enabled) {
      if (enabled !== false) buttons.push({ id, x, y, width, height, action });
    }

    /** Uses a clear action hierarchy while keeping disabled controls visible and noninteractive. */
    function button(id, label, x, y, width, height, action, primary, enabled) {
      const disabled = enabled === false;
      const accent = primary || id === 'hint';
      const fill = disabled ? '#17202b' : accent ? '#d9f777' : id === 'restart' ? '#19232f' : '#273647';
      roundedPanel(ctx, x, y, width, height, 7, fill,
        disabled ? '#273342' : accent ? '#e7ff9e' : '#45566a');
      animatedLabel(`${labelScope}-button-${id}`, label, x + width / 2, y + height / 2, layout.portrait ? 14 : 16,
        disabled ? '#596879' : accent ? '#202b18' : id === 'restart' ? '#aebdce' : INK, 'center', 600);
      hitButton(id, x, y, width, height, action, enabled);
    }

    function drawSound() {
      const box = layout.sound;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      for (let bar = 0; bar < 4; bar += 1) {
        const height = progress.sound ? [7, 15, 21, 11][bar] : 3;
        panel(ctx, cx - 9 + bar * 5, cy - height / 2, 2, height, progress.sound ? '#a1af8d' : MUTED);
      }
      hitButton('sound', box.x, box.y, box.width, box.height, () => {
        progress.sound = !progress.sound;
        if (!progress.sound) platform.pauseAudio();
        else play('tap');
        persist();
      });
    }

    /** Draws one silhouette with an independently faded selection fill and glowing outline. */
    function drawShape(cells, x, y, unit, color, raised, invalid, highlightOpacity = 0) {
      const edges = [];
      const hasCell = (column, row) => cells.some(([cx, cy]) => cx === column && cy === row);
      cells.forEach(([column, row]) => {
        const left = x + column * unit;
        const top = y + row * unit;
        if (!hasCell(column, row - 1)) edges.push([left, top, left + unit, top]);
        if (!hasCell(column + 1, row)) edges.push([left + unit, top, left + unit, top + unit]);
        if (!hasCell(column, row + 1)) edges.push([left + unit, top + unit, left, top + unit]);
        if (!hasCell(column - 1, row)) edges.push([left, top + unit, left, top]);
      });
      ctx.save();
      const elevation = Number(raised);
      if (elevation) {
        ctx.shadowColor = '#000000cc';
        ctx.shadowBlur = 22 * elevation;
        ctx.shadowOffsetY = 10 * elevation;
        ctx.shadowOffsetX = 4 * elevation;
      }
      // One path fills the union, so the carried module has one coherent shadow and no duplicate image.
      ctx.beginPath();
      cells.forEach(([column, row]) => ctx.rect(x + column * unit, y + row * unit, unit, unit));
      ctx.fillStyle = color;
      ctx.fill();
      if (highlightOpacity > 0) {
        ctx.save();
        ctx.globalAlpha *= highlightOpacity;
        ctx.fillStyle = invalid ? '#fff2e526' : '#eeffb52e';
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowOffsetX = 0;
      ctx.beginPath();
      edges.forEach(([x1, y1, x2, y2]) => { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); });
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = raised ? '#151c0e' : '#1b240f';
      ctx.lineWidth = raised ? 7 : 5;
      ctx.stroke();
      ctx.strokeStyle = invalid ? '#ff7770' : elevation > 0.2 ? '#f5ffb0' : '#95a94a';
      ctx.lineWidth = raised ? 3 : 1.5;
      ctx.stroke();
      if (highlightOpacity > 0) {
        ctx.save();
        ctx.globalAlpha *= highlightOpacity;
        ctx.strokeStyle = invalid ? '#ffd0b6' : '#f5ffb0';
        ctx.lineWidth = 3;
        ctx.shadowColor = invalid ? '#ff8d70' : '#dbff70';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.restore();
      }
      if (!raised && unit > 35) {
        ctx.strokeStyle = '#c9dc8c19';
        ctx.lineWidth = 1;
        cells.forEach(([column, row]) => {
          const cx = x + (column + 0.5) * unit;
          const cy = y + (row + 0.5) * unit;
          const inset = unit * 0.25;
          ctx.beginPath();
          ctx.moveTo(cx - inset, cy - inset);
          ctx.lineTo(cx - inset * 0.35, cy - inset * 0.35);
          ctx.moveTo(cx + inset, cy + inset);
          ctx.lineTo(cx + inset * 0.35, cy + inset * 0.35);
          ctx.stroke();
        });
      }
      ctx.restore();
    }

    /** Retargets repeated quarter-turns from the current visual angle, avoiding jumps on rapid rotations. */
    function startRotationTween(index, fromRotation, grabX, grabY) {
      const now = platform.now();
      rotationControl = { from: rotationControlAngle(now), target: rotationControl.target + Math.PI / 2, startedAt: now };
      if (rotationTween && rotationTween.index === index) {
        const fraction = Math.min(1, (now - rotationTween.startedAt) / 200);
        const eased = fraction * fraction * (3 - 2 * fraction);
        rotationTween.fromAngle += (rotationTween.targetAngle - rotationTween.fromAngle) * eased;
        rotationTween.targetAngle += Math.PI / 2;
        rotationTween.startedAt = now;
        return;
      }
      const cells = puzzle.rotated(level().pieces[index].cells, fromRotation);
      const bounds = puzzle.dimensions(cells);
      rotationTween = { index, cells, fromAngle: 0, targetAngle: Math.PI / 2, startedAt: now,
        fromGrabX: grabX === undefined ? bounds.width / 2 : grabX,
        fromGrabY: grabY === undefined ? bounds.height / 2 : grabY,
        toGrabX: 0, toGrabY: 0 };
    }

    /** Retargets selection from its visible intensity so switching modules cross-fades without abrupt edges. */
    function selectionOpacity(index) {
      const now = platform.now();
      let tween = selectionTweens.get(index);
      if (!tween) {
        tween = { from: 0, target: 0, startedAt: now };
        selectionTweens.set(index, tween);
      }
      const fraction = Math.min(1, Math.max(0, (now - tween.startedAt) / (tween.target ? 220 : 280)));
      const eased = fraction * fraction * (3 - 2 * fraction);
      const opacity = tween.from + (tween.target - tween.from) * eased;
      const target = selected === index ? 1 : 0;
      if (target !== tween.target) {
        tween.from = opacity;
        tween.target = target;
        tween.startedAt = now;
      }
      return opacity;
    }

    /** Preserves the fading selection outline through rotation while keeping held turns anchored to the pointer. */
    function drawAnimatedModule(index, x, y, unit, color, elevation, invalid, now, held) {
      const piece = level().pieces[index];
      const shape = puzzle.rotated(piece.cells, rotations[index]);
      const highlighted = held ? 0 : selectionOpacity(index);
      if (!rotationTween || rotationTween.index !== index) {
        drawShape(shape, x, y, unit, color, elevation, invalid, highlighted);
        return;
      }
      const fraction = Math.min(1, (now - rotationTween.startedAt) / 200);
      const eased = fraction * fraction * (3 - 2 * fraction);
      const angle = rotationTween.fromAngle + (rotationTween.targetAngle - rotationTween.fromAngle) * eased;
      const original = puzzle.dimensions(rotationTween.cells);
      const target = puzzle.dimensions(shape);
      ctx.save();
      if (held) {
        ctx.translate(x + rotationTween.toGrabX * unit, y + rotationTween.toGrabY * unit);
        ctx.rotate(angle);
        drawShape(rotationTween.cells, -rotationTween.fromGrabX * unit, -rotationTween.fromGrabY * unit,
          unit, color, elevation, invalid, highlighted);
      } else {
        ctx.translate(x + target.width * unit / 2, y + target.height * unit / 2);
        ctx.rotate(angle);
        drawShape(rotationTween.cells, -original.width * unit / 2, -original.height * unit / 2,
          unit, color, elevation, invalid, highlighted);
      }
      ctx.restore();
    }

    /** Resets state immediately but visibly returns every installed module to its own socket before enabling input. */
    function resetPanel() {
      const returning = placements.map((placement, index) => placement
        ? { index, placement: { ...placement }, rotation: rotations[index] } : null).filter(Boolean);
      loadLevel(current);
      resetTween = { returning, startedAt: platform.now() };
      play('hint');
    }

    function drawResetAnimation(now) {
      if (!resetTween) return;
      const fraction = Math.min(1, (now - resetTween.startedAt) / 340);
      const eased = fraction * fraction * (3 - 2 * fraction);
      const unit = layout.grid.width / level().size;
      ctx.save();
      ctx.globalAlpha *= Math.sin(fraction * Math.PI) * 0.7;
      ctx.shadowColor = '#badc71';
      ctx.shadowBlur = 12;
      panel(ctx, layout.grid.x, layout.grid.y + layout.grid.width * eased,
        layout.grid.width, 2, '#d9f697');
      ctx.restore();
      resetTween.returning.forEach(({ index, placement, rotation }) => {
        const card = cards.find((entry) => entry.index === index);
        if (!card) return;
        const piece = level().pieces[index];
        const shape = puzzle.rotated(piece.cells, rotation);
        const bounds = puzzle.dimensions(shape);
        const extent = Math.max(bounds.width, bounds.height);
        const endUnit = Math.min(layout.portrait ? 16 : 24,
          (card.width - 22) / extent, (card.height - 16) / extent);
        const startX = layout.grid.x + (placement.x + bounds.width / 2) * unit;
        const startY = layout.grid.y + (placement.y + bounds.height / 2) * unit;
        const endX = card.x + card.width / 2;
        const endY = card.y + card.height / 2;
        const scale = unit + (endUnit - unit) * eased;
        const turns = rotation > 2 ? 4 - rotation : -rotation;
        ctx.save();
        ctx.translate(startX + (endX - startX) * eased, startY + (endY - startY) * eased);
        ctx.rotate(turns * Math.PI / 2 * eased);
        drawShape(shape, -bounds.width * scale / 2, -bounds.height * scale / 2,
          scale, INSTALLED_COLORS[piece.color], (1 - eased) * 0.5, false);
        ctx.restore();
      });
    }

    /** Fades each overflow ribbon on the same schedule as its bars, retaining its extent during fade-out. */
    function drawOverflowPlume(key, x, y, total, gap, length, vertical, overflow) {
      const now = platform.now();
      let ribbon = overflowRibbons.get(key);
      if (!ribbon) {
        if (!overflow) return;
        ribbon = { from: 0, target: 1, startedAt: now, total };
        overflowRibbons.set(key, ribbon);
      }
      const duration = ribbon.target ? 280 : 380;
      const fraction = Math.min(1, Math.max(0, (now - ribbon.startedAt) / duration));
      const eased = fraction * fraction * (3 - 2 * fraction);
      const opacity = ribbon.from + (ribbon.target - ribbon.from) * eased;
      const targetOpacity = overflow ? 1 : 0;
      if (ribbon.target !== targetOpacity) {
        ribbon.from = opacity;
        ribbon.target = targetOpacity;
        ribbon.startedAt = now;
      }
      if (overflow) ribbon.total = total;
      if (!opacity) return;
      total = ribbon.total;
      const near = total * gap;
      const far = near + 80;
      const left = vertical ? x - length / 2 : x - far;
      const top = vertical ? y - far : y - length / 2;
      const width = vertical ? length : far - near;
      const height = vertical ? far - near : length;
      const gradient = vertical ? ctx.createLinearGradient(0, top, 0, top + height)
        : ctx.createLinearGradient(left, 0, left + width, 0);
      gradient.addColorStop(0, 'rgba(230, 45, 40, 0)');
      gradient.addColorStop(0.6, 'rgba(230, 45, 40, 0.23)');
      gradient.addColorStop(1, 'rgba(255, 70, 51, 0.55)');
      ctx.save();
      ctx.globalAlpha *= opacity;
      panel(ctx, left, top, width, height, gradient);
      ctx.restore();
    }

    /** Retargets each bar from its current opacity so rapid count changes never restart with a visual jump. */
    function updateIndicatorBars(key, count, target) {
      const now = platform.now();
      const transitions = indicatorBars.get(key) || [];
      indicatorBars.set(key, transitions);
      const length = Math.max(count, target, transitions.length);
      return Array.from({ length }, (_, index) => {
        const bar = transitions[index] || { from: 0, target: 0, startedAt: now };
        transitions[index] = bar;
        const fraction = Math.min(1, Math.max(0, (now - bar.startedAt) / (bar.target ? 280 : 380)));
        const eased = fraction * fraction * (3 - 2 * fraction);
        const opacity = bar.from + (bar.target - bar.from) * eased;
        const nextTarget = index < count ? 1 : 0;
        if (bar.target !== nextTarget) {
          bar.from = opacity;
          bar.target = nextTarget;
          bar.startedAt = now;
        }
        return opacity;
      });
    }

    /** Cross-fades solid counts and hollow targets; excess striped bars also fade instead of appearing or disappearing abruptly. */
    function drawIndicator(count, target, x, y, color, vertical, key) {
      const channel = COLORS[color];
      const overflow = count > target;
      const gap = layout.portrait ? 8 : 10;
      const thickness = layout.portrait ? 5 : 6;
      const length = level().colors > 1 ? 12 : 21;
      drawOverflowPlume(key, x, y, Math.max(count, target), gap, length, vertical, overflow);
      const barOpacities = updateIndicatorBars(key, count, target);
      if (progress.display === 'numbers') {
        ctx.save();
        if (overflow) {
          ctx.shadowColor = '#ff4c3b';
          ctx.shadowBlur = 10;
        }
        text(ctx, `${count}/${target}`, x, y, level().colors > 1 ? 14 : 16,
          overflow ? '#ff7963' : channel, 'center', 600);
        ctx.restore();
        return;
      }
      if (!target && !count && !barOpacities.some((opacity) => opacity > 0)) {
        panel(ctx, x - 3, y - 1, 6, 2, '#657148');
        return;
      }
      const outlines = ['#809132', '#487f83', '#916550'];
      for (let index = 0; index < barOpacities.length; index += 1) {
        const left = vertical ? x - length / 2 : x - (index + 1) * gap;
        const top = vertical ? y - (index + 1) * gap : y - length / 2;
        const width = vertical ? length : thickness;
        const height = vertical ? thickness : length;
        if (index >= target) {
          ctx.save();
          ctx.globalAlpha *= barOpacities[index];
          panel(ctx, left, top, width, height, channel);
          ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
          ctx.strokeStyle = '#4c471d';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let stripe = -height; stripe < width + height; stripe += 5) {
            ctx.moveTo(left + stripe, top + height);
            ctx.lineTo(left + stripe + height, top);
          }
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.save();
          const inheritedAlpha = ctx.globalAlpha;
          ctx.globalAlpha = inheritedAlpha * (1 - barOpacities[index]);
          panel(ctx, left, top, width, height, '#171f16', outlines[color]);
          ctx.globalAlpha = inheritedAlpha * barOpacities[index];
          panel(ctx, left, top, width, height, channel);
          ctx.restore();
        }
      }
    }
    /** Projects the free-moving module onto its nearest candidate cells for counters without changing its visual position. */
    function visualPlacements() {
      const visible = placements.map((placement, index) => drag && index === drag.index ? null : placement);
      if (drag) {
        const unit = layout.grid.width / level().size;
        const candidate = { x: Math.round((drag.x - layout.grid.x) / unit) || 0,
          y: Math.round((drag.y - layout.grid.y) / unit) || 0, rotation: rotations[drag.index] };
        if (puzzle.canDrop(level(), drag.index, candidate)) visible[drag.index] = candidate;
      }
      return visible;
    }

    /** Fades the installed layer down during dragging and restores it after release or cancellation. */
    function installedBrightness() {
      const now = platform.now();
      const fraction = Math.min(1, Math.max(0, (now - boardDimming.startedAt) / 280));
      const eased = fraction * fraction * (3 - 2 * fraction);
      const dimming = boardDimming.from + (boardDimming.target - boardDimming.from) * eased;
      const target = drag ? 1 : 0;
      if (boardDimming.target !== target) {
        boardDimming = { from: dimming, target, startedAt: now };
      }
      return 1 - dimming * 0.65;
    }

    /** Draws opaque installed modules with drag-dependent brightness; the bright carried module is painted separately. */
    function drawBoard() {
      const grid = layout.grid;
      const currentLevel = level();
      const unit = grid.width / currentLevel.size;
      const counts = puzzle.measure(currentLevel, visualPlacements());
      const errors = counts.invalidPieces;
      const brightness = installedBrightness();
      panel(ctx, grid.x - 5, grid.y - 5, grid.width + 10, grid.width + 10, '#0d151f', '#5b6b62');
      for (let row = 0; row < currentLevel.size; row += 1) {
        for (let column = 0; column < currentLevel.size; column += 1) {
          const x = grid.x + column * unit;
          const y = grid.y + row * unit;
          panel(ctx, x + 1, y + 1, unit - 2, unit - 2, '#17212c', '#2b3a49');
          ctx.strokeStyle = '#66758a38';
          ctx.lineWidth = 1.4;
          const q = unit * 0.16;
          const a = unit * 0.30;
          ctx.beginPath();
          [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([dx, dy]) => {
            ctx.moveTo(x + unit / 2 + dx * a, y + unit / 2 + dy * a);
            ctx.lineTo(x + unit / 2 + dx * q, y + unit / 2 + dy * q);
          });
          ctx.stroke();
        }
        for (let color = 0; color < currentLevel.colors; color += 1) {
          const offset = (color - (currentLevel.colors - 1) / 2) * 18;
          const columnX = grid.x + unit * (row + 0.5)
            + (progress.display === 'bars' ? offset : 0);
          const columnY = grid.y - 14
            - (progress.display === 'numbers' ? (currentLevel.colors - 1 - color) * 18 : 0);
          const rowX = grid.x - (progress.display === 'numbers' ? 24 : 12);
          const rowY = grid.y + unit * (row + 0.5) + offset;
          drawIndicator(counts.rows[color][row], currentLevel.rows[color][row], rowX, rowY,
            color, false, `row-${color}-${row}`);
          drawIndicator(counts.columns[color][row], currentLevel.columns[color][row], columnX, columnY,
            color, true, `column-${color}-${row}`);
        }
      }
      placements.forEach((placement, index) => {
        if (!placement || (drag && drag.index === index) || (settling && settling.index === index)) return;
        const piece = currentLevel.pieces[index];
        const baseColor = errors[index] ? invalidModuleColor(platform.now()) : INSTALLED_COLORS[piece.color];
        const packedColor = parseInt(baseColor.slice(1), 16);
        const channels = [16, 8, 0].map((shift) => Math.round(((packedColor >>> shift) & 255) * brightness));
        drawAnimatedModule(index, grid.x + placement.x * unit, grid.y + placement.y * unit, unit,
          `rgb(${channels.join(',')})`,
          false, errors[index], platform.now(), false);
      });
      drawHintOverlay(platform.now());
      return counts;
    }

    /** Cross-fades a single answer silhouette into a numbered, color-separated assembly guide. */
    function drawHintOverlay(now) {
      if (hint) hintVisual = hint;
      const shapeOpacity = presentationOpacity('hint-shape', hint && hint.stage === 'shape' && !drag, now);
      const assemblyOpacity = presentationOpacity('hint-assembly', hint && hint.stage === 'assembly' && !drag, now);
      if (!hintVisual) return;
      const grid = layout.grid;
      const unit = grid.width / level().size;
      const pulse = (1 - Math.cos(now * Math.PI * 2 / 1900)) / 2;
      if (shapeOpacity > 0) {
        const cells = [];
        hintVisual.solution.forEach((placement, index) => {
          puzzle.rotated(level().pieces[index].cells, placement.rotation)
            .forEach(([x, y]) => cells.push([x + placement.x, y + placement.y]));
        });
        ctx.save();
        ctx.globalAlpha *= shapeOpacity * (0.35 + pulse * 0.12);
        drawShape(cells, grid.x, grid.y, unit, '#e1ff81', false, false);
        ctx.restore();
      }
      if (assemblyOpacity > 0) {
        const guideColors = ['#ddff79', '#87dbea', '#ffb58c', '#c5b1ff', '#ffd973', '#f2a5ce'];
        hintVisual.solution.forEach((placement, index) => {
          const shape = puzzle.rotated(level().pieces[index].cells, placement.rotation);
          ctx.save();
          ctx.globalAlpha *= assemblyOpacity * 0.68;
          drawShape(shape, grid.x + placement.x * unit, grid.y + placement.y * unit,
            unit, guideColors[index], false, false);
          ctx.restore();
          ctx.save();
          ctx.globalAlpha *= assemblyOpacity;
          const labelX = grid.x + (placement.x + shape[0][0] + 0.5) * unit;
          const labelY = grid.y + (placement.y + shape[0][1] + 0.5) * unit;
          roundedPanel(ctx, labelX - 18, labelY - 14, 36, 28, 6, '#12202de6', guideColors[index]);
          text(ctx, String(index + 1).padStart(2, '0'), labelX, labelY, 16, guideColors[index], 'center', 600);
          ctx.restore();
        });
      }
    }

    /** Shows each module in a dedicated socket; picking one up leaves the socket empty until release. */
    function drawTray() {
      const tray = layout.tray;
      cards = [];
      const landscape = !layout.portrait;
      if (landscape) roundedPanel(ctx, tray.x - 14, tray.y - 17, 244, 431, 12, '#1c2836', '#36485d');
      text(ctx, '可用电路模块', tray.x, tray.y - (landscape ? 37 : 17), landscape ? 18 : 14, '#cbd7e5');
      level().pieces.forEach((piece, index) => {
        const x = tray.x + (index % tray.columns) * (tray.cellWidth + tray.gap);
        const y = tray.y + Math.floor(index / tray.columns) * (tray.cellHeight + tray.gap);
        const installed = Boolean(placements[index]);
        const moving = drag && drag.index === index;
        roundedPanel(ctx, x, y, tray.cellWidth, tray.cellHeight, 6, '#131e2a', '#35465a');
        ctx.save();
        ctx.globalAlpha *= selectionOpacity(index);
        ctx.strokeStyle = '#a6bc56';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, tray.cellWidth - 1, tray.cellHeight - 1);
        ctx.restore();
        ctx.strokeStyle = '#65705744';
        const corner = 9;
        ctx.beginPath();
        ctx.moveTo(x + corner, y + corner);
        ctx.lineTo(x + corner + 6, y + corner + 6);
        ctx.moveTo(x + tray.cellWidth - corner, y + tray.cellHeight - corner);
        ctx.lineTo(x + tray.cellWidth - corner - 6, y + tray.cellHeight - corner - 6);
        ctx.stroke();
        const returning = resetTween && resetTween.returning.some((entry) => entry.index === index);
        if (!installed && !moving && !returning) {
          const shape = puzzle.rotated(piece.cells, rotations[index]);
          const bounds = puzzle.dimensions(shape);
          const extent = Math.max(bounds.width, bounds.height);
          const unit = Math.min(landscape ? 24 : 16, (tray.cellWidth - 22) / extent,
            (tray.cellHeight - 16) / extent);
          drawAnimatedModule(index, x + (tray.cellWidth - bounds.width * unit) / 2,
            y + (tray.cellHeight - bounds.height * unit) / 2, unit,
            INSTALLED_COLORS[piece.color], false, false, platform.now(), false);
        }
        text(ctx, String(index + 1).padStart(2, '0'), x + 6, y + 11, 11, '#8fa3bb');
        if (installed && !moving) check(ctx, x + tray.cellWidth - 11, y + 10, '#819066');
        cards.push({ index, x, y, width: tray.cellWidth, height: tray.cellHeight });
      });
    }

    /** Gives overlapping or out-of-bounds modules a bright red breathing fill, including after placement. */
    function invalidModuleColor(now) {
      const pulse = (1 - Math.cos(now * Math.PI * 2 / 1900)) / 2;
      return `#${[175 + 80 * pulse, 65 + 90 * pulse, 48 + 80 * pulse]
        .map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
    }

    /** Keeps valid held modules steadily bright and eases onto cells after release; only geometry conflicts breathe red. */
    function drawDraggedModule(now) {
      const carried = drag || settling;
      if (!carried) return;
      const piece = level().pieces[carried.index];
      const unit = layout.grid.width / level().size;
      let x = carried.x;
      let y = carried.y;
      let elevation = 1;
      const invalid = Boolean(puzzle.moduleErrors(level(), drag ? visualPlacements() : placements)[carried.index]);
      const conflictColor = invalid ? invalidModuleColor(platform.now()) : null;
      let color = invalid ? conflictColor : piece.color === 0 ? '#f0ffa0' : COLORS[piece.color];
      if (!drag) {
        const elapsed = Math.min(1, (now - settling.startedAt) / settling.duration);
        const eased = 1 - (1 - elapsed) ** 3;
        const placement = placements[settling.index];
        x += (layout.grid.x + placement.x * unit - x) * eased;
        y += (layout.grid.y + placement.y * unit - y) * eased;
        elevation = 1 - eased;
        const destination = invalid ? conflictColor : INSTALLED_COLORS[piece.color];
        const from = parseInt(color.slice(1), 16);
        const to = parseInt(destination.slice(1), 16);
        const channels = [16, 8, 0].map((shift) => Math.round(((from >>> shift) & 255)
          + (((to >>> shift) & 255) - ((from >>> shift) & 255)) * eased));
        color = `rgb(${channels.join(',')})`;
        if (elapsed >= 1) settling = null;
      }
      drawAnimatedModule(carried.index, x, y, unit, color, elevation, invalid, now, true);
    }

    /** Keeps the large rotation target available to a second finger while showing whether a module is selected. */
    function drawRotateControl() {
      const box = layout.rotate;
      const enabled = (selected >= 0 || (gesture && gesture.kind === 'piece')) && !completedAt;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      if (layout.portrait) {
        button('rotate', '旋转', box.x, box.y, box.width, box.height, rotateSelected, true, enabled);
        ctx.save();
        ctx.translate(box.x + box.width - 13, cy);
        ctx.rotate(rotationControlAngle(platform.now()));
        text(ctx, '↻', 0, 0, 18, enabled ? '#202b18' : '#596879', 'center');
        ctx.restore();
      }
      else {
        ctx.beginPath();
        ctx.arc(cx, cy, box.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#1b2937';
        ctx.fill();
        ctx.strokeStyle = enabled ? '#d9f777' : '#46586b';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, box.width / 2 - 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#34475a';
        ctx.stroke();
        ctx.save();
        ctx.translate(cx, cy - 2);
        ctx.rotate(rotationControlAngle(platform.now()));
        text(ctx, '↻', 0, 0, 62, enabled ? '#efffc7' : '#8293a5', 'center');
        ctx.restore();
        text(ctx, '旋转模块', cx, cy + box.width / 2 + 22, 17, '#cfdae6', 'center', 600);
        hitButton('rotate', box.x, box.y, box.width, box.height, rotateSelected, enabled);
      }
    }

    /** Keeps graphical bars as the default and persists a user-selected numeric representation. */
    function drawDisplayToggle() {
      const box = layout.toggle;
      roundedPanel(ctx, box.x, box.y, box.width, box.height, 6, '#1b2734', '#354658');
      ['bars', 'numbers'].forEach((mode, index) => {
        const x = box.x + index * box.width / 2;
        const enabled = progress.display === mode;
        if (enabled) roundedPanel(ctx, x + 2, box.y + 2, box.width / 2 - 4, box.height - 4, 4, '#b8c6d6');
        text(ctx, index ? '数字' : '图形', x + box.width / 4, box.y + box.height / 2, 15,
          enabled ? '#16212d' : '#8e9eb1', 'center', enabled ? 600 : 400);
        hitButton(`display-${mode}`, x, box.y, box.width / 2, box.height, () => {
          progress.display = mode;
          persist();
        });
      });
    }

    /** Organizes the repair guide and actions on a slate terminal background, with a compact portrait reflow. */
    function drawMain(now) {
      const background = ctx.createLinearGradient(0, 0, layout.width, layout.height);
      background.addColorStop(0, '#1b2735');
      background.addColorStop(0.5, '#101823');
      background.addColorStop(1, '#151e2b');
      panel(ctx, 0, 0, layout.width, layout.height, background);
      ctx.strokeStyle = '#8fa4c00a';
      ctx.lineWidth = 1;
      for (let x = 0; x < layout.width; x += 54) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, layout.height); ctx.stroke();
      }
      if (layout.portrait) {
        text(ctx, '// 设备修复', 24, 34, 18, INK, 'left', 600);
        text(ctx, '源石电路模块', 24, 64, 12, '#9da98d');
        roundedPanel(ctx, 24, 98, 372, 62, 10, '#202e3e', '#3b4c60');
        panel(ctx, 24, 98, 3, 62, COLORS[0]);
        text(ctx, `Δ-V400${String(current + 1).padStart(2, '0')}`, 39, 119, 16, INK, 'left', 600);
        text(ctx, `${level().title} / ${level().size} × ${level().size}`, 39, 143, 10, '#99a68b');
        text(ctx, `${String(current + 1).padStart(2, '0')} / 18`, 380, 128, 18, '#d4dec6', 'right', 600);
        text(ctx, '拖拽元件到网格内完成修复', 24, 188, 13, INK);
        text(ctx, '点击选中 · 长按拖动 · 松手吸附', 24, 213, 12, '#9cafc4');
      } else {
        text(ctx, '// 设备修复', 80, 43, 25, INK, 'left', 600);
        text(ctx, `源石电路模块  ${current + 1} / 18`, 640, 65, 27, '#d7dfcc', 'center', 600);
        text(ctx, 'ORIGINIUM CIRCUIT / TRAINING TERMINAL', 640, 96, 11, '#8fa3bb', 'center');
        ctx.strokeStyle = '#7d93af40';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(352, 115); ctx.lineTo(920, 115);
        ctx.moveTo(352, 109); ctx.lineTo(352, 121);
        ctx.moveTo(920, 109); ctx.lineTo(920, 121);
        ctx.moveTo(352, 665); ctx.lineTo(510, 665);
        ctx.moveTo(751, 665); ctx.lineTo(920, 665);
        ctx.stroke();
        roundedPanel(ctx, 62, 96, 254, 606, 16, '#1c2938', '#36485e');
        panel(ctx, 84, 119, 3, 29, '#d9f777');
        text(ctx, '修复指引', 98, 126, 19, '#edf3fa', 'left', 600);
        text(ctx, `Δ-V400${String(current + 1).padStart(2, '0')}`, 98, 149, 11, '#8fa4bd');
        panel(ctx, 84, 169, 208, 1, '#35465a');
        text(ctx, '将模块拼入电路，匹配行列数量', 84, 195, 14, '#c6d3e2');
        roundedPanel(ctx, 84, 251, 24, 24, 5, '#304153');
        text(ctx, '01', 96, 263, 11, '#d9f777', 'center', 600);
        text(ctx, '点击选中，长按拖动', 118, 263, 15, '#c4d2e1');
        roundedPanel(ctx, 84, 287, 24, 24, 5, '#304153');
        text(ctx, '02', 96, 299, 11, '#d9f777', 'center', 600);
        text(ctx, '松手吸附，可反复调整', 118, 299, 15, '#c4d2e1');
        roundedPanel(ctx, 109, 503, 23, 24, 5, '#304153');
        text(ctx, 'R', 120.5, 515, 12, '#e4edf7', 'center', 600);
        text(ctx, '/ 右键 · 双指旋转', 142, 515, 13, '#9fb2c9');
        text(ctx, `${level().title} / ${level().colors} 路电荷`, 640, 621, 14, '#9eafc3', 'center');
      }
      const help = layout.help;
      text(ctx, '?', help.x + help.width / 2, help.y + help.height / 2, 19, '#8e9b7e', 'center');
      hitButton('help', help.x, help.y, help.width, help.height, () => { modal = 'help'; });
      drawSound();
      const counts = drawBoard();
      drawTray();
      drawRotateControl();
      const controls = [
        ['undo', '撤销', layout.undo, undo, history.length > 0 && !completedAt],
        ['restart', '↻  重置面板', layout.reset, () => { modal = 'restart'; }, !completedAt],
        ['hint', hint ? hint.stage === 'shape' ? '查看拼法' : '收起提示' : '答案形状', layout.hint,
          showHint, !completedAt],
      ];
      controls.forEach(([id, label, box, action, enabled]) => button(id,
        layout.portrait && id === 'restart' ? '重置' : label,
        box.x, box.y, box.width, box.height, action, false, enabled));
      drawDisplayToggle();
      const menu = layout.levels;
      if (!layout.portrait) roundedPanel(ctx, menu.x, menu.y, menu.width, menu.height, 7, '#233345', '#354b62');
      text(ctx, layout.portrait ? '关卡 →' : `任务档案  ${progress.completed.filter(Boolean).length} / 18  →`,
        menu.x + 10, menu.y + menu.height / 2, layout.portrait ? 12 : 14, '#b9c9db');
      hitButton('levels', menu.x, menu.y, menu.width, menu.height, () => { modal = 'levels'; });
      const over = counts.rows.some((row, color) => row.some((count, index) => count > level().rows[color][index]))
        || counts.columns.some((column, color) => column.some((count, index) => count > level().columns[color][index]));
      const warningOpacity = presentationOpacity('count-warning', over, now);
      if (warningOpacity > 0) {
        ctx.save();
        ctx.globalAlpha *= warningOpacity;
        text(ctx, '行列电荷超出目标', layout.grid.x + layout.grid.width / 2,
          layout.grid.y + layout.grid.width + 20, 14, '#f3a68c', 'center');
        ctx.restore();
      }
      const footerY = layout.height - 14;
      text(ctx, '终末地同人玩法练习 · 非官方', layout.width / 2, footerY, 9, '#65778e', 'center');
      if (sidebar) {
        const x = layout.portrait ? layout.width - 24 : layout.width - 62;
        const y = layout.portrait ? 899 : 651;
        text(ctx, fromSidebar ? '已从侧边栏返回' : '侧边栏复访 ↗', x, y, 10, '#788c64', 'right');
        hitButton('sidebar', x - 160, y - 14, 160, 28, () => platform.openSidebar((error) => {
          if (error) notify('侧边栏暂不可用，请稍后再试');
        }));
      }
    }

    /** Lays out the dialog body; the render coordinator animates its backdrop and translated hit targets. */
    function modalBase(title, subtitle, height) {
      const box = { x: (layout.width - 350) / 2, y: (layout.height - height) / 2, width: 350, height };
      roundedPanel(ctx, box.x, box.y, box.width, height, 14, '#202e3e', '#53677d');
      panel(ctx, box.x, box.y, box.width, 3, COLORS[0]);
      text(ctx, title, box.x + 175, box.y + 39, 22, INK, 'center', 600);
      text(ctx, subtitle, box.x + 175, box.y + 68, 10, '#a1b3c8', 'center');
      buttons = [];
      cards = [];
      return box;
    }

    /** Explains selection, held dragging, rotation, and independent color-count goals. */
    function drawHelp() {
      const box = modalBase('设备修复操作', 'DRAG / ROTATE / SNAP TO GRID', 480);
      drawShape([[0, 0], [0, 1], [1, 1]], box.x + 145, box.y + 102, 34, COLORS[0], true, false);
      const instructions = [
        '01  点击选中，长按拖动，松手对齐方格。',
        '02  按住鼠标时按 R 或右键可旋转。',
        '03  触屏拖动时，用另一指点旋转按钮。',
        '04  实心方条是当前值，空心方条待补齐。',
        '05  图形 / 数字可切换，所有颜色都需匹配。',
        '06  错误摆放会变红，可继续拖动调整。',
        '07  答案形状 → 查看拼法，分两级提示。',
      ];
      instructions.forEach((line, index) => text(ctx, line, box.x + 24, box.y + 215 + index * 29, 11, '#c1cdb5'));
      button('close', '开始修复 →', box.x + 24, box.y + 411, 302, 44, () => { modal = null; }, true);
    }

    /** Lists every original task while preserving sequential unlocks. */
    function drawLevels() {
      const box = modalBase('选择维修任务', '18 ORIGINAL PUZZLES / 3 SIGNAL CHANNELS', 590);
      const unlocked = Math.min(progress.completed.filter(Boolean).length, levels.length - 1);
      for (let chapter = 0; chapter < 3; chapter += 1) {
        const top = box.y + 106 + chapter * 132;
        text(ctx, `0${chapter + 1}  ${puzzle.CHAPTERS[chapter]}`, box.x + 23, top, 12, COLORS[chapter]);
        for (let offset = 0; offset < 6; offset += 1) {
          const index = chapter * 6 + offset;
          const x = box.x + 23 + (offset % 3) * 104;
          const y = top + 16 + Math.floor(offset / 3) * 47;
          const locked = index > unlocked;
          panel(ctx, x, y, 96, 40, index === current ? '#45502d' : '#182115', '#435238');
          text(ctx, locked ? '—' : String(index + 1).padStart(2, '0'), x + 48, y + 20, 16,
            locked ? '#536448' : INK, 'center', 600);
          if (progress.completed[index]) check(ctx, x + 80, y + 20, '#a9c78b');
          hitButton(`level-${index}`, x, y, 96, 40, () => {
            if (index === current) modal = null;
            else transitionLevel(index);
          }, !locked);
        }
      }
      button('close', '返回维修终端', box.x + 23, box.y + 526, 304, 43, () => { modal = null; }, true);
    }

    /** Resets all modules and their orientations without deleting completed campaign tasks. */
    function drawRestart() {
      const box = modalBase('重置全部面板？', '当前模块与方向恢复初始状态，已完成任务保留。', 228);
      button('cancel', '继续修复', box.x + 23, box.y + 145, 145, 47, () => { modal = null; }, false);
      button('confirm', '确认重置', box.x + 182, box.y + 145, 145, 47, resetPanel, true);
    }

    /** Expands a white square from inside the board; its inner edge clears the board before the glow fades away. */
    function drawCompletionPulse(elapsed) {
      if (elapsed < 0 || elapsed >= 820) return;
      const fraction = elapsed / 820;
      const growth = Math.pow(fraction, 1.25) * 110;
      const thickness = 12 - fraction * 8;
      const side = layout.grid.width - 12 + growth * 2;
      const left = layout.grid.x + (layout.grid.width - side) / 2;
      const top = layout.grid.y + (layout.grid.width - side) / 2;
      const innerClearance = growth - 6 - thickness / 2;
      const fade = Math.max(0, Math.min(1, innerClearance / 85));
      const opacity = 1 - fade * fade * (3 - 2 * fade);
      ctx.save();
      ctx.globalAlpha *= opacity;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 26;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = thickness;
      ctx.strokeRect(left, top, side, side);
      ctx.globalAlpha *= 0.3;
      ctx.lineWidth = thickness + 10;
      ctx.shadowBlur = 38;
      ctx.strokeRect(left, top, side, side);
      ctx.restore();
    }

    /** Opens a glowing yellow strip from its center, revealing clipped text and detached end bars on the same motion curve. */
    function drawCompletionBanner(label, cx, cy, width, height, progress, flicker, secondary) {
      if (progress <= 0) return;
      const remaining = progress - 1;
      const expanded = 1 + 2.2 * remaining ** 3 + 1.2 * remaining ** 2;
      const visibleWidth = 3 + (width - 3) * expanded;
      const left = cx - visibleWidth / 2;
      const top = cy - height / 2;
      const color = secondary ? '#d8e79a' : '#f5ff3d';
      ctx.save();
      ctx.globalAlpha *= Math.min(1, progress * 5);
      ctx.shadowColor = color;
      ctx.shadowBlur = secondary ? 12 : 24;
      panel(ctx, left, top, visibleWidth, height, secondary ? '#27321d' : color, secondary ? color : undefined);
      const railLength = (height > 45 ? 64 : 16) * expanded;
      const gap = (height > 45 ? 22 : 9) * expanded;
      panel(ctx, left - gap - railLength, cy - 1.5, railLength, 3, color);
      panel(ctx, left + visibleWidth + gap, cy - 1.5, railLength, 3, color);
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.rect(left, top, visibleWidth, height);
      ctx.clip();
      ctx.globalAlpha *= flicker;
      text(ctx, label, cx, cy, height > 45 ? 24 : 15, secondary ? '#eff7ca' : '#18200c', 'center', 600);
      ctx.restore();
    }

    /** Plays the repair pulse, dimming, expanding banner, and finite text flicker before enabling continuation. */
    function drawWin(now) {
      const elapsed = Math.max(0, now - completedAt);
      const clamp = (fraction) => Math.max(0, Math.min(1, fraction));
      const final = current === levels.length - 1;
      buttons = [];
      cards = [];
      drawCompletionPulse(elapsed);
      const dim = clamp((elapsed - 180) / 520);
      ctx.save();
      ctx.globalAlpha *= dim * dim * (3 - 2 * dim) * 0.78;
      panel(ctx, 0, 0, layout.width, layout.height, '#020509');
      ctx.restore();
      const cx = layout.width / 2;
      const cy = layout.height / 2;
      const bannerProgress = clamp((elapsed - 330) / 650);
      const flashes = [0.15, 1, 0.35, 0.9, 0.1, 1, 0.55, 1];
      const flicker = elapsed >= 980 ? 1 : flashes[Math.floor(Math.max(0, elapsed - 420) / 60) % flashes.length];
      const bannerWidth = layout.portrait ? 220 : 320;
      drawCompletionBanner(final ? '全部电路已修复' : '模块已修复', cx, cy, bannerWidth, 52,
        bannerProgress, flicker, false);
      const captionOpacity = clamp((elapsed - 980) / 300);
      ctx.save();
      ctx.globalAlpha *= captionOpacity;
      text(ctx, '修复完成 · 点击下方选项继续', cx, cy + 52, 14, '#e6edc8', 'center');
      ctx.restore();
      const gap = layout.portrait ? 60 : 68;
      const actionWidth = layout.portrait ? 140 : 160;
      const actionY = cy + 108;
      const nextX = cx - (actionWidth + gap) / 2;
      const replayX = cx + (actionWidth + gap) / 2;
      const nextFlicker = elapsed >= 1380 ? 1
        : flashes[Math.floor(Math.max(0, elapsed - 1030) / 50) % flashes.length];
      const replayFlicker = elapsed >= 1470 ? 1
        : flashes[Math.floor(Math.max(0, elapsed - 1120) / 50) % flashes.length];
      drawCompletionBanner(final ? '查看任务档案' : '点击继续 →', nextX, actionY, actionWidth, 40,
        clamp((elapsed - 1030) / 350), nextFlicker, false);
      drawCompletionBanner('重新挑战', replayX, actionY, actionWidth, 40,
        clamp((elapsed - 1120) / 350), replayFlicker, true);
      if (elapsed < COMPLETION_READY_MS) return;
      hitButton('next', nextX - actionWidth / 2, actionY - 20, actionWidth, 40, () => {
        if (final) modal = 'levels';
        else transitionLevel(current + 1);
      });
      hitButton('replay', replayX - actionWidth / 2, actionY - 20, actionWidth, 40, () => transitionLevel(current));
    }
    /** Fades scene entrances, dialogs, changing notices, and their exits while keeping gameplay state independent. */
    function render(now) {
      if (levelTransition && now - levelTransition.startedAt >= 220) loadLevel(levelTransition.index);
      if (rotationTween && now - rotationTween.startedAt >= 200) rotationTween = null;
      if (resetTween && now - resetTween.startedAt >= 340) resetTween = null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      panel(ctx, 0, 0, platform.canvas.width, platform.canvas.height, '#0e1620');
      ctx.setTransform(pixelRatio * transform.scale, 0, 0, pixelRatio * transform.scale,
        pixelRatio * transform.x, pixelRatio * transform.y);
      buttons = [];
      ctx.save();
      const entrance = Math.min(1, Math.max(0, (now - interfaceStartedAt) / 320));
      ctx.globalAlpha = entrance * entrance * (3 - 2 * entrance);
      if (levelTransition) {
        const exit = Math.min(1, Math.max(0, (now - levelTransition.startedAt) / 220));
        ctx.globalAlpha *= 1 - exit * exit * (3 - 2 * exit);
      }
      drawMain(now);
      drawResetAnimation(now);
      drawDraggedModule(now);
      ctx.restore();
      if (completedAt && !modal && !levelTransition) modal = 'win';
      const mainButtons = buttons;
      const mainCards = cards;
      let modalButtons = [];
      const completionOpacity = presentationOpacity('completion-exit', modal === 'win', now);
      if (completedAt && (modal === 'win' || completionOpacity > 0)) {
        ctx.save();
        ctx.globalAlpha = modal === 'win' ? 1 : completionOpacity;
        drawWin(now);
        ctx.restore();
        if (modal === 'win') modalButtons = buttons;
      }
      for (const [name, draw] of [['help', drawHelp], ['levels', drawLevels], ['restart', drawRestart]]) {
        const opacity = presentationOpacity(`modal-${name}`, modal === name, now);
        if (modal !== name && opacity === 0) continue;
        const offsetY = (1 - opacity) * 16;
        ctx.save();
        ctx.globalAlpha = opacity;
        panel(ctx, 0, 0, layout.width, layout.height, '#060c15c9');
        ctx.translate(0, offsetY);
        labelScope = name;
        draw();
        labelScope = 'main';
        ctx.restore();
        if (modal === name) modalButtons = buttons.map((entry) => ({ ...entry, y: entry.y + offsetY }));
      }
      buttons = modal ? modalButtons : mainButtons;
      cards = modal ? [] : mainCards;
      retiringToasts = retiringToasts.filter((notice) => now < notice.until);
      const notices = retiringToasts.concat(toast ? [{ message: toast, startedAt: toastStartedAt, until: toastUntil }] : []);
      for (const notice of notices) {
        if (now >= notice.until) continue;
        const opacity = Math.max(0, Math.min(1, (now - notice.startedAt) / 180, (notice.until - now) / 220));
        const width = Math.min(430, layout.width - 32);
        const x = (layout.width - width) / 2;
        const y = (layout.portrait ? 171 : 122) - (1 - opacity) * 8;
        ctx.save();
        ctx.globalAlpha = opacity;
        roundedPanel(ctx, x, y, width, 32, 7, '#d9ecad', '#e9fac9');
        text(ctx, notice.message, layout.width / 2, y + 16, 12, '#202c16', 'center', 600);
        ctx.restore();
      }
    }

    /** Cancels transient manipulation while preserving the committed footprint and its orientation. */
    function cancelGesture() {
      if (gesture && gesture.kind === 'piece') rotations[gesture.index] = gesture.originalRotation;
      rotationTween = null;
      gesture = null;
      drag = null;
    }

    /** Switches layout by aspect ratio and fits all controls inside the current native safe area. */
    function resize() {
      cancelGesture();
      settling = null;
      const viewport = platform.viewport();
      pixelRatio = viewport.pixelRatio;
      layout = createLayout(viewport.width < viewport.height);
      platform.canvas.width = Math.round(viewport.width * viewport.pixelRatio);
      platform.canvas.height = Math.round(viewport.height * viewport.pixelRatio);
      const availableHeight = viewport.height - viewport.top - viewport.bottom;
      const left = viewport.left || 0;
      const availableWidth = viewport.width - left - (viewport.right || 0);
      const scale = Math.min(availableWidth / layout.width, availableHeight / layout.height);
      transform = { scale, x: left + (availableWidth - layout.width * scale) / 2,
        y: viewport.top + (availableHeight - layout.height * scale) / 2 };
      render(platform.now());
    }

    function within(point, rectangle) {
      return point.x >= rectangle.x && point.x <= rectangle.x + rectangle.width
        && point.y >= rectangle.y && point.y <= rectangle.y + rectangle.height;
    }

    function boardCell(point) {
      const grid = layout.grid;
      if (!within(point, { ...grid, height: grid.width })) return null;
      const unit = grid.width / level().size;
      const x = Math.floor((point.x - grid.x) / unit);
      const y = Math.floor((point.y - grid.y) / unit);
      return x < level().size && y < level().size ? { x, y } : null;
    }

    /** Tracks continuous pointer movement without grid quantization while the primary contact is held. */
    function updateDrag(point) {
      if (!gesture || gesture.kind !== 'piece') return;
      gesture.point = point;
      const grid = layout.grid;
      const unit = grid.width / level().size;
      drag = { index: gesture.index, x: point.x - gesture.grabX * unit,
        y: point.y - gesture.grabY * unit };
    }

    /** Lifts a selected module after a short hold even when the pointer has not moved. */
    function activateHeldDrag(now) {
      if (!gesture || gesture.kind !== 'piece' || gesture.dragging || now - gesture.startedAt < 300) return;
      gesture.dragging = true;
      hint = null;
      updateDrag(gesture.point);
    }

    /** Selects on tap, lifts on hold or deliberate movement, and preserves primary ownership during second-finger rotation. */
    function onPointer(phase, screenPoint) {
      if (!active || destroyed || resetTween || levelTransition) return;
      const point = { id: screenPoint.id, x: (screenPoint.x - transform.x) / transform.scale,
        y: (screenPoint.y - transform.y) / transform.scale };
      if (phase === 'start') {
        if (gesture) {
          if (gesture.kind === 'piece' && gesture.id !== point.id && within(point, layout.rotate)) {
            rotateSelected();
            render(platform.now());
          }
          return;
        }
        settling = null;
        const target = buttons.slice().reverse().find((entry) => within(point, entry));
        if (target) gesture = { id: point.id, start: point, target, kind: 'button' };
        else if (!modal && !completedAt) {
          const card = cards.find((entry) => within(point, entry));
          const cell = boardCell(point);
          const owner = cell ? puzzle.measure(level(), placements).owners[cell.y * level().size + cell.x] : -1;
          const index = card ? card.index : owner;
          if (index >= 0) {
            rotationTween = null;
            const shape = puzzle.rotated(level().pieces[index].cells, rotations[index]);
            const bounds = puzzle.dimensions(shape);
            const unit = layout.grid.width / level().size;
            selected = index;
            gesture = { id: point.id, start: point, point, kind: 'piece', index, dragging: false,
              startedAt: platform.now(),
              originalRotation: rotations[index],
              grabX: card ? bounds.width / 2 : (point.x - layout.grid.x) / unit - placements[index].x,
              grabY: card ? bounds.height / 2 : (point.y - layout.grid.y) / unit - placements[index].y };
          } else if (cell) gesture = { id: point.id, start: point, kind: 'board' };
        }
        render(platform.now());
        return;
      }
      if (!gesture || gesture.id !== point.id) return;
      const distance = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y);
      if (phase === 'move') {
        if (gesture.kind === 'piece') gesture.point = point;
        if (gesture.kind === 'piece' && (gesture.dragging || distance > 6)) {
          gesture.dragging = true;
          hint = null;
          updateDrag(point);
        }
        render(platform.now());
        return;
      }
      if (phase === 'cancel') {
        cancelGesture();
        announce();
        render(platform.now());
        return;
      }
      if (gesture.kind === 'piece' && gesture.dragging) updateDrag(point);
      const finished = gesture;
      gesture = null;
      if (finished.kind === 'button' && distance < 14 && within(point, finished.target)) finished.target.action();
      else if (finished.kind === 'piece') {
        if (finished.dragging && drag) {
          const tray = layout.tray;
          const rows = Math.ceil(level().pieces.length / tray.columns);
          const trayBounds = { x: tray.x - 10, y: tray.y - 10,
            width: tray.columns * (tray.cellWidth + tray.gap),
            height: rows * (tray.cellHeight + tray.gap) };
          const unit = layout.grid.width / level().size;
          const placement = { x: Math.round((drag.x - layout.grid.x) / unit) || 0,
            y: Math.round((drag.y - layout.grid.y) / unit) || 0,
            rotation: rotations[finished.index] };
          if (within(point, trayBounds)) takeBack(finished.index);
          else if (puzzle.canDrop(level(), finished.index, placement)) {
            const startedAt = platform.now();
            const rotationRemaining = rotationTween && rotationTween.index === finished.index
              ? Math.max(0, 200 - (startedAt - rotationTween.startedAt)) : 0;
            const from = { index: finished.index, x: drag.x, y: drag.y, startedAt,
              duration: Math.max(180, rotationRemaining) };
            if (place(finished.index, placement)) settling = from;
          } else rotations[finished.index] = finished.originalRotation;
        }
      } else if (finished.kind === 'board' && distance < 14 && selected >= 0) {
        const cell = boardCell(point);
        if (cell) place(selected, { ...cell, rotation: rotations[selected] });
      }
      drag = null;
      announce();
      render(platform.now());
    }

    /** Allows R or right-click rotation during a held drag, plus desktop selection and undo shortcuts. */
    function onKey(key) {
      if (!active || destroyed || resetTween || levelTransition) return;
      if (!gesture) settling = null;
      if (key === 'Escape' && gesture) cancelGesture();
      else if (key === 'Escape' && modal && modal !== 'win') modal = null;
      else if (!modal && !completedAt) {
        if (key.toLowerCase() === 'r') rotateSelected();
        if (key.toLowerCase() === 'z' && !gesture) undo();
        if (key.toLowerCase() === 'h' && !gesture) showHint();
        if (!gesture && /^[1-6]$/.test(key) && Number(key) <= level().pieces.length) takeBack(Number(key) - 1);
      }
      render(platform.now());
    }

    /** Cancels uncommitted drags before saving on hide, then resumes with the latest sidebar launch information. */
    function onVisibility(visible, launch) {
      if (destroyed) return;
      cancelGesture();
      settling = null;
      resetTween = null;
      if (!visible) {
        active = false;
        platform.cancelFrame(frame);
        platform.pauseAudio();
        persist();
      } else {
        fromSidebar = Boolean(launch && launch.launch_from === 'homepage' && launch.location === 'sidebar_card');
        if (!active) { active = true; resize(); tick(); }
      }
    }

    /** Paints on every host animation frame so rotations follow display refresh; hidden games stop requesting frames. */
    function tick() {
      if (!active || destroyed) return;
      const now = platform.now();
      activateHeldDrag(now);
      render(now);
      frame = platform.requestFrame(tick);
    }
    if (puzzle.isSolved(level(), placements)) {
      completedAt = platform.now();
      progress.completed[current] = true;
    }
    unsubscribers.push(platform.onPointer(onPointer));
    unsubscribers.push(platform.onVisibility(onVisibility));
    unsubscribers.push(platform.onResize(resize));
    if (platform.onKey) unsubscribers.push(platform.onKey(onKey));
    if (platform.onRotate) unsubscribers.push(platform.onRotate(() => onKey('r')));
    platform.checkSidebar((supported) => { if (!destroyed) sidebar = supported; });
    resize();
    announce();
    tick();

    return {
      /** Exposes copied UI state for host integrations and regression checks, without mutable game references. */
      getSnapshot() {
        return { current, selected, placements: placements.map((placement) => placement ? { ...placement } : null),
          rotations: rotations.slice(), completed: progress.completed.slice(), modal, toast,
          hint: hint ? { stage: hint.stage, solution: hint.solution.map((placement) => ({ ...placement })),
            startedAt: hint.startedAt } : null,
          rotationControlAngle: rotationControlAngle(platform.now()),
          counts: puzzle.measure(level(), visualPlacements()),
          drag: drag ? { ...drag } : null,
          settling: settling ? { ...settling } : null,
          rotating: rotationTween ? { index: rotationTween.index, startedAt: rotationTween.startedAt,
            fromAngle: rotationTween.fromAngle, targetAngle: rotationTween.targetAngle } : null,
          resetting: Boolean(resetTween),
          display: progress.display, layout: JSON.parse(JSON.stringify(layout)), transform: { ...transform },
          buttons: buttons.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
          cards: cards.map((card) => ({ ...card })) };
      },
      /** Persists and removes platform listeners, audio instances, and pending animation work. */
      destroy() {
        cancelGesture();
        settling = null;
        persist();
        destroyed = true;
        active = false;
        platform.cancelFrame(frame);
        unsubscribers.forEach((unsubscribe) => { if (unsubscribe) unsubscribe(); });
        platform.destroy();
      },
    };
  }

  return { createGame };
});
