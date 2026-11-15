// Grenades: the FL-2 flashbang. Thrown on an arc with a 1.6 s fuse, it bounces
// once off walls and then pops: anyone with a line of sight to the pop who is
// looking roughly toward it is blinded, longer up close. Blindness is a timer on
// the combatant; the HUD reads the player's timer for its white overlay, and bot
// aim degrades while theirs runs.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 14;
const FUSE = 1.6;
const BLIND_RANGE = 26;

export function createGrenades(scene, world) {
  const live = [];
  const meshGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const meshMat = new THREE.MeshStandardMaterial({ color: PALETTE.white, roughness: 0.4, metalness: 0.5 });
  const popGeo = new THREE.SphereGeometry(1, 12, 10);
  const popMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pop = new THREE.Mesh(popGeo, popMat);
  pop.visible = false;
  scene.add(pop);
  let popLife = 0;

  function throwGrenade(from, dir) {
    const mesh = new THREE.Mesh(meshGeo, meshMat);
    mesh.position.set(from.x, from.y, from.z);
    scene.add(mesh);
    live.push({
      mesh,
      x: from.x, y: from.y, z: from.z,
      vx: dir.x * 13, vy: dir.y * 13 + 3.2, vz: dir.z * 13,
      fuse: FUSE,
    });
  }

  function detonate(g, combatants) {
    scene.remove(g.mesh);
    pop.position.set(g.x, g.y, g.z);
    pop.visible = true;
    popLife = 0.25;
    for (const c of combatants) {
      if (!c.alive) continue;
      const m = c.mover.state;
      const ex = m.x;
      const ey = c.mover.eyeHeight();
      const ez = m.z;
      const dx = g.x - ex;
      const dy = g.y - ey;
      const dz = g.z - ez;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > BLIND_RANGE) continue;
      const wallT = world.segmentHit(ex, ey, ez, g.x, g.y, g.z);
      if (wallT !== null && wallT < 0.999) continue;
      // Facing: dot of look direction with direction to the flash.
      const lx = -Math.sin(m.yaw);
      const lz = -Math.cos(m.yaw);
      const facing = (lx * dx + lz * dz) / (dist || 1);
      const strength = facing > 0.1 ? 1 : 0.45;
      const seconds = Math.max(0.4, (1 - dist / BLIND_RANGE) * 3.2 * strength);
      c.flash = Math.max(c.flash || 0, seconds);
    }
  }

  function update(dt, combatants) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const g = live[i];
      g.fuse -= dt;
      g.vy -= GRAVITY * dt;
      const ox = g.x;
      const oy = g.y;
      const oz = g.z;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      if (g.y < 0.09) {
        g.y = 0.09;
        g.vy = Math.abs(g.vy) * 0.35;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
      const wallT = world.segmentHit(ox, oy, oz, g.x, g.y, g.z);
      if (wallT !== null) {
        g.x = ox;
        g.y = oy;
        g.z = oz;
        g.vx *= -0.4;
        g.vy *= 0.4;
        g.vz *= -0.4;
      }
      g.mesh.position.set(g.x, g.y, g.z);
      if (g.fuse <= 0) {
        detonate(g, combatants);
        live.splice(i, 1);
      }
    }
    if (popLife > 0) {
      popLife -= dt;
      const s = 1 + (0.25 - Math.max(0, popLife)) * 14;
      pop.scale.set(s, s, s);
      popMat.opacity = Math.max(0, popLife / 0.25);
      if (popLife <= 0) pop.visible = false;
    }
  }

  return { throwGrenade, update, live };
}
