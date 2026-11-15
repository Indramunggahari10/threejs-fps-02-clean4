// Mover: axis-separated AABB movement against the world's colliders. A body is a
// vertical capsule approximated by a box (radius 0.4, standing height 1.7, crouched
// 1.15); the feet sit on the ground plane at y = 0. Movement resolves per axis so
// a body slides along walls instead of sticking, and gravity keeps it grounded.
// No allocations in the hot path: the caller reuses one mover per combatant.
import { MAP } from './mapdata.js';

const RADIUS = 0.4;
const STAND_HEIGHT = 1.7;
const CROUCH_HEIGHT = 1.15;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;

export function createMover(colliders, spawn) {
  const state = {
    x: spawn.x,
    y: 0,
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    crouched: false,
    onGround: true,
  };

  function collidesAt(x, y, z, height) {
    if (x < MAP.bounds.minX + RADIUS || x > MAP.bounds.maxX - RADIUS) return true;
    if (z < MAP.bounds.minZ + RADIUS || z > MAP.bounds.maxZ - RADIUS) return true;
    for (const box of colliders) {
      if (y + height <= box.minY || y >= box.maxY) continue;
      if (x + RADIUS <= box.minX || x - RADIUS >= box.maxX) continue;
      if (z + RADIUS <= box.minZ || z - RADIUS >= box.maxZ) continue;
      return true;
    }
    return false;
  }

  // Move by (dx, dz) in the horizontal plane, axis by axis. Returns true if the
  // full step landed, false if a wall blocked part of it.
  function move(dx, dz) {
    const height = state.crouched ? CROUCH_HEIGHT : STAND_HEIGHT;
    let moved = true;
    const nx = state.x + dx;
    if (!collidesAt(nx, state.y, state.z, height)) {
      state.x = nx;
    } else {
      moved = false;
    }
    const nz = state.z + dz;
    if (!collidesAt(state.x, state.y, nz, height)) {
      state.z = nz;
    } else {
      moved = false;
    }
    return moved;
  }

  function step(dt) {
    state.vy -= GRAVITY * dt;
    let ny = state.y + state.vy * dt;
    if (ny <= 0) {
      ny = 0;
      state.vy = 0;
      state.onGround = true;
    } else {
      state.onGround = false;
    }
    state.y = ny;
  }

  function jump() {
    if (!state.onGround) return false;
    state.vy = JUMP_SPEED;
    state.onGround = false;
    return true;
  }

  function teleport(x, z, yaw) {
    // Clamp into the yard so a bad spawn can never place a body in a wall.
    state.x = Math.max(MAP.bounds.minX + RADIUS, Math.min(MAP.bounds.maxX - RADIUS, x));
    state.y = 0;
    state.z = Math.max(MAP.bounds.minZ + RADIUS, Math.min(MAP.bounds.maxZ - RADIUS, z));
    state.vx = 0;
    state.vy = 0;
    state.vz = 0;
    if (yaw !== undefined) state.yaw = yaw;
  }

  function height() {
    return state.crouched ? CROUCH_HEIGHT : STAND_HEIGHT;
  }

  function eyeHeight() {
    return state.y + (state.crouched ? 1.0 : 1.55);
  }

  return { state, move, step, jump, teleport, collidesAt, height, eyeHeight };
}
