// Drafting: riding in someone's slipstream cuts your air resistance. Roughly what wind-tunnel and track studies
// show for a single rider ahead: about a third less drag right on the wheel, about half that at 2 m, little beyond
// 10 m, and it falls away quickly if you're off to one side. A line of riders ahead adds up (each one shelters you a
// bit more), capped at half.
export const BIKE_LEN = 1.8; // metres between two riders' positions when wheel touches wheel

// Drag saved by one rider `gap` metres ahead (position to position) and `lateral` metres to the side
export function draftFrom(gap, lateral) {
  const wheel = gap - BIKE_LEN;                 // space between their back wheel and our front wheel
  if (wheel < -0.3 || wheel > 12) return 0;       // alongside, or too far back
  const along = wheel <= 0.3 ? 1 : Math.exp(-(wheel - 0.3) / 2.6);
  const side = Math.abs(lateral);
  const across = side <= 0.3 ? 1 : Math.max(0, 1 - (side - 0.3) / 0.9); // gone 1.2 m across
  return 0.35 * along * across;
}

// Total saving for `me` ({ dist, side }) from everyone in `riders` ({ id, dist, side }), and who shelters us most
export function draftFor(me, riders) {
  let keep = 1, best = null, bestR = 0;
  for (const o of riders) {
    if (o.id === me.id) continue;
    const r = draftFrom(o.dist - me.dist, o.side - me.side);
    if (r <= 0) continue;
    keep *= 1 - r;
    if (r > bestR) { bestR = r; best = o; }
  }
  return { draft: Math.min(0.5, 1 - keep), leader: best };
}
