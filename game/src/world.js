// World: turns MAP into meshes, lights, colliders and the raycast target list.
// Colliders are plain AABBs, one per box and per barrel, so movement and bullets
// share the same geometry the player sees. Nothing here allocates per frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP } from './mapdata.js';

const MAT_COLORS = {
  concrete: PALETTE.concrete,
  concreteDark: PALETTE.concreteDark,
  slate: PALETTE.slate,
  slateDark: PALETTE.slateDark,
  rust: PALETTE.rust,
  rustDark: PALETTE.rustDark,
  wood: PALETTE.wood,
  panel: PALETTE.panel,
  hazard: PALETTE.hazard,
};

// A canvas texture for the yard floor: cracked concrete with a faint grid.
function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#5c5648';
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i += 1) {
    ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(512, i * 64); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  for (let i = 0; i < 40; i += 1) {
    const x = (i * 97) % 512;
    const y = (i * 173) % 512;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 30, y + 12); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene) {
  const materials = new Map();
  function materialFor(name) {
    if (!materials.has(name)) {
      const color = MAT_COLORS[name] ?? PALETTE.concrete;
      materials.set(name, new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 }));
    }
    return materials.get(name);
  }

  const colliders = [];
  const shootables = [];
  const siteRings = {};

  // Sun + sky.
  const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x4a4034, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
  sun.position.set(28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 120;
  scene.add(sun);

  // Floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(62, 50),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  shootables.push(floor);

  // Map boxes.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [w, h, d, x, y, z, mat] of MAP.boxes) {
    const mesh = new THREE.Mesh(boxGeo, materialFor(mat));
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = h > 2;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootables.push(mesh);
    colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minY: y - h / 2, maxY: y + h / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
    });
    // Tilted solar glass on top of each panel array so it reads as a panel, not a slab.
    if (mat === 'panel') {
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.2, 0.08, d - 0.2),
        new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.15, metalness: 0.6 }),
      );
      glass.position.set(x, y + h / 2 + 0.12, z);
      glass.rotation.z = 0.12;
      scene.add(glass);
    }
  }

  // Barrels.
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 14);
  const barrelMat = new THREE.MeshStandardMaterial({ color: PALETTE.rustDark, roughness: 0.6, metalness: 0.4 });
  for (const [x, z] of MAP.barrels) {
    const mesh = new THREE.Mesh(barrelGeo, barrelMat);
    mesh.position.set(x, 0.55, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootables.push(mesh);
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minY: 0, maxY: 1.1, minZ: z - 0.45, maxZ: z + 0.45 });
  }

  // Site rings: a glowing outline on the floor plus a floating label sprite.
  for (const key of ['A', 'B']) {
    const site = MAP.sites[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.25, site.radius, 48),
      new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center.x, 0.03, site.center.z);
    scene.add(ring);
    siteRings[key] = ring;
  }

  // Perimeter light poles so the yard reads at dusk.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 7, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: PALETTE.slateDark, roughness: 0.7, metalness: 0.3 });
  const lampMat = new THREE.MeshBasicMaterial({ color: PALETTE.amber });
  for (const [x, z] of [[-28, -22], [28, -22], [-28, 22], [28, 22], [0, -22], [0, 22]]) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 3.5, z);
    scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMat);
    lamp.position.set(x, 7.1, z);
    scene.add(lamp);
  }

  // Distant skyline silhouettes outside the walls, so the horizon is not empty.
  const skylineMat = new THREE.MeshStandardMaterial({ color: PALETTE.slateDark, roughness: 1 });
  const skyline = [
    [-45, 8, -34, 14, 18, 4], [40, 10, -36, 18, 22, 4], [-48, 6, 20, 10, 14, 4],
    [46, 7, 24, 12, 16, 4], [-20, 12, -40, 10, 26, 4], [18, 9, -42, 14, 20, 4],
  ];
  for (const [x, y, z, w, h, d] of skyline) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skylineMat);
    block.position.set(x, y, z);
    scene.add(block);
  }

  // AABB test shared by the mover and the bullet tracer.
  function hitsBox(px, py, pz, box) {
    return px >= box.minX && px <= box.maxX
      && py >= box.minY && py <= box.maxY
      && pz >= box.minZ && pz <= box.maxZ;
  }

  // Segment vs AABB (slab test). Returns the smallest entry t in [0, 1] or null.
  function segmentHit(ax, ay, az, bx, by, bz) {
    let best = null;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    for (const box of colliders) {
      let lo = 0;
      let hi = 1;
      const axes = [
        [ax, dx, box.minX, box.maxX],
        [ay, dy, box.minY, box.maxY],
        [az, dz, box.minZ, box.maxZ],
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
      if (ok && (best === null || lo < best)) best = lo;
    }
    return best;
  }

  return { colliders, shootables, siteRings, hitsBox, segmentHit };
}
