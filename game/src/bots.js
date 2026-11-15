// Bots: 4 Ember teammates and 5 Warden opponents. Each bot runs a small state
// machine over the nav graph — advance along a route, hold an angle, engage what
// it sees, plant or defuse the charge — with vision (range, field of view, line of
// sight), hearing (gunshots pull attention), and aim that steadies the longer it
// holds a target. Bodies are styled box humanoids with separate head and torso
// hitboxes so headshots pay.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP } from './mapdata.js';
import { createWeaponState, tryFire, updateWeapon } from './weapons.js';
import { PLANT_TIME, DEFUSE_TIME } from './rounds.js';
import { createMover } from './mover.js';
import { pick, range, rangeInt, chance } from './rng.js';

export const BOT_NAMES = {
  attackers: ['Flint', 'Ash', 'Soot', 'Cinder'],
  defenders: ['Hale', 'Sorrel', 'Bram', 'Vex', 'Nyx'],
};

const VISION_RANGE = 42;
const HEARING_RANGE = 32;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.7;
const WALK_SPEED = 4.3;
const HOLD_SPEED = 0;

const ADJ = MAP.nodes.map(() => []);
for (const [a, b] of MAP.edges) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < MAP.nodes.length; i += 1) {
    const [nx, nz] = MAP.nodes[i];
    const d = (nx - x) * (nx - x) + (nz - z) * (nz - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Breadth-first path over the nav graph, returned as node ids from start to goal.
export function findPath(fromX, fromZ, toX, toZ) {
  const start = nearestNode(fromX, fromZ);
  const goal = nearestNode(toX, toZ);
  if (start === goal) return [goal];
  const prev = new Array(MAP.nodes.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const next of ADJ[cur]) {
      if (prev[next] === -1) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  if (prev[goal] === -1) return [goal];
  const path = [];
  let cur = goal;
  while (cur !== start) {
    path.unshift(cur);
    cur = prev[cur];
  }
  return path;
}

function buildBodyMesh(scene, team) {
  const color = team === 'attackers' ? PALETTE.attacker : PALETTE.defender;
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: PALETTE.dark, roughness: 0.8, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.9 });
  const visor = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.2, metalness: 0.7 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth);
  torso.position.y = 1.18;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skin);
  head.position.y = 1.66;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), dark);
  helmet.position.y = 1.86;
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.05), visor);
  face.position.set(0, 1.66, 0.16);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.24), dark);
  legL.position.set(-0.14, 0.55, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.24), dark);
  legR.position.set(0.14, 0.55, 0);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.18), cloth);
  armL.position.set(-0.34, 1.2, 0.05);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.18), cloth);
  armR.position.set(0.34, 1.2, 0.05);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), dark);
  gun.position.set(0.2, 1.32, -0.28);
  group.add(torso, head, helmet, face, legL, legR, armL, armR, gun);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  scene.add(group);
  return { group, torso, head };
}

export function createBots(scene, world, random) {
  const bots = [];

  function makeBot(name, team, spawnIndex) {
    const [sx, sz, syaw] = MAP.spawns[team][spawnIndex];
    const mover = createMover(world.colliders, { x: sx, z: sz, yaw: syaw });
    const body = buildBodyMesh(scene, team);
    const weaponId = team === 'defenders' && spawnIndex === 4 ? 'marksman'
      : (spawnIndex % 3 === 2 ? 'smg' : 'rifle');
    const bot = {
      name,
      team,
      mover,
      mesh: body.group,
      health: 100,
      armor: 25,
      alive: true,
      isPlayer: false,
      flash: 0,
      weapon: createWeaponState(weaponId),
      state: 'route',
      path: [],
      pathIndex: 0,
      target: null,
      reaction: 0,
      aimHold: 0,
      burstLeft: 0,
      burstPause: 0,
      holdUntil: 0,
      holdYaw: syaw,
      site: 'A',
      investigate: null,
      investigateUntil: 0,
      channel: 0,
      channelKind: null,
      kills: 0,
      deaths: 0,
      walkPhase: random() * Math.PI * 2,
    };
    bots.push(bot);
    return bot;
  }

  BOT_NAMES.attackers.forEach((name, i) => makeBot(name, 'attackers', i + 1));
  BOT_NAMES.defenders.forEach((name, i) => makeBot(name, 'defenders', i));

  function reset(rounds) {
    const sites = ['A', 'B'];
    for (const bot of bots) {
      const idx = bot.team === 'attackers'
        ? BOT_NAMES.attackers.indexOf(bot.name) + 1
        : BOT_NAMES.defenders.indexOf(bot.name);
      const [sx, sz, syaw] = MAP.spawns[bot.team][idx];
      bot.mover.teleport(sx, sz, syaw);
      bot.mesh.rotation.set(0, 0, 0);
      bot.mesh.visible = true;
      bot.health = 100;
      bot.armor = 25;
      bot.alive = true;
      bot.flash = 0;
      bot.weapon = createWeaponState(bot.weapon.id);
      bot.state = 'route';
      bot.path = [];
      bot.pathIndex = 0;
      bot.target = null;
      bot.reaction = 0;
      bot.aimHold = 0;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.channel = 0;
      bot.channelKind = null;
      bot.investigate = null;
      bot.site = pick(random, sites);
      bot.holdUntil = 0;
    }
    void rounds;
  }

  // Line of sight between two eye positions, blocked by world geometry only.
  function canSee(ax, ay, az, bx, by, bz) {
    const t = world.segmentHit(ax, ay, az, bx, by, bz);
    return t === null || t >= 0.999;
  }

  function scanForEnemy(bot, combatants, time) {
    const m = bot.mover.state;
    const ex = m.x;
    const ey = bot.mover.eyeHeight();
    const ez = m.z;
    const fx = -Math.sin(m.yaw);
    const fz = -Math.cos(m.yaw);
    let best = null;
    let bestD = Infinity;
    for (const c of combatants) {
      if (c === bot || !c.alive || c.team === bot.team) continue;
      const cm = c.mover.state;
      const dx = cm.x - ex;
      const dz = cm.z - ez;
      const dist = Math.hypot(dx, dz);
      if (dist > VISION_RANGE || dist < 0.5) continue;
      // Field of view: about 100 degrees while routing, wider while holding.
      const cos = (fx * dx + fz * dz) / dist;
      const fov = bot.state === 'hold' ? 0.25 : 0.45;
      if (cos < fov) continue;
      const cy = c.mover.eyeHeight();
      if (!canSee(ex, ey, ez, cm.x, cy, cm.z)) continue;
      if (dist < bestD) { bestD = dist; best = c; }
    }
    if (best) {
      if (bot.target !== best) {
        bot.target = best;
        bot.reaction = range(random, REACTION_MIN, REACTION_MAX);
        bot.aimHold = 0;
      }
      return true;
    }
    bot.target = null;
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const m = bot.mover.state;
    const dx = tx - m.x;
    const dz = tz - m.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) return true;
    const step = Math.min(dist, speed * dt);
    const nx = (dx / dist) * step;
    const nz = (dz / dist) * step;
    bot.mover.move(nx, nz);
    const wantYaw = Math.atan2(-dx, -dz);
    let dyaw = wantYaw - m.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    m.yaw += Math.max(-6 * dt, Math.min(6 * dt, dyaw));
    return false;
  }

  function followPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = MAP.nodes[bot.path[bot.pathIndex]];
    if (moveToward(bot, node[0], node[1], dt, WALK_SPEED)) bot.pathIndex += 1;
    return bot.pathIndex >= bot.path.length;
  }

  function setPathTo(bot, tx, tz) {
    const m = bot.mover.state;
    bot.path = findPath(m.x, m.z, tx, tz);
    bot.pathIndex = 0;
  }

  function update(dt, ctx) {
    const { rounds, combat, combatants, time } = ctx;
    const rstate = rounds.state;
    for (const bot of bots) {
      if (!bot.alive) continue;
      const m = bot.mover.state;
      updateWeapon(bot.weapon, dt);
      if (bot.flash > 0) bot.flash -= dt;

      // Channel progress (plant / defuse) only while still and in place: if
      // the bot leaves the site (plant) or the charge (defuse), the channel
      // resets instead of completing from across the map.
      if (bot.channelKind) {
        const chargeNow = rounds.state.charge;
        const inPlace = bot.channelKind === 'plant'
          ? rounds.siteAt(m.x, m.z) === bot.site
          : chargeNow.state === 'planted'
            && Math.hypot(chargeNow.x - m.x, chargeNow.z - m.z) < 2.0;
        if (!inPlace) {
          bot.channel = 0;
          bot.channelKind = null;
        } else {
          const need = bot.channelKind === 'plant' ? PLANT_TIME : DEFUSE_TIME;
          bot.channel += dt;
          if (bot.channel >= need) {
            if (bot.channelKind === 'plant') {
              rounds.plant(bot.site, m.x, m.z);
              ctx.onPlant?.(bot);
            } else {
              rounds.defuse();
              ctx.onDefuse?.(bot);
            }
            bot.channel = 0;
            bot.channelKind = null;
          }
        }
      }

      const seen = rstate.phase === 'live' ? scanForEnemy(bot, combatants, time) : false;

      if (seen && bot.target && bot.target.alive) {
        // Engage: face the target, steady aim, fire in bursts.
        const t = bot.target.mover.state;
        const dx = t.x - m.x;
        const dz = t.z - m.z;
        const wantYaw = Math.atan2(-dx, -dz);
        let dyaw = wantYaw - m.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        m.yaw += Math.max(-8 * dt, Math.min(8 * dt, dyaw));
        bot.aimHold += dt;
        if (bot.reaction > 0) {
          bot.reaction -= dt;
        } else if (bot.burstPause > 0) {
          bot.burstPause -= dt;
        } else {
          if (bot.burstLeft <= 0) {
            bot.burstLeft = rangeInt(random, 3, 5);
            bot.burstPause = range(random, 0.15, 0.4);
          } else if (tryFire(bot.weapon, time, true) === 'shot') {
            const targetEye = bot.target.mover.eyeHeight();
            const aimY = chance(random, 0.15) ? targetEye + 0.12 : targetEye - 0.25;
            const dist = Math.hypot(dx, dz);
            const steady = Math.min(1, bot.aimHold / 1.2);
            const err = (0.07 * (1 - steady * 0.7) + dist * 0.001) * (bot.flash > 0 ? 6 : 1);
            const dirx = dx / dist + (random() - 0.5) * 2 * err;
            const diry = (aimY - bot.mover.eyeHeight()) / dist + (random() - 0.5) * 2 * err;
            const dirz = dz / dist + (random() - 0.5) * 2 * err;
            const wasAlive = bot.target.alive;
            const result = combat.shoot(
              bot,
              { x: dirx, y: diry, z: dirz },
              { def: bot.weapon.def, spread: 0 },
              combatants.filter((c) => c !== bot),
              random,
            );
            if (result.hit && wasAlive && !result.victim.alive) ctx.onKill?.(bot, result.victim);
            bot.burstLeft -= 1;
            if (bot.burstLeft <= 0) bot.burstPause = range(random, 0.5, 1.1);
            ctx.onBotShot?.(bot);
          }
        }
        // Strafe a little while firing so duels are not statues.
        if (bot.aimHold > 0.8 && random() < dt * 0.8) {
          const strafe = random() < 0.5 ? 1 : -1;
          const sx = Math.cos(m.yaw) * strafe;
          const sz = -Math.sin(m.yaw) * strafe;
          bot.mover.move(sx * WALK_SPEED * 0.4 * dt, sz * WALK_SPEED * 0.4 * dt);
        }
        // Keep the mesh on the mover even while engaging (this branch skips
        // the sync at the bottom of the loop).
        bot.walkPhase += dt * 7;
        bot.mesh.position.set(m.x, m.y + Math.abs(Math.sin(bot.walkPhase)) * 0.03, m.z);
        bot.mesh.rotation.y = m.yaw + Math.PI;
        continue;
      }

      // No enemy in sight: run the objective.
      bot.aimHold = 0;
      if (rstate.phase !== 'live') {
        bot.state = 'hold';
        continue;
      }

      const charge = rstate.charge;
      if (bot.team === 'attackers') {
        if (charge.state === 'planted') {
          // Defend the planted charge: hold near its site.
          if (!bot.path.length || bot.state !== 'hold') {
            setPathTo(bot, charge.x, charge.z);
            bot.state = 'route';
          }
          if (followPath(bot, dt)) {
            bot.state = 'hold';
            bot.holdYaw = Math.atan2(-(charge.x - m.x), -(charge.z - m.z));
            m.yaw = bot.holdYaw;
          }
        } else if (charge.carrier === bot.name) {
          // The carrier plants at its site.
          const site = MAP.sites[bot.site];
          const dist = Math.hypot(site.center.x - m.x, site.center.z - m.z);
          if (dist < site.radius * 0.8) {
            if (!bot.channelKind) { bot.channelKind = 'plant'; bot.channel = 0; }
            bot.state = 'plant';
          } else {
            // Recompute when the old path is exhausted, not just when it is
            // empty: a bot that becomes carrier mid-route must re-aim at the
            // site instead of standing at its old flank point.
            if (!bot.path.length || bot.state !== 'route' || bot.pathIndex >= bot.path.length) {
              setPathTo(bot, site.center.x, site.center.z);
            }
            bot.state = 'route';
            followPath(bot, dt);
          }
        } else if (charge.state === 'dropped') {
          if (!bot.path.length || bot.state !== 'route' || bot.pathIndex >= bot.path.length) {
            setPathTo(bot, charge.x, charge.z);
          }
          bot.state = 'route';
          if (followPath(bot, dt)) {
            if (Math.hypot(charge.x - m.x, charge.z - m.z) < 1.4) {
              rounds.pickup(bot.name);
            }
          }
        } else {
          // Escort toward the site; the carrier is the player or a teammate.
          if (bot.state === 'hold' && time < bot.holdUntil) {
            m.yaw = bot.holdYaw;
          } else if (bot.state === 'route' && bot.path.length) {
            if (followPath(bot, dt)) {
              bot.state = 'hold';
              bot.holdUntil = time + range(random, 2, 5);
              bot.holdYaw = m.yaw + range(random, -1, 1);
            }
          } else {
            const site = MAP.sites[bot.site];
            const flank = range(random, -4, 4);
            setPathTo(bot, site.center.x + flank, site.center.z + flank);
            bot.state = 'route';
          }
        }
      } else {
        // Defenders.
        if (charge.state === 'planted') {
          const dist = Math.hypot(charge.x - m.x, charge.z - m.z);
          if (dist < 1.6) {
            if (!bot.channelKind) { bot.channelKind = 'defuse'; bot.channel = 0; }
            bot.state = 'defuse';
          } else {
            if (!bot.path.length || bot.state !== 'route' || bot.pathIndex >= bot.path.length) {
              setPathTo(bot, charge.x, charge.z);
            }
            bot.state = 'route';
            followPath(bot, dt);
          }
        } else if (bot.investigate && time < bot.investigateUntil) {
          if (!bot.path.length || bot.state !== 'route' || bot.pathIndex >= bot.path.length) {
            setPathTo(bot, bot.investigate.x, bot.investigate.z);
            bot.state = 'route';
          }
          if (followPath(bot, dt)) bot.investigate = null;
        } else if (bot.state === 'hold' && time < bot.holdUntil) {
          m.yaw = bot.holdYaw;
        } else if (bot.state === 'route' && bot.path.length) {
          // En route to a hold spot: only re-pick once arrived.
          if (followPath(bot, dt)) {
            bot.state = 'hold';
            bot.holdUntil = time + range(random, 4, 9);
            bot.holdYaw = m.yaw + range(random, -0.6, 0.6);
          }
        } else {
          // Pick a hold spot near the assigned site and walk to it.
          const site = MAP.sites[bot.site];
          const holdNode = MAP.nodes[nearestNode(site.center.x + range(random, -6, 6), site.center.z + range(random, -6, 6))];
          setPathTo(bot, holdNode[0], holdNode[1]);
          bot.state = 'route';
        }
      }

      // Walk-cycle bob for the body mesh, and keep the mesh on the mover.
      bot.walkPhase += dt * 7;
      bot.mesh.position.set(m.x, m.y + Math.abs(Math.sin(bot.walkPhase)) * 0.03, m.z);
      bot.mesh.rotation.y = m.yaw + Math.PI;
    }
  }

  function hearShot(x, z, time) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const m = bot.mover.state;
      if (Math.hypot(x - m.x, z - m.z) < HEARING_RANGE) {
        bot.investigate = { x, z };
        bot.investigateUntil = time + 6;
      }
    }
  }

  return { bots, reset, update, hearShot, findPath, nearestNode };
}
