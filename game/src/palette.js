// HELIO SCRAPYARD palette: a decommissioned solar-recycling yard at golden hour.
// Warm rust and amber against cool slate and teal glass; attackers wear ember
// orange, defenders wear warden teal, so the two teams read at a glance even in a
// long sightline. Every colour in the scene comes from here — no literals elsewhere.
export const PALETTE = {
  sky: 0x2e3a4a,
  fog: 0x2e3a4a,
  sun: 0xffd9a0,
  ground: 0x5c5648,
  groundDark: 0x4a453a,
  concrete: 0x8d8578,
  concreteDark: 0x6e685c,
  slate: 0x3f4a55,
  slateDark: 0x2c343d,
  rust: 0xa2542e,
  rustDark: 0x7c3e20,
  amber: 0xe8a33d,
  teal: 0x3fa7a0,
  tealDark: 0x2a6f6a,
  glass: 0x7fd4d8,
  panel: 0x1e3a5f,
  panelEdge: 0x9fb4c8,
  wood: 0x8a6a42,
  hazard: 0xf2c230,
  attacker: 0xd95d1e,
  attackerDark: 0x8f3a10,
  defender: 0x2e8f86,
  defenderDark: 0x1c5a55,
  charge: 0xff4d2e,
  tracer: 0xffe08a,
  muzzle: 0xffc861,
  smoke: 0x9aa0a3,
  white: 0xf2ede2,
  dark: 0x1a1d20,
};

// A palette hex as a CSS colour string, for the 2D minimap and DOM accents.
export function css(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
