'use strict';

const STORAGE_KEY = 'endfield-circuit.progress.v1';

/** Adapts the native tt runtime without introducing DOM, network, or browser dependencies. */
function createPlatform(api) {
  let visible = true;
  let launch = {};
  const visibilityListeners = new Set();
  const sounds = new Map();
  const removers = [];
  const canvas = api.createCanvas();

  /** Captures every foreground launch immediately, including warm returns from the sidebar. */
  function handleShow(options) {
    visible = true;
    launch = options || {};
    visibilityListeners.forEach((listener) => listener(true, launch));
  }

  /** Suspends playback and notifies the game before the native host moves into the background. */
  function handleHide() {
    visible = false;
    visibilityListeners.forEach((listener) => listener(false, launch));
  }

  api.onShow(handleShow);
  api.onHide(handleHide);
  removers.push(() => {
    if (api.offShow) api.offShow(handleShow);
    if (api.offHide) api.offHide(handleHide);
  });

  return {
    canvas,
    now: () => Date.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),

    /** Reserves native safe areas and caps backing pixels to limit mobile memory usage. */
    viewport() {
      const system = api.getSystemInfoSync();
      const safe = system.safeArea || { top: 0, bottom: system.screenHeight };
      return {
        width: system.windowWidth,
        height: system.windowHeight,
        pixelRatio: Math.min(system.pixelRatio || 1, 2),
        top: Math.max(0, Math.min(safe.top || 0, 80)),
        bottom: Math.max(0, Math.min((system.screenHeight || system.windowHeight) - safe.bottom || 0, 48)),
        left: Math.max(0, Math.min(safe.left || 0, 80)),
        right: Math.max(0, Math.min((system.screenWidth || system.windowWidth) - safe.right || 0, 80)),
      };
    },

    /** Reads this game's storage only; unreadable data is reported so the UI can explain recovery. */
    load() {
      try {
        if (api.getStorageInfoSync && !api.getStorageInfoSync().keys.includes(STORAGE_KEY)) {
          return { data: null };
        }
        return { data: api.getStorageSync(STORAGE_KEY) || null };
      } catch (error) {
        console.warn('电路修复：读取进度失败', error);
        return { data: null, error: true };
      }
    },

    /** Writes a single versioned save record and returns failures to the gameplay UI. */
    save(progress) {
      try {
        api.setStorageSync(STORAGE_KEY, progress);
        return null;
      } catch (error) {
        console.warn('电路修复：保存进度失败', error);
        return error;
      }
    },

    /** Reuses short local audio clips; decoding errors are reported once per clip. */
    play(name) {
      if (!api.createInnerAudioContext) return;
      if (!sounds.has(name)) {
        const sound = api.createInnerAudioContext();
        sound.src = `assets/${name}.wav`;
        sound.volume = name === 'win' ? 0.45 : 0.3;
        let reported = false;
        sound.onError((error) => {
          if (!reported) console.warn(`电路修复：${name} 音效播放失败`, error);
          reported = true;
        });
        sounds.set(name, sound);
      }
      const sound = sounds.get(name);
      sound.stop();
      sound.play();
    },

    pauseAudio() {
      sounds.forEach((sound) => sound.stop());
    },

    /** Uses changedTouches so secondary fingers cannot incorrectly release the primary tap. */
    onPointer(listener) {
      const bind = (phase) => (event) => {
        const touches = event.changedTouches || [];
        touches.forEach((touch) => listener(phase, {
          id: touch.identifier === undefined ? 0 : touch.identifier,
          x: touch.clientX === undefined ? touch.x : touch.clientX,
          y: touch.clientY === undefined ? touch.y : touch.clientY,
        }));
      };
      const start = bind('start');
      const move = bind('move');
      const end = bind('end');
      const cancel = bind('cancel');
      api.onTouchStart(start);
      api.onTouchMove(move);
      api.onTouchEnd(end);
      api.onTouchCancel(cancel);
      return () => {
        api.offTouchStart(start);
        api.offTouchMove(move);
        api.offTouchEnd(end);
        api.offTouchCancel(cancel);
      };
    },

    onVisibility(listener) {
      visibilityListeners.add(listener);
      listener(visible, launch);
      return () => visibilityListeners.delete(listener);
    },

    onResize(listener) {
      if (!api.onWindowResize) return () => {};
      api.onWindowResize(listener);
      return () => { if (api.offWindowResize) api.offWindowResize(listener); };
    },

    /** Shows the revisit entry only after the current host confirms sidebar support. */
    checkSidebar(callback) {
      if (!api.checkScene) return callback(false);
      api.checkScene({ scene: 'sidebar',
        success: (response) => callback(response.isExist === true),
        fail: () => callback(false),
      });
    },

    openSidebar(callback) {
      api.navigateToScene({ scene: 'sidebar', success: () => callback(null), fail: callback });
    },

    /** Removes native lifecycle listeners and destroys audio instances when the owner exits. */
    destroy() {
      removers.forEach((remove) => remove());
      visibilityListeners.clear();
      sounds.forEach((sound) => sound.destroy());
      sounds.clear();
    },
  };
}

module.exports = { createPlatform };
