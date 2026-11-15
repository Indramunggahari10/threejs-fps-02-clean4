// Effects: pooled impact sparks and the DOM hitmarker / damage vignette. The
// spark pool is one THREE.Points cloud with a fixed capacity; a burst writes into
// the next slots and fades them, so firefights allocate nothing per frame.
import * as THREE from 'three';

const CAPACITY = 240;

export function createEffects(scene) {
  const positions = new Float32Array(CAPACITY * 3);
  const colors = new Float32Array(CAPACITY * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  const velocities = new Float32Array(CAPACITY * 3);
  const life = new Float32Array(CAPACITY);
  let cursor = 0;

  const hitmarker = document.getElementById('hitmarker');
  const damageEl = document.getElementById('damage-overlay');

  function burst(pos, color, count, speed = 3.5) {
    for (let i = 0; i < count; i += 1) {
      const idx = cursor;
      cursor = (cursor + 1) % CAPACITY;
      positions[idx * 3] = pos.x;
      positions[idx * 3 + 1] = pos.y;
      positions[idx * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      velocities[idx * 3] = Math.cos(a) * Math.cos(b) * speed * (0.4 + Math.random() * 0.8);
      velocities[idx * 3 + 1] = Math.sin(b) * speed * (0.4 + Math.random() * 0.8) + 1.2;
      velocities[idx * 3 + 2] = Math.sin(a) * Math.cos(b) * speed * (0.4 + Math.random() * 0.8);
      const c = new THREE.Color(color);
      colors[idx * 3] = c.r;
      colors[idx * 3 + 1] = c.g;
      colors[idx * 3 + 2] = c.b;
      life[idx] = 0.35 + Math.random() * 0.25;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  function update(dt) {
    let any = false;
    for (let i = 0; i < CAPACITY; i += 1) {
      if (life[i] <= 0) continue;
      any = true;
      life[i] -= dt;
      if (life[i] <= 0) {
        positions[i * 3 + 1] = -100;
        continue;
      }
      velocities[i * 3 + 1] -= 9 * dt;
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
    }
    if (any) geo.attributes.position.needsUpdate = true;
  }

  function showHitmarker(kill) {
    if (!hitmarker) return;
    hitmarker.classList.remove('kill');
    if (kill) hitmarker.classList.add('kill');
    hitmarker.classList.remove('show');
    void hitmarker.offsetWidth;
    hitmarker.classList.add('show');
  }

  function showDamage() {
    if (!damageEl) return;
    damageEl.classList.remove('show');
    void damageEl.offsetWidth;
    damageEl.classList.add('show');
  }

  return { burst, update, showHitmarker, showDamage };
}
