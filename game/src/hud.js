// HUD: every DOM read and write for the match lives here, so the simulation
// never touches the document. The minimap is a small canvas redrawn a few times a
// second: walls, sites, the charge, teammates and the player arrow. The killfeed
// keeps the last five lines.
import { MAP } from './mapdata.js';
import { PALETTE, css } from './palette.js';

export function createHud() {
  const el = (id) => document.getElementById(id);
  const healthEl = el('hud-health');
  const armorEl = el('hud-armor');
  const ammoEl = el('hud-ammo');
  const moneyEl = el('hud-money');
  const timerEl = el('hud-timer');
  const scoreEl = el('hud-score');
  const roundEl = el('hud-round');
  const siteEl = el('hud-site');
  const chargeEl = el('hud-charge');
  const bannerEl = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const feedEl = el('killfeed');
  const buyEl = el('buy-menu');
  const flashEl = el('flash-overlay');
  const menuEl = el('start-menu');
  const hintEl = el('hud-hint');
  const mapCanvas = el('minimap');
  const mapCtx = mapCanvas ? mapCanvas.getContext('2d') : null;

  const feed = [];

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function update(state) {
    setText(healthEl, `${Math.ceil(state.health)}`);
    setText(armorEl, `${Math.ceil(state.armor)}`);
    setText(ammoEl, `${state.inMag} / ${state.reserve}`);
    setText(moneyEl, `$${state.money}`);
    const t = Math.max(0, Math.ceil(state.time));
    setText(timerEl, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    setText(scoreEl, `${state.scoreA} — ${state.scoreD}`);
    setText(roundEl, `ROUND ${state.round} / 9`);
    setText(siteEl, state.site ? `SITE ${state.site} — ${MAP.sites[state.site].name}` : '');
    setText(chargeEl, state.chargeText);
    if (flashEl) flashEl.style.opacity = String(Math.min(1, (state.flash || 0) / 2.2));
    if (hintEl) {
      const hint = state.hint || '';
      if (hintEl.textContent !== hint) hintEl.textContent = hint;
    }
    if (healthEl) {
      healthEl.classList.toggle('low', state.health <= 30);
    }
  }

  function showBanner(title, sub, ms = 3500) {
    if (!bannerEl) return;
    bannerTitle.textContent = title;
    bannerSub.textContent = sub || '';
    bannerEl.classList.add('show');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => bannerEl.classList.remove('show'), ms);
  }

  function killfeed(text) {
    feed.push(text);
    while (feed.length > 5) feed.shift();
    if (feedEl) feedEl.innerHTML = feed.map((line) => `<div>${line}</div>`).join('');
  }

  function showBuy(show, money, owned) {
    if (!buyEl) return;
    buyEl.classList.toggle('show', show);
    if (show) {
      const items = buyEl.querySelectorAll('[data-price]');
      for (const item of items) {
        const price = Number(item.dataset.price);
        const id = item.dataset.item;
        const cant = price > money || (owned && owned.has(id));
        item.classList.toggle('cant', cant);
      }
      const moneyNode = el('buy-money');
      if (moneyNode) moneyNode.textContent = `$${money}`;
    }
  }

  function showMenu(show) {
    if (menuEl) menuEl.classList.toggle('show', show);
  }

  function drawMinimap(player, teammates, charge) {
    if (!mapCtx) return;
    const W = mapCanvas.width;
    const H = mapCanvas.height;
    const sx = W / 62;
    const sz = H / 50;
    const toX = (x) => (x + 31) * sx;
    const toZ = (z) => (z + 25) * sz;
    mapCtx.fillStyle = 'rgba(10,14,18,0.78)';
    mapCtx.fillRect(0, 0, W, H);
    mapCtx.fillStyle = '#8d8578';
    for (const [w, h, d, x, y, z] of MAP.boxes) {
      if (h < 2) continue;
      mapCtx.fillRect(toX(x - w / 2), toZ(z - d / 2), w * sx, d * sz);
    }
    for (const key of ['A', 'B']) {
      const site = MAP.sites[key];
      mapCtx.strokeStyle = css(PALETTE.amber);
      mapCtx.lineWidth = 1.5;
      mapCtx.beginPath();
      mapCtx.arc(toX(site.center.x), toZ(site.center.z), site.radius * sx, 0, Math.PI * 2);
      mapCtx.stroke();
      mapCtx.fillStyle = css(PALETTE.amber);
      mapCtx.font = 'bold 11px sans-serif';
      mapCtx.fillText(key, toX(site.center.x) - 3, toZ(site.center.z) + 4);
    }
    if (charge && (charge.state === 'dropped' || charge.state === 'planted')) {
      mapCtx.fillStyle = css(PALETTE.charge);
      mapCtx.beginPath();
      mapCtx.arc(toX(charge.x), toZ(charge.z), 4, 0, Math.PI * 2);
      mapCtx.fill();
    }
    mapCtx.fillStyle = css(PALETTE.defender);
    for (const t of teammates) {
      if (!t.alive) continue;
      mapCtx.beginPath();
      mapCtx.arc(toX(t.mover.state.x), toZ(t.mover.state.z), 3, 0, Math.PI * 2);
      mapCtx.fill();
    }
    if (player) {
      const m = player.mover.state;
      mapCtx.save();
      mapCtx.translate(toX(m.x), toZ(m.z));
      mapCtx.rotate(-m.yaw);
      mapCtx.fillStyle = css(PALETTE.attacker);
      mapCtx.beginPath();
      mapCtx.moveTo(0, -6);
      mapCtx.lineTo(4.5, 5);
      mapCtx.lineTo(-4.5, 5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    }
  }

  return { update, showBanner, killfeed, showBuy, showMenu, drawMinimap };
}
