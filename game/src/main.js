// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. main.js owns the match state (player, bots, charge, economy),
// resolves every shot, and pushes numbers to the HUD. ?shot=start|play|buy|end
// &seed=N sets up a deterministic frame, renders it twice, freezes it and sets
// window.__shotReady. ?soak=1 plays a whole match with an autopilot and reports
// window.__soak. ?test=plant|defuse verifies one mechanic and reports
// window.__test. ?autostart=1 starts the match without pointer lock, for
// headless verification.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, range } from './rng.js';
import { MAP } from './mapdata.js';
import { createWorld } from './world.js';
import { createMover } from './mover.js';
import { createInput } from './input.js';
import {
  createWeaponRig, createWeaponState, WEAPONS, GRENADE_PRICE, ARMOR_PRICE,
  ARMOR_VALUE, tryFire, startReload, updateWeapon, spreadFor,
} from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createGrenades } from './grenades.js';
import {
  createRounds, START_MONEY, KILL_REWARD, PLANT_REWARD, PLANT_TIME, DEFUSE_TIME,
  BUY_TIME,
} from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const autostart = params.get('autostart') === '1' || shot !== null;
const soakMode = params.get('soak') === '1';
const testMode = params.get('test');
const random = mulberry32(seed);

window.__errors = [];
window.addEventListener('error', (event) => window.__errors.push(String(event.message)));
const origConsoleError = console.error.bind(console);
console.error = (...args) => {
  window.__errors.push(args.map(String).join(' '));
  origConsoleError(...args);
};

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 45, 130);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio();
const rounds = createRounds();
const combat = createCombat(scene, world);
const grenades = createGrenades(scene, world);
const botsApi = createBots(scene, world, random);
const effects = createEffects(scene);
const input = createInput(renderer.domElement);
const raycaster = new THREE.Raycaster();

const playerMover = createMover(world.colliders, {
  x: MAP.spawns.attackers[0][0], z: MAP.spawns.attackers[0][1], yaw: MAP.spawns.attackers[0][2],
});
const weaponRig = createWeaponRig(camera);
const player = {
  name: 'You',
  team: 'attackers',
  mover: playerMover,
  health: 100,
  armor: 0,
  alive: true,
  isPlayer: true,
  money: START_MONEY,
  kills: 0,
  deaths: 0,
  weapon: createWeaponState('pistol'),
  primary: null,
  owned: new Set(['pistol']),
  grenades: 0,
  channel: 0,
  channelKind: null,
  flash: 0,
};
const combatants = [player, ...botsApi.bots];

// The charge (core) mesh, shown when dropped or planted.
const chargeMesh = new THREE.Group();
const chargeBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.22, 0.24),
  new THREE.MeshStandardMaterial({ color: PALETTE.dark, roughness: 0.5, metalness: 0.4 }),
);
const chargeLamp = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.05, 0.08),
  new THREE.MeshBasicMaterial({ color: PALETTE.charge }),
);
chargeLamp.position.set(0, 0.14, 0);
chargeMesh.add(chargeBox, chargeLamp);
chargeMesh.visible = false;
scene.add(chargeMesh);

let time = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastFrame = performance.now();
let plants = 0;
let defuses = 0;
let shotsFired = 0;
let matchLog = [];
let trail = [];
let lastTrailAt = -10;

function logEvent(text) {
  matchLog.push(`[${time.toFixed(1)}] ${text}`);
}

function aliveCount(team) {
  let n = 0;
  for (const c of combatants) if (c.team === team && c.alive) n += 1;
  return n;
}

function respawnAll() {
  const [sx, sz, syaw] = MAP.spawns.attackers[0];
  playerMover.teleport(sx, sz, syaw);
  player.health = 100;
  player.alive = true;
  player.flash = 0;
  player.channel = 0;
  player.channelKind = null;
  player.weapon = createWeaponState(player.weapon.id);
  if (player.primary) {
    // Keep the primary bought last round; refill its reserve partially.
    player.primaryWeapon = createWeaponState(player.primary);
  }
  botsApi.reset(rounds);
  player.mover.state.pitch = 0;
  // The charge returns to the player's hands; a living attacker bot carries it if
  // the player is somehow not the carrier (never at round start).
  rounds.state.charge.carrier = 'player';
}

function startMatch() {
  if (started) return;
  started = true;
  hud.showMenu(false);
  audio.unlock();
  rounds.startRound();
  respawnAll();
  hud.showBanner('ROUND 1', 'Plant the charge at FOUNDRY or KILN', 3000);
}

function endRoundFor(winner, reason) {
  const payout = rounds.endRound(winner, reason);
  if (!payout) return;
  const playerWon = winner === 'attackers';
  player.money += playerWon ? payout.winReward : payout.lossReward;
  hud.showBanner(
    playerWon ? 'ROUND WON' : 'ROUND LOST',
    `${reason} — ${rounds.state.score.attackers} : ${rounds.state.score.defenders}`,
    4200,
  );
  if (playerWon) audio.roundWin(); else audio.roundLose();
  logEvent(`round ${rounds.state.round} -> ${winner} (${reason})`);
  if (rounds.state.phase === 'matchEnd') {
    const mw = rounds.state.matchWinner;
    hud.showBanner(
      mw === 'attackers' ? 'MATCH WON' : mw === 'defenders' ? 'MATCH LOST' : 'MATCH DRAWN',
      `Final score ${rounds.state.score.attackers} : ${rounds.state.score.defenders}`,
      8000,
    );
    logEvent(`match end: ${mw} ${rounds.state.score.attackers}:${rounds.state.score.defenders}`);
  }
}

function onKill(killer, victim) {
  killer.kills += 1;
  victim.deaths += 1;
  hud.killfeed(`${killer.name} ▸ ${victim.name}`);
  if (killer === player) {
    player.money += KILL_REWARD;
    audio.kill();
  }
  if (victim === player) {
    effects.showDamage();
    audio.hurt();
    if (rounds.state.charge.carrier === 'player') {
      const m = player.mover.state;
      rounds.drop(m.x, m.z);
      // Hand the charge to a living attacker bot so the round can continue.
      const carrier = botsApi.bots.find((b) => b.team === 'attackers' && b.alive);
      if (carrier) {
        rounds.pickup(carrier.name);
        carrier.site = rounds.siteAt(m.x, m.z) || carrier.site;
      }
    }
  }
  // A dead bot's body falls; hide it after the round, keep it visible now.
  if (!victim.isPlayer) {
    victim.mesh.rotation.x = -Math.PI / 2;
    victim.mesh.position.y = 0.25;
  }
}

function playerShoot() {
  const result = tryFire(player.weapon, time, input.state.fire);
  if (result === 'empty') {
    audio.dryFire();
    startReload(player.weapon);
    return;
  }
  if (result !== 'shot') return;
  shotsFired += 1;
  const m = playerMover.state;
  const spread = spreadFor(player.weapon, playerSpeed(), m.crouched, !m.onGround);
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  const wasAlive = {};
  for (const c of combatants) wasAlive[c.name] = c.alive;
  const res = combat.shoot(player, dir, { def: player.weapon.def, spread }, combatants.filter((c) => c !== player), random);
  weaponRig.onShot();
  audio.shot(player.weapon.id);
  botsApi.hearShot(m.x, m.z, time);
  if (res.hit) {
    effects.showHitmarker(!res.victim.alive);
    effects.burst(res.end, res.part === 'head' ? 0xff5040 : 0xffc861, res.part === 'head' ? 14 : 8);
    audio.hit();
    if (wasAlive[res.victim.name] && !res.victim.alive) onKill(player, res.victim);
  } else {
    effects.burst(res.end, 0x9aa0a3, 5);
  }
  // Recoil kick on the camera.
  m.pitch += player.weapon.def.recoil * (0.6 + random() * 0.8);
  m.yaw += (random() - 0.5) * player.weapon.def.recoil;
}

function playerSpeed() {
  const m = playerMover.state;
  return Math.hypot(m.vx, m.vz);
}

// Autopilot: drives the player like a bot so soak mode plays a full match.
const autopilot = { path: [], pathIndex: 0, site: 'A', target: null };
function autopilotStep(dt) {
  const m = playerMover.state;
  if (!player.alive) return;
  // Buy phase: spend the round's money on a rifle, then plating.
  if (rounds.state.phase === 'buy') {
    if (!player.primary && player.money >= 2700) buyItem('rifle');
    else if (player.primary && player.armor < ARMOR_VALUE && player.money >= ARMOR_PRICE) buyItem('armor');
    return;
  }
  // Find the nearest visible enemy.
  let best = null;
  let bestD = Infinity;
  for (const c of combatants) {
    if (c === player || !c.alive || c.team === player.team) continue;
    const cm = c.mover.state;
    const d = Math.hypot(cm.x - m.x, cm.z - m.z);
    if (d > 40 || d < 0.5) continue;
    const t = world.segmentHit(m.x, playerMover.eyeHeight(), m.z, cm.x, c.mover.eyeHeight(), cm.z);
    if (t !== null && t < 0.999) continue;
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best) {
    const t = best.mover.state;
    const dx = t.x - m.x;
    const dz = t.z - m.z;
    m.yaw = Math.atan2(-dx, -dz);
    m.pitch = Math.atan2(best.mover.eyeHeight() - 0.4 - playerMover.eyeHeight(), bestD) * 0.9;
    // Pulse the trigger: a semi-auto pistol needs a fresh pull per shot.
    input.state.fire = (Math.floor(time * 6) % 2 === 0);
    // Hold and fight at close range; at long range keep pushing the site.
    if (bestD < 12) return;
  } else {
    input.state.fire = false;
  }
  // Otherwise advance to the assigned site and plant.
  const charge = rounds.state.charge;
  if (charge.state === 'planted') {
    // Hold near the site and watch for defenders.
    const site = MAP.sites[charge.site];
    const d = Math.hypot(site.center.x - m.x, site.center.z - m.z);
    if (d > 6) {
      if (!autopilot.path.length) {
        autopilot.path = botsApi.findPath(m.x, m.z, site.center.x, site.center.z);
        autopilot.pathIndex = 0;
      }
    } else {
      m.yaw += dt * 0.4;
      return;
    }
  } else if (charge.carrier === 'player') {
    const site = MAP.sites[autopilot.site];
    const d = Math.hypot(site.center.x - m.x, site.center.z - m.z);
    if (d < site.radius * 0.7) {
      input.state.use = true;
      return;
    }
    if (!autopilot.path.length) {
      autopilot.path = botsApi.findPath(m.x, m.z, site.center.x, site.center.z);
      autopilot.pathIndex = 0;
    }
  } else if (charge.state === 'dropped') {
    if (!autopilot.path.length) {
      autopilot.path = botsApi.findPath(m.x, m.z, charge.x, charge.z);
      autopilot.pathIndex = 0;
    }
  } else if (charge.carrier && charge.carrier !== 'player') {
    // A teammate bot carries the charge: escort to that bot's site.
    const carrierBot = botsApi.bots.find((b) => b.name === charge.carrier);
    const site = MAP.sites[carrierBot ? carrierBot.site : autopilot.site];
    if (!autopilot.path.length) {
      autopilot.path = botsApi.findPath(m.x, m.z, site.center.x, site.center.z);
      autopilot.pathIndex = 0;
    }
  }
  if (autopilot.pathIndex < autopilot.path.length) {
    const node = MAP.nodes[autopilot.path[autopilot.pathIndex]];
    const dx = node[0] - m.x;
    const dz = node[1] - m.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.4) {
      autopilot.pathIndex += 1;
    } else {
      // Keep aiming at the enemy while advancing; only face the path when
      // no target is in sight.
      if (!best) m.yaw = Math.atan2(-dx, -dz);
      const step = Math.min(dist, 4.3 * dt);
      playerMover.move((dx / dist) * step, (dz / dist) * step);
    }
  } else {
    autopilot.path = [];
  }
}

function stepSim(dt) {
  time += dt;
  const rstate = rounds.state;
  if (soakMode && time - lastTrailAt >= 10) {
    lastTrailAt = time;
    trail.push({
      t: +time.toFixed(0), x: +playerMover.state.x.toFixed(1), z: +playerMover.state.z.toFixed(1),
      phase: rstate.phase, charge: rstate.charge.state, alive: player.alive,
    });
  }

  if (rstate.phase === 'buy') {
    rstate.phaseTime -= dt;
    if (rstate.phaseTime <= 0) {
      rounds.beginLive();
      hud.showBuy(false);
      hud.showBanner(`ROUND ${rstate.round}`, 'Go — plant the charge', 2200);
    }
  } else if (rstate.phase === 'live') {
    const tickResult = rounds.tick(dt);
    if (tickResult === 'exploded') {
      audio.explosion();
      endRoundFor('attackers', 'CHARGE DETONATED');
    } else if (tickResult === 'timeout') {
      endRoundFor('defenders', 'TIME EXPIRED');
    }
  } else if (rstate.phase === 'ended' || rstate.phase === 'matchEnd') {
    rstate.phaseTime -= dt;
    if (rstate.phase === 'ended' && rstate.phaseTime <= 0) {
      rounds.nextRound();
      autopilot.site = rounds.state.round % 2 === 1 ? 'A' : 'B';
      autopilot.path = [];
      respawnAll();
    }
  }

  // Player movement and look.
  const m = playerMover.state;
  const mouse = input.consumeMouse();
  if (input.state.locked || soakMode || testMode || shot) {
    m.yaw -= mouse.dx * 0.0022;
    m.pitch -= mouse.dy * 0.0022;
    m.pitch = Math.max(-1.45, Math.min(1.45, m.pitch));
  }
  if (soakMode && started && (rstate.phase === 'live' || rstate.phase === 'buy')) autopilotStep(dt);

  const speed = input.state.sprint && !m.crouched ? 6.4 : 4.3;
  const forward = (input.state.forward ? 1 : 0) - (input.state.back ? 1 : 0);
  const strafe = (input.state.right ? 1 : 0) - (input.state.left ? 1 : 0);
  const moving = forward !== 0 || strafe !== 0;
  if (player.alive && (moving || soakMode)) {
    const sin = Math.sin(m.yaw);
    const cos = Math.cos(m.yaw);
    let dx = 0;
    let dz = 0;
    if (soakMode && !moving) {
      // Autopilot already moved the body; keep velocity bookkeeping honest.
      dx = 0;
      dz = 0;
    } else {
      dx = (-sin * forward + cos * strafe);
      dz = (-cos * forward - sin * strafe);
      const len = Math.hypot(dx, dz) || 1;
      dx = (dx / len) * speed * dt * (m.crouched ? 0.55 : 1);
      dz = (dz / len) * speed * dt * (m.crouched ? 0.55 : 1);
      playerMover.move(dx, dz);
    }
    m.vx = dx / dt;
    m.vz = dz / dt;
  } else {
    m.vx = 0;
    m.vz = 0;
  }
  m.crouched = input.state.crouch;
  if (input.state.jump) playerMover.jump();
  playerMover.step(dt);

  // Weapon switching.
  if (input.state.slot1 && player.weapon.id !== 'pistol') {
    player.weapon = createWeaponState('pistol');
  } else if (input.state.slot2 && player.primary && player.weapon.id !== player.primary) {
    player.weapon = player.primaryWeapon || createWeaponState(player.primary);
    player.primaryWeapon = player.weapon;
  } else if (input.state.slot3 && player.owned.has('marksman') && player.weapon.id !== 'marksman') {
    player.weapon = createWeaponState('marksman');
  }
  if (input.state.reload) startReload(player.weapon);
  updateWeapon(player.weapon, dt);
  if (player.flash > 0) player.flash -= dt;

  // Firing (player). The autopilot sets input.state.fire when it has a target.
  if (player.alive && rstate.phase === 'live' && input.state.fire) playerShoot();

  // Grenade.
  if (input.state.grenade && player.grenades > 0 && player.alive && rstate.phase === 'live') {
    player.grenades -= 1;
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
    grenades.throwGrenade(
      { x: m.x, y: playerMover.eyeHeight() - 0.1, z: m.z },
      dir,
    );
    audio.shot('smg');
  }

  // Plant / defuse channel for the player. The player always attacks, so a
  // defuse channel is only open in the ?test=defuse harness; in a real match
  // defusing is the defenders' job (bots do it).
  const charge = rstate.charge;
  const siteHere = rounds.siteAt(m.x, m.z);
  let channelTarget = null;
  if (player.alive && rstate.phase === 'live') {
    if (charge.carrier === 'player' && siteHere) channelTarget = 'plant';
    else if (testMode === 'defuse' && charge.state === 'planted'
      && Math.hypot(charge.x - m.x, charge.z - m.z) < 1.6) channelTarget = 'defuse';
  }
  if (input.state.use && channelTarget) {
    if (player.channelKind !== channelTarget) {
      player.channelKind = channelTarget;
      player.channel = 0;
    }
    player.channel += dt;
    const need = channelTarget === 'plant' ? PLANT_TIME : DEFUSE_TIME;
    if (Math.floor(player.channel * 4) !== Math.floor((player.channel - dt) * 4)) {
      if (channelTarget === 'plant') audio.plantBeep(); else audio.defuseBeep();
    }
    if (player.channel >= need) {
      if (channelTarget === 'plant') {
        rounds.plant(siteHere, m.x, m.z);
        plants += 1;
        player.money += PLANT_REWARD;
        audio.planted();
        hud.showBanner('CHARGE PLANTED', `Defend ${MAP.sites[siteHere].name} — 40 s fuse`, 3000);
        logEvent(`plant at ${siteHere} by player`);
      } else {
        rounds.defuse();
        defuses += 1;
        audio.planted();
        endRoundFor('defenders', 'CHARGE DEFUSED');
        logEvent('defuse by player');
      }
      player.channel = 0;
      player.channelKind = null;
      // Consume the held key so a plant cannot roll straight into a defuse.
      input.state.use = false;
    }
  } else {
    player.channel = 0;
    player.channelKind = null;
  }

  // Pick up a dropped charge by walking over it.
  if (player.alive && charge.state === 'dropped'
    && Math.hypot(charge.x - m.x, charge.z - m.z) < 1.4) {
    rounds.pickup('player');
    hud.killfeed('You picked up the charge');
  }

  // Buy menu toggle (buy phase only).
  if (input.state.buy && rstate.phase === 'buy') {
    const menu = document.getElementById('buy-menu');
    hud.showBuy(!menu.classList.contains('show'), player.money, player.owned);
  }

  // Bots.
  botsApi.update(dt, {
    rounds,
    combat,
    combatants,
    time,
    player,
    onKill,
    onPlant: (bot) => {
      plants += 1;
      audio.planted();
      hud.showBanner('CHARGE PLANTED', `${bot.name} planted at ${MAP.sites[bot.site].name}`, 3000);
      logEvent(`plant at ${bot.site} by ${bot.name}`);
    },
    onDefuse: (bot) => {
      defuses += 1;
      endRoundFor('defenders', 'CHARGE DEFUSED');
      logEvent(`defuse by ${bot.name}`);
    },
    onBotShot: (bot) => {
      const bm = bot.mover.state;
      const dist = Math.hypot(bm.x - m.x, bm.z - m.z);
      if (dist < 30) audio.enemyShot();
    },
  });

  // Elimination checks (not while the charge is planted: the fuse decides).
  if (rstate.phase === 'live' && charge.state !== 'planted') {
    if (aliveCount('attackers') === 0) endRoundFor('defenders', 'EMBERS ELIMINATED');
    else if (aliveCount('defenders') === 0) endRoundFor('attackers', 'WARDENS ELIMINATED');
  }

  grenades.update(dt, combatants);
  combat.updateTracers(dt);
  effects.update(dt);
  weaponRig.update(dt);

  // Charge mesh follows the charge state.
  if (charge.state === 'dropped' || charge.state === 'planted') {
    chargeMesh.visible = true;
    chargeMesh.position.set(charge.x, charge.state === 'planted' ? 0.12 : 0.12, charge.z);
    chargeLamp.material.color.setHex(
      charge.state === 'planted' && Math.floor(time * 2) % 2 === 0 ? 0xffffff : PALETTE.charge,
    );
  } else {
    chargeMesh.visible = false;
  }

  // Site rings pulse while the charge is planted there.
  for (const key of ['A', 'B']) {
    const ring = world.siteRings[key];
    if (ring) {
      ring.material.opacity = charge.state === 'planted' && charge.site === key
        ? 0.5 + 0.4 * Math.sin(time * 6)
        : 0.85;
    }
  }

  input.clearEdges();
}

// Buy an item from the menu. Returns true on success.
function buyItem(id) {
  const price = id === 'grenade' ? GRENADE_PRICE : id === 'armor' ? ARMOR_PRICE : WEAPONS[id].price;
  if (player.money < price) { audio.denied(); return false; }
  if (id === 'grenade') {
    if (player.grenades >= 2) { audio.denied(); return false; }
    player.grenades += 1;
  } else if (id === 'armor') {
    if (player.armor >= ARMOR_VALUE) { audio.denied(); return false; }
    player.armor = ARMOR_VALUE;
  } else {
    if (player.owned.has(id)) { audio.denied(); return false; }
    player.owned.add(id);
    if (id === 'marksman') {
      player.weapon = createWeaponState('marksman');
    } else {
      player.primary = id;
      player.primaryWeapon = createWeaponState(id);
      player.weapon = player.primaryWeapon;
    }
  }
  player.money -= price;
  audio.buy();
  hud.showBuy(true, player.money, player.owned);
  return true;
}

document.querySelectorAll('.buy-item').forEach((item) => {
  item.addEventListener('click', () => buyItem(item.dataset.item));
});
document.getElementById('deploy-btn').addEventListener('click', () => {
  audio.unlock();
  startMatch();
  input.requestLock();
});
renderer.domElement.addEventListener('click', () => {
  if (started && rounds.state.phase === 'live') input.requestLock();
});

// HUD refresh each rendered frame.
let mapTimer = 0;
function refreshHud(dt) {
  const rstate = rounds.state;
  const charge = rstate.charge;
  let chargeText = '';
  if (charge.state === 'carried') chargeText = charge.carrier === 'player' ? 'CHARGE IN HAND — REACH A SITE' : `CHARGE WITH ${charge.carrier}`;
  else if (charge.state === 'dropped') chargeText = 'CHARGE DROPPED — PICK IT UP';
  else if (charge.state === 'planted') chargeText = `CHARGE PLANTED AT ${charge.site} — ${Math.ceil(charge.fuse)}s`;
  let hint = '';
  if (!started) hint = '';
  else if (rstate.phase === 'buy') hint = 'PRESS B TO BUY — ROUND STARTS SOON';
  else if (player.channelKind === 'plant') hint = `PLANTING… ${Math.round((player.channel / PLANT_TIME) * 100)}% — HOLD E`;
  else if (player.channelKind === 'defuse') hint = `DEFUSING… ${Math.round((player.channel / DEFUSE_TIME) * 100)}% — HOLD E`;
  else if (charge.carrier === 'player' && rounds.siteAt(playerMover.state.x, playerMover.state.z)) hint = 'HOLD E TO PLANT THE CHARGE';
  else if (charge.state === 'planted' && Math.hypot(charge.x - playerMover.state.x, charge.z - playerMover.state.z) < 1.6) hint = 'HOLD E TO DEFUSE';
  else if (player.weapon.reloading > 0) hint = 'RELOADING…';
  hud.update({
    health: player.health,
    armor: player.armor,
    inMag: player.weapon.inMag,
    reserve: player.weapon.reserve,
    money: player.money,
    time: rstate.phaseTime,
    scoreA: rstate.score.attackers,
    scoreD: rstate.score.defenders,
    round: rstate.round,
    site: rounds.siteAt(playerMover.state.x, playerMover.state.z),
    chargeText,
    hint,
    flash: player.flash,
  });
  mapTimer -= dt;
  if (mapTimer <= 0) {
    mapTimer = 0.25;
    hud.drawMinimap(player, botsApi.bots.filter((b) => b.team === 'attackers'), charge);
  }
}

// Deterministic state hash: positions, health and score after N fixed steps.
function stateHash() {
  let h = 2166136261;
  const mix = (v) => {
    h ^= v & 0xffff;
    h = Math.imul(h, 16777619);
  };
  for (const c of combatants) {
    const m = c.mover.state;
    mix(Math.round(m.x * 100));
    mix(Math.round(m.z * 100));
    mix(Math.round(c.health));
    mix(c.alive ? 1 : 0);
  }
  mix(rounds.state.score.attackers);
  mix(rounds.state.score.defenders);
  mix(rounds.state.round);
  return (h >>> 0).toString(16);
}

function renderFrame() {
  const m = playerMover.state;
  camera.position.set(m.x, playerMover.eyeHeight(), m.z);
  camera.rotation.set(m.pitch, m.yaw, 0);
  renderer.render(scene, camera);
}

function frame(now) {
  if (frozen) return;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    stepSim(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  renderFrame();
  refreshHud(dt);
  if (!frozen) requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Shot modes: deterministic staged frames for the screenshots. ----
function hideBanner() {
  document.getElementById('banner').classList.remove('show');
}

function freezeShot(keepBanner = false) {
  if (!keepBanner) hideBanner();
  refreshHud(0.3);
  renderFrame();
  renderFrame();
  window.__shotReady = true;
  frozen = true;
}

function setupShot() {
  if (shot === 'start') {
    playerMover.teleport(-24, 19, 0.35);
    playerMover.state.pitch = -0.02;
    freezeShot();
    return;
  }
  startMatch();
  if (shot === 'buy') {
    hud.showBuy(true, player.money, player.owned);
    freezeShot();
    return;
  }
  if (shot === 'play') {
    // 8 seconds of live play: bots fight, the player pushes mid.
    for (let i = 0; i < 12 * 60; i += 1) stepSim(FIXED_STEP);
    rounds.beginLive();
    input.state.fire = false;
    for (let i = 0; i < 8 * 60; i += 1) stepSim(FIXED_STEP);
    // Place the player where a defender is actually visible: 7 m from one,
    // toward the map center, with a clear line of sight.
    let placed = false;
    for (const b of botsApi.bots) {
      if (!b.alive || b.team === 'attackers') continue;
      const t = b.mover.state;
      const cx = -t.x;
      const cz = -t.z;
      const cl = Math.hypot(cx, cz) || 1;
      const px = t.x + (cx / cl) * 7;
      const pz = t.z + (cz / cl) * 7;
      if (px < -29 || px > 29 || pz < -23 || pz > 23) continue;
      if (playerMover.collidesAt(px, 0, pz, 1.7)) continue;
      const los = world.segmentHit(px, 1.55, pz, t.x, b.mover.eyeHeight(), t.z);
      if (los !== null && los < 0.999) continue;
      playerMover.teleport(px, pz, Math.atan2(-(t.x - px), -(t.z - pz)));
      playerMover.state.pitch = 0.02;
      placed = true;
      break;
    }
    if (!placed) {
      // Fallback: mid, facing the nearest living defender.
      playerMover.teleport(0, 10, 0);
      let best = null;
      let bestD = Infinity;
      const m = playerMover.state;
      for (const b of botsApi.bots) {
        if (!b.alive || b.team === 'attackers') continue;
        const d = Math.hypot(b.mover.state.x - m.x, b.mover.state.z - m.z);
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best) {
        const t = best.mover.state;
        playerMover.state.yaw = Math.atan2(-(t.x - m.x), -(t.z - m.z));
        playerMover.state.pitch = 0.02;
      }
    }
    window.__stateHash = stateHash();
    freezeShot();
    return;
  }
  if (shot === 'end') {
    for (let i = 0; i < 12 * 60; i += 1) stepSim(FIXED_STEP);
    rounds.beginLive();
    for (let i = 0; i < 3 * 60; i += 1) stepSim(FIXED_STEP);
    rounds.plant('A', MAP.sites.A.center.x, MAP.sites.A.center.z);
    endRoundFor('attackers', 'CHARGE DETONATED');
    // Keep the round-won banner visible for this shot.
    freezeShot(true);
  }
}

// ---- Soak mode: play a whole match headlessly with the autopilot. ----
function runSoak() {
  startMatch();
  const maxSteps = 60 * 60 * 20; // 20 sim-minutes cap
  let steps = 0;
  let plantsAtStart = plants;
  while (rounds.state.phase !== 'matchEnd' && steps < maxSteps) {
    // 600 steps (10 sim-seconds) per chunk so the page stays responsive.
    for (let i = 0; i < 600 && rounds.state.phase !== 'matchEnd' && steps < maxSteps; i += 1) {
      stepSim(FIXED_STEP);
      steps += 1;
    }
    renderFrame();
    // Yield to the event loop between chunks.
    if (rounds.state.phase !== 'matchEnd' && steps < maxSteps) {
      // Synchronous loop with a manual break: run the rest in a timer instead.
      break;
    }
  }
  if (rounds.state.phase !== 'matchEnd' && steps < maxSteps) {
    // Continue asynchronously.
    const chunk = () => {
      for (let i = 0; i < 3600 && rounds.state.phase !== 'matchEnd' && steps < maxSteps; i += 1) {
        stepSim(FIXED_STEP);
        steps += 1;
      }
      renderFrame();
      if (rounds.state.phase !== 'matchEnd' && steps < maxSteps) {
        setTimeout(chunk, 0);
      } else {
        finishSoak(steps);
      }
    };
    setTimeout(chunk, 0);
    return;
  }
  finishSoak(steps);
  void plantsAtStart;
}

function finishSoak(steps) {
  const s = rounds.state;
  window.__soak = {
    done: s.phase === 'matchEnd',
    winner: s.matchWinner,
    score: `${s.score.attackers}:${s.score.defenders}`,
    roundsPlayed: s.round,
    steps,
    simSeconds: +(steps / 60).toFixed(1),
    plants,
    defuses,
    playerKills: player.kills,
    playerDeaths: player.deaths,
    shotsFired,
    errors: window.__errors,
    log: matchLog,
    trail,
    stateHash: stateHash(),
  };
  frozen = true;
}

// ---- Test modes: verify plant and defuse deterministically. ----
function runTest(kind) {
  startMatch();
  for (let i = 0; i < 12 * 60; i += 1) stepSim(FIXED_STEP);
  rounds.beginLive();
  const site = MAP.sites.A;
  if (kind === 'plant') {
    playerMover.teleport(site.center.x, site.center.z, 0);
    input.state.use = true;
    let ok = false;
    for (let i = 0; i < 10 * 60; i += 1) {
      stepSim(FIXED_STEP);
      if (rounds.state.charge.state === 'planted') { ok = true; break; }
    }
    input.state.use = false;
    renderFrame();
    window.__test = { name: 'plant', ok, chargeState: rounds.state.charge.state, errors: window.__errors };
  } else if (kind === 'defuse') {
    rounds.plant('A', site.center.x, site.center.z);
    playerMover.teleport(site.center.x + 1, site.center.z, 0);
    input.state.use = true;
    let ok = false;
    for (let i = 0; i < 10 * 60; i += 1) {
      stepSim(FIXED_STEP);
      if (rounds.state.charge.state === 'defused') { ok = true; break; }
    }
    input.state.use = false;
    renderFrame();
    window.__test = { name: 'defuse', ok, chargeState: rounds.state.charge.state, errors: window.__errors };
  }
  frozen = true;
}

// Debug accessor for headless verification: positions, states and health.
window.__debugState = () => ({
  time: +time.toFixed(1),
  phase: rounds.state.phase,
  round: rounds.state.round,
  score: `${rounds.state.score.attackers}:${rounds.state.score.defenders}`,
  charge: rounds.state.charge.state,
  player: {
    x: +playerMover.state.x.toFixed(1), z: +playerMover.state.z.toFixed(1),
    hp: Math.round(player.health), alive: player.alive, kills: player.kills,
  },
  bots: botsApi.bots.map((b) => ({
    name: b.name, team: b.team, x: +b.mover.state.x.toFixed(1), z: +b.mover.state.z.toFixed(1),
    hp: Math.round(b.health), alive: b.alive, state: b.state, site: b.site,
    pathLen: b.path.length, pathIdx: b.pathIndex, target: b.target ? b.target.name : null,
  })),
});

if (testMode) {
  runTest(testMode);
} else if (soakMode) {
  runSoak();
} else if (shot) {
  setupShot();
} else {
  if (autostart) startMatch();
  requestAnimationFrame(frame);
}
