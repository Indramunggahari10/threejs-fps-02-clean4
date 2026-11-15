// Weapons: four guns and a flashbang, each with its own damage, fire rate,
// spread and recoil character. Spread grows as you fire (bloom) and punishes
// firing on the move; standing still and crouching pay. The viewmodel rig is one
// small group parented to the camera, kicked back by recoil and flashed on fire.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 2.0,
    rpm: 340, mag: 12, reserve: 48, reloadTime: 1.4, spread: 0.011,
    moveSpread: 0.028, bloomPerShot: 0.004, bloomMax: 0.05, recoil: 0.011,
    auto: false, range: 42,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', price: 1500, damage: 19, headMult: 2.0,
    rpm: 750, mag: 28, reserve: 84, reloadTime: 2.0, spread: 0.02,
    moveSpread: 0.04, bloomPerShot: 0.005, bloomMax: 0.07, recoil: 0.009,
    auto: true, range: 34,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', price: 2700, damage: 34, headMult: 2.2,
    rpm: 600, mag: 25, reserve: 75, reloadTime: 2.4, spread: 0.008,
    moveSpread: 0.034, bloomPerShot: 0.006, bloomMax: 0.06, recoil: 0.014,
    auto: true, range: 60,
  },
  marksman: {
    id: 'marksman', name: 'DMR-12 Lancet', price: 4200, damage: 72, headMult: 2.5,
    rpm: 72, mag: 5, reserve: 20, reloadTime: 3.0, spread: 0.002,
    moveSpread: 0.05, bloomPerShot: 0.02, bloomMax: 0.05, recoil: 0.05,
    auto: false, range: 90,
  },
};

export const GRENADE_PRICE = 200;
export const ARMOR_PRICE = 650;
export const ARMOR_VALUE = 50;

export function createWeaponState(weaponId) {
  const def = WEAPONS[weaponId];
  return {
    id: weaponId,
    def,
    inMag: def.mag,
    reserve: def.reserve,
    reloading: 0,
    lastShotAt: -10,
    bloom: 0,
    triggerHeld: false,
  };
}

// Current spread in radians: base, plus movement, plus bloom, less when crouched.
export function spreadFor(wstate, speed, crouched, airborne) {
  const def = wstate.def;
  let spread = def.spread + wstate.bloom;
  if (speed > 0.5) spread += def.moveSpread * Math.min(1, speed / 5);
  if (airborne) spread += 0.03;
  if (crouched) spread *= 0.7;
  return spread;
}

// Try to fire one shot at time `now` (seconds). Returns 'shot', 'empty', 'reload'
// or 'wait' (rate limit / semi-auto needs a fresh trigger pull).
export function tryFire(wstate, now, triggerDown) {
  if (wstate.reloading > 0) return 'reload';
  if (!wstate.def.auto && wstate.triggerHeld && triggerDown) return 'wait';
  if (!triggerDown) {
    wstate.triggerHeld = false;
    return 'wait';
  }
  wstate.triggerHeld = true;
  const interval = 60 / wstate.def.rpm;
  if (now - wstate.lastShotAt < interval) return 'wait';
  if (wstate.inMag <= 0) return 'empty';
  wstate.lastShotAt = now;
  wstate.inMag -= 1;
  wstate.bloom = Math.min(wstate.def.bloomMax, wstate.bloom + wstate.def.bloomPerShot);
  return 'shot';
}

export function startReload(wstate) {
  if (wstate.reloading > 0 || wstate.inMag >= wstate.def.mag || wstate.reserve <= 0) return false;
  wstate.reloading = wstate.def.reloadTime;
  return true;
}

export function updateWeapon(wstate, dt) {
  if (wstate.reloading > 0) {
    wstate.reloading -= dt;
    if (wstate.reloading <= 0) {
      wstate.reloading = 0;
      const need = wstate.def.mag - wstate.inMag;
      const take = Math.min(need, wstate.reserve);
      wstate.inMag += take;
      wstate.reserve -= take;
    }
  }
  wstate.bloom = Math.max(0, wstate.bloom - dt * 0.09);
}

// The first-person viewmodel: a simple gun built from boxes, kicked by recoil.
export function createWeaponRig(camera) {
  const group = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: PALETTE.dark, roughness: 0.45, metalness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), gunMat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 10), gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.36);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.1), accentMat);
  grip.position.set(0, -0.12, 0.16);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accentMat);
  sight.position.set(0, 0.09, -0.1);
  const flashMat = new THREE.MeshBasicMaterial({
    color: PALETTE.muzzle, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
  flash.position.set(0, 0.02, -0.56);
  group.add(body, barrel, grip, sight, flash);
  group.position.set(0.26, -0.24, -0.42);
  camera.add(group);

  let kick = 0;
  let flashTime = 0;

  function onShot() {
    kick = Math.min(0.09, kick + 0.035);
    flashTime = 0.05;
    flashMat.opacity = 0.95;
    flash.rotation.z = Math.random() * Math.PI;
  }

  function update(dt) {
    kick = Math.max(0, kick - dt * 0.5);
    group.position.z = -0.42 + kick;
    group.rotation.x = kick * 1.4;
    if (flashTime > 0) {
      flashTime -= dt;
      if (flashTime <= 0) flashMat.opacity = 0;
    }
  }

  return { group, onShot, update };
}
