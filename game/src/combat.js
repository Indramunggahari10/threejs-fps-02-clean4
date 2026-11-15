// Combat: hitscan shots resolved against bot bodies and the world. A ray from the
// shooter's eye is tested against every living body (head box first, then torso)
// and against the world's colliders; the nearer hit wins. Headshots pay more,
// damage falls off with range, armor soaks half. Tracers are pooled lines so a
// firefight allocates nothing.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;

export function createCombat(scene, world) {
  const tracerMat = new THREE.LineBasicMaterial({
    color: PALETTE.tracer, transparent: true, opacity: 0.9,
  });
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  function spawnTracer(from, to) {
    const t = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.09;
  }

  function updateTracers(dt) {
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.line.visible = false;
      }
    }
  }

  // Ray vs a body's head/torso boxes. Returns {part, t} or null.
  function rayVsBody(ox, oy, oz, dx, dy, dz, body) {
    if (!body.alive) return null;
    const m = body.mover.state;
    const parts = [
      { name: 'head', cy: m.y + 1.66, half: 0.17, halfY: 0.17 },
      { name: 'torso', cy: m.y + 1.18, half: 0.28, halfY: 0.34 },
    ];
    let best = null;
    for (const part of parts) {
      let lo = 0;
      let hi = Infinity;
      const axes = [
        [ox, dx, m.x - part.half, m.x + part.half],
        [oy, dy, part.cy - part.halfY, part.cy + part.halfY],
        [oz, dz, m.z - part.half, m.z + part.half],
      ];
      let ok = true;
      for (const [o, d, mn, mx] of axes) {
        if (Math.abs(d) < 1e-9) {
          if (o < mn || o > mx) { ok = false; break; }
        } else {
          let t1 = (mn - o) / d;
          let t2 = (mx - o) / d;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          if (t1 > lo) lo = t1;
          if (t2 < hi) hi = t2;
          if (lo > hi) { ok = false; break; }
        }
      }
      if (ok && (best === null || lo < best.t)) best = { part: part.name, t: lo };
    }
    return best;
  }

  // Fire one hitscan shot. `bodies` are all combatants except the shooter.
  // Returns {hit, victim, part, damage, end:{x,y,z}}.
  function shoot(shooter, dir, weapon, bodies, random) {
    const m = shooter.mover.state;
    const ox = m.x;
    const oy = shooter.mover.eyeHeight();
    const oz = m.z;
    const spread = weapon.spread;
    const dx = dir.x + (random() - 0.5) * 2 * spread;
    const dy = dir.y + (random() - 0.5) * 2 * spread;
    const dz = dir.z + (random() - 0.5) * 2 * spread;
    const len = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const range = weapon.def.range;

    let bestT = range;
    let bestVictim = null;
    let bestPart = null;
    for (const body of bodies) {
      const hit = rayVsBody(ox, oy, oz, nx, ny, nz, body);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        bestVictim = body;
        bestPart = hit.part;
      }
    }
    const wallT = world.segmentHit(ox, oy, oz, ox + nx * range, oy + ny * range, oz + nz * range);
    if (wallT !== null && wallT * range < bestT) {
      bestT = wallT * range;
      bestVictim = null;
      bestPart = null;
    }

    const end = { x: ox + nx * bestT, y: oy + ny * bestT, z: oz + nz * bestT };
    spawnTracer({ x: ox, y: oy, z: oz }, end);

    let damage = 0;
    if (bestVictim) {
      const falloff = Math.max(0.55, 1 - (bestT / range) * 0.45);
      damage = weapon.def.damage * falloff * (bestPart === 'head' ? weapon.def.headMult : 1);
      applyDamage(bestVictim, damage);
    }
    return { hit: bestVictim !== null, victim: bestVictim, part: bestPart, damage, end };
  }

  // Armor soaks half of incoming damage until it runs out, then health takes it.
  function applyDamage(victim, damage) {
    let remaining = damage;
    if (victim.armor > 0) {
      const soaked = Math.min(victim.armor, remaining * 0.5);
      victim.armor -= soaked;
      remaining -= soaked;
    }
    victim.health -= remaining;
    if (victim.health <= 0) {
      victim.health = 0;
      victim.alive = false;
    }
    return remaining;
  }

  return { shoot, applyDamage, updateTracers };
}
