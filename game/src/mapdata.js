// HELIO SCRAPYARD map data: a decommissioned solar-panel recycling yard, 60 x 48 m.
// North is -z. The Embers attack from the south-west, the Wardens hold from the
// north-east. Site A (FOUNDRY) is the north-west yard, site B (KILN) the east yard;
// mid runs through a sorting hall whose two blocks leave a 3 m corridor. Boxes are
// [width, height, depth, x, y, z, material]; every box is a collider and stops
// bullets. Nodes are the bot nav graph; every edge was checked to clear the boxes.
export const MAP = {
  name: 'HELIO SCRAPYARD',
  bounds: { minX: -30, maxX: 30, minZ: -24, maxZ: 24 },

  boxes: [
    // Perimeter walls.
    [61, 6, 1, 0, 3, -24.5, 'concrete'],
    [61, 6, 1, 0, 3, 24.5, 'concrete'],
    [1, 6, 49, -30.5, 3, 0, 'concrete'],
    [1, 6, 49, 30.5, 3, 0, 'concrete'],
    // Sorting hall: two blocks with a 3 m corridor between them, roof slab over it.
    [7, 6, 12, -5, 3, 0, 'slate'],
    [7, 6, 12, 5, 3, 0, 'slate'],
    [3.4, 0.5, 12, 0, 6.2, 0, 'slateDark'],
    // South mid gate, central gap at x -5..5.
    [10, 6, 1, -10, 3, 10, 'concrete'],
    [10, 6, 1, 10, 3, 10, 'concrete'],
    // North mid gate, central gap at x -5..5.
    [10, 6, 1, -10, 3, -10, 'concrete'],
    [10, 6, 1, 10, 3, -10, 'concrete'],
    // A site (FOUNDRY) enclosure: east wall and south wall, two entrances.
    [1, 6, 7, -12, 3, -16.5, 'concrete'],
    [9, 6, 1, -21, 3, -9, 'concrete'],
    // B site (KILN) north wall with a 2.5 m gap, south wall with a 2.5 m gap.
    [5, 6, 1, 17.5, 3, -1, 'concrete'],
    [5, 6, 1, 25, 3, -1, 'concrete'],
    [7, 6, 1, 18.5, 3, 11, 'concrete'],
    [5, 6, 1, 27, 3, 11, 'concrete'],
    // The kiln furnace inside site B.
    [3, 2.6, 3, 27, 1.3, 2, 'rust'],
    // Solar panel arrays: low cover you can shoot over while crouched behind.
    [6, 1.3, 2, -18, 0.65, 2, 'panel'],
    [6, 1.3, 2, 8, 0.65, 14, 'panel'],
    [6, 1.3, 2, -8, 0.65, -14, 'panel'],
    [6, 1.3, 2, 20, 0.65, -16, 'panel'],
    // Crates: crouch cover and corners worth playing.
    [1.4, 1.1, 1.4, -26, 0.55, 4, 'wood'],
    [1.4, 1.1, 1.4, -14, 0.55, -4, 'wood'],
    [1.4, 1.1, 1.4, 14, 0.55, -18, 'wood'],
    [1.4, 1.1, 1.4, -2, 0.55, 16, 'wood'],
    [1.4, 1.1, 1.4, 16, 0.55, 10, 'wood'],
    [1.4, 1.1, 1.4, -24, 0.55, 10, 'wood'],
    [1.4, 1.1, 1.4, 26, 0.55, -8, 'wood'],
    [1.4, 1.1, 1.4, 10, 0.55, -18, 'wood'],
    [2.4, 1.1, 1.2, -20, 0.55, -12, 'wood'],
    [2.4, 1.1, 1.2, 18, 0.55, 0, 'wood'],
  ],

  // Freestanding barrels: cylinders with a box collider each.
  barrels: [
    [-25, 4], [-19, -2], [12, 15], [25, 2], [-26, -16], [13, -9], [7, -13], [-6, 16],
  ],

  sites: {
    A: { name: 'FOUNDRY', center: { x: -21, z: -15 }, radius: 5.5 },
    B: { name: 'KILN', center: { x: 21, z: 5 }, radius: 5.5 },
  },

  spawns: {
    attackers: [
      [-26, 19, 0], [-23, 20, 0.2], [-26, 16, -0.2], [-21, 19, 0.4], [-24, 14, 0],
    ],
    defenders: [
      [26, -19, Math.PI], [23, -20, Math.PI - 0.2], [26, -16, Math.PI + 0.2],
      [21, -19, Math.PI - 0.4], [24, -14, Math.PI],
    ],
  },

  // Nav graph nodes [x, z]. Indices are used by bots.js findPath. Every node
  // sits in open ground and every edge was checked to clear the boxes.
  nodes: [
    [-24, 18], [-18, 12], [-8, 12], [0, 12], [8, 12], [18, 12],
    [24, 14], [24, 5], [21, 5], [24, -8], [24, -19], [12, -16],
    [0, -12], [-8, -12], [-21, -15], [-24, -6], [-24, 4], [-14, 4],
    [0, 0], [0, -8], [0, 8], [-12, 0], [12, 0], [12, 8],
    [-14, -8], [17, -8], [21, -4], [-17, -12],
  ],

  edges: [
    [0, 1], [1, 2], [1, 16], [1, 17], [2, 3], [3, 4], [3, 17], [3, 20],
    [4, 5], [5, 6], [6, 7], [7, 8], [7, 23], [8, 26], [9, 10],
    [9, 26], [10, 11], [11, 12], [11, 25], [12, 13], [12, 19], [13, 27],
    [14, 24], [15, 16], [15, 24], [16, 17], [17, 21], [18, 19], [18, 20],
    [19, 12], [20, 3], [21, 24], [22, 8], [22, 23], [23, 20], [25, 26],
    [27, 24],
  ],
};
