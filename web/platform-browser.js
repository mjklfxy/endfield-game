(function () {
  'use strict';

  const canvas = document.getElementById('game');
  const audio = new Map();
  const cleanup = [];
  const storageKey = 'endfield-circuit.preview.progress.v1';

  function listen(target, event, listener, options) {
    target.addEventListener(event, listener, options);
    return () => target.removeEventListener(event, listener, options);
  }

  /** Uses the same game implementation as Douyin; browser-only APIs stay in this preview adapter. */
  const platform = {
    canvas,
    now: () => Date.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    viewport() {
      const bounds = canvas.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2), top: 0, bottom: 0 };
    },
    load() {
      try {
        return { data: JSON.parse(localStorage.getItem(storageKey) || 'null') };
      } catch (error) {
        console.warn('电路修复：浏览器存档读取失败', error);
        return { data: null, error: true };
      }
    },
    save(progress) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(progress));
        return null;
      } catch (error) {
        console.warn('电路修复：浏览器存档写入失败', error);
        return error;
      }
    },
    play(name) {
      if (!audio.has(name)) {
        const sound = new Audio(`./game/assets/${name}.wav`);
        sound.volume = name === 'win' ? 0.45 : 0.3;
        audio.set(name, sound);
      }
      const sound = audio.get(name);
      sound.currentTime = 0;
      sound.play().catch((error) => {
        if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') {
          console.warn('电路修复：音效不可用', error);
        }
      });
    },
    pauseAudio() { audio.forEach((sound) => sound.pause()); },
    onPointer(callback) {
      const bind = (phase) => (event) => {
        if (phase === 'start' && event.button !== 0) return;
        if (phase === 'end' && event.button !== 0) return;
        if (phase === 'start') {
          canvas.setPointerCapture(event.pointerId);
          canvas.focus({ preventScroll: true });
        }
        const bounds = canvas.getBoundingClientRect();
        callback(phase, { id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      };
      const removers = [listen(canvas, 'pointerdown', bind('start')),
        listen(canvas, 'pointermove', bind('move')), listen(canvas, 'pointerup', bind('end')),
        listen(canvas, 'pointercancel', bind('cancel'))];
      return () => removers.forEach((remove) => remove());
    },
    onKey(callback) {
      return listen(canvas, 'keydown', (event) => {
        if (['Escape', 'h', 'H', 'z', 'Z', 'r', 'R', '1', '2', '3', '4', '5', '6'].includes(event.key)) {
          event.preventDefault();
          callback(event.key);
        }
      });
    },
    /** Right-click rotates the held module without releasing the primary pointer capture. */
    onRotate(callback) {
      return listen(canvas, 'contextmenu', (event) => {
        event.preventDefault();
        callback();
      });
    },
    onVisibility(callback) {
      return listen(document, 'visibilitychange', () => callback(!document.hidden, {}));
    },
    onResize(callback) {
      const observer = new ResizeObserver(callback);
      observer.observe(canvas);
      return () => observer.disconnect();
    },
    checkSidebar(callback) { callback(false); },
    openSidebar(callback) { callback(new Error('Douyin sidebar is unavailable in browser preview')); },
    announce(message) { document.getElementById('status').textContent = message; },
    destroy() {
      audio.forEach((sound) => { sound.pause(); sound.src = ''; });
      audio.clear();
      cleanup.forEach((remove) => remove());
    },
  };

  const game = window.CircuitApp.createGame(platform);
  cleanup.push(listen(window, 'pagehide', (event) => {
    if (!event.persisted) game.destroy();
  }));
})();
