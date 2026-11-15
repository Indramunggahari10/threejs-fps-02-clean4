// Rounds and money: one state machine owns the match. Buy time, live round, round
// end, next round; the core charge (plant 4 s, fuse 40 s, defuse 5 s); economy
// with kill rewards, round-win bonuses and an escalating loss bonus; first to 5
// rounds takes the match, at most 9 rounds. The player always attacks with the
// Embers; the charge starts in the player's hands each round.
import { MAP } from './mapdata.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const FUSE_TIME = 40;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 5;
export const ROUNDS_TO_WIN = 5;
export const MAX_ROUNDS = 9;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_BASE = 1900;
export const LOSS_STEP = 500;
export const LOSS_MAX = 3400;
export const PLANT_REWARD = 300;

export function createRounds() {
  const state = {
    phase: 'buy', // buy | live | ended | matchEnd
    phaseTime: BUY_TIME,
    round: 1,
    score: { attackers: 0, defenders: 0 },
    lossStreak: { attackers: 0, defenders: 0 },
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    charge: {
      state: 'carried', // carried | dropped | planted | defused | exploded
      site: null, x: 0, z: 0, fuse: 0, carrier: 'player',
    },
  };

  function startRound() {
    state.phase = 'buy';
    state.phaseTime = BUY_TIME;
    state.roundWinner = null;
    state.roundReason = '';
    state.charge.state = 'carried';
    state.charge.site = null;
    state.charge.fuse = 0;
    state.charge.carrier = 'player';
  }

  function beginLive() {
    state.phase = 'live';
    state.phaseTime = ROUND_TIME;
  }

  function endRound(winner, reason) {
    if (state.phase === 'ended' || state.phase === 'matchEnd') return null;
    const wonRounds = state.score[winner] + 1;
    const lastRound = state.round >= MAX_ROUNDS;
    state.phase = (wonRounds >= ROUNDS_TO_WIN || lastRound) ? 'matchEnd' : 'ended';
    state.phaseTime = 4.5;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.score[winner] += 1;
    const loser = winner === 'attackers' ? 'defenders' : 'attackers';
    state.lossStreak[winner] = 0;
    state.lossStreak[loser] += 1;
    if (state.phase === 'matchEnd') {
      state.matchWinner = state.score.attackers === state.score.defenders
        ? 'draw'
        : (state.score.attackers > state.score.defenders ? 'attackers' : 'defenders');
    }
    return {
      winner,
      loser,
      winReward: WIN_REWARD,
      lossReward: Math.min(LOSS_MAX, LOSS_BASE + (state.lossStreak[loser] - 1) * LOSS_STEP),
    };
  }

  function nextRound() {
    state.round += 1;
    startRound();
  }

  function plant(site, x, z) {
    state.charge.state = 'planted';
    state.charge.site = site;
    state.charge.x = x;
    state.charge.z = z;
    state.charge.fuse = FUSE_TIME;
    state.charge.carrier = null;
  }

  function drop(x, z) {
    if (state.charge.state !== 'carried') return;
    state.charge.state = 'dropped';
    state.charge.x = x;
    state.charge.z = z;
    state.charge.carrier = null;
  }

  function pickup(carrier) {
    state.charge.state = 'carried';
    state.charge.carrier = carrier;
  }

  function defuse() {
    state.charge.state = 'defused';
  }

  function explode() {
    state.charge.state = 'exploded';
  }

  function siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const site = MAP.sites[key];
      if (Math.hypot(x - site.center.x, z - site.center.z) < site.radius) return key;
    }
    return null;
  }

  // Fuse countdown while planted; returns 'exploded' the frame it blows.
  function tick(dt) {
    if (state.phase !== 'live') return null;
    state.phaseTime -= dt;
    if (state.charge.state === 'planted') {
      state.charge.fuse -= dt;
      if (state.charge.fuse <= 0) {
        explode();
        return 'exploded';
      }
    }
    if (state.phaseTime <= 0) {
      if (state.charge.state === 'planted') return null; // fuse decides it
      return 'timeout';
    }
    return null;
  }

  return {
    state, startRound, beginLive, endRound, nextRound,
    plant, drop, pickup, defuse, explode, siteAt, tick,
  };
}
