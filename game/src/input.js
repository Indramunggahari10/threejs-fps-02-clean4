// Input: keyboard state, mouse look through pointer lock, and the action keys
// the game reads each fixed step. Pointer lock is requested on click when the
// match is live; headless and shot modes run without it. All key handling is one
// place so the sim never reads the DOM directly.
export function createInput(canvas) {
  const keys = new Set();
  const state = {
    forward: false,
    back: false,
    left: false,
    right: false,
    crouch: false,
    jump: false,
    sprint: false,
    fire: false,
    reload: false,
    use: false,
    grenade: false,
    buy: false,
    slot1: false,
    slot2: false,
    slot3: false,
    mouseDX: 0,
    mouseDY: 0,
    locked: false,
  };

  const KEYMAP = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    KeyC: 'crouch', ControlLeft: 'crouch',
    Space: 'jump',
    ShiftLeft: 'sprint', ShiftRight: 'sprint',
    KeyR: 'reload',
    KeyE: 'use',
    KeyG: 'grenade',
    KeyB: 'buy',
    Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3',
  };

  function onKeyDown(event) {
    if (event.repeat) return;
    keys.add(event.code);
    const action = KEYMAP[event.code];
    if (action) state[action] = true;
    if (event.code === 'Space') event.preventDefault();
  }

  function onKeyUp(event) {
    keys.delete(event.code);
    const action = KEYMAP[event.code];
    if (action) state[action] = false;
  }

  function onMouseMove(event) {
    if (!state.locked) return;
    state.mouseDX += event.movementX;
    state.mouseDY += event.movementY;
  }

  function onMouseDown(event) {
    if (event.button === 0) state.fire = true;
  }

  function onMouseUp(event) {
    if (event.button === 0) state.fire = false;
  }

  function onLockChange() {
    state.locked = document.pointerLockElement === canvas;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChange);

  function requestLock() {
    if (!state.locked && canvas.requestPointerLock) {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => { /* headless or denied: play without lock */ });
      } catch {
        /* pointer lock unavailable; mouse look stays off */
      }
    }
  }

  // Consume the accumulated mouse delta for this step, then zero it.
  function consumeMouse() {
    const dx = state.mouseDX;
    const dy = state.mouseDY;
    state.mouseDX = 0;
    state.mouseDY = 0;
    return { dx, dy };
  }

  // Edge-triggered actions are cleared by the sim after it reads them once.
  // `use` is NOT an edge: planting and defusing need E held down for seconds.
  function clearEdges() {
    state.reload = false;
    state.grenade = false;
    state.buy = false;
    state.jump = false;
    state.slot1 = false;
    state.slot2 = false;
    state.slot3 = false;
  }

  return { state, requestLock, consumeMouse, clearEdges };
}
