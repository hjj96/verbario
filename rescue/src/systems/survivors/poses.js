// Gestures (DESIGN §2.10 «Движение», §4 #18, #21, #22, #25, #26): the CPU picks a pose per person and
// writes arm angles into instance attributes; the vertex shader bends the limbs.
//
// Arm angles: θ from straight down (0) to straight up (π); ψ from sideways-out (0) to the front (π/2).
//   wave2   both arms over the head, 1.1 Hz (closer than 60 m)
//   wave1   one arm, 1.1 Hz (closer than 120 m)
//   limp    one slow arm, 0.5 Hz (warmth < 0.4)
//   still   no arms (warmth < 0.15)
//   panic   2 Hz flailing (whirlpool)
//   shield  forearm over the face in strong downwash
//   hold    «цветок»: hands held in a ring (reaching to the neighbours)
//   cable   both hands on the strop in the basket
//   raise   people in a raft lift their hands when the basket comes
import { approach } from './tables.js';

const TAU = Math.PI * 2;

export const POSE = {
  idle: 0, wave1: 1, wave2: 2, limp: 3, still: 4, panic: 5, shield: 6, hold: 7, cable: 8,
  stretcher: 9, deck: 10, sit: 11, raise: 12, keel: 13, flare: 14, mirror: 15, frozen: 16,
};

// Writes target angles into out[0..3] = θL, ψL, θR, ψR. p = person (phase, waveArm), t = time.
export function poseTargets(pose, p, t, out, ringN = 4) {
  const ph = p.phase;
  const arm = p.waveArm; // which arm waves alone (−1 left, +1 right)
  // gentle sculling in the water for the arm that is not doing anything
  const scL = 0.78 + 0.12 * Math.sin(t * 0.9 + ph);
  const scR = 0.78 + 0.12 * Math.sin(t * 0.9 + ph + 1.7);
  switch (pose) {
    case POSE.wave1: {
      const w = 2.55 + 0.38 * Math.sin(TAU * 1.1 * t + ph);
      if (arm < 0) set(out, w, 0.25, scR, 0.55);
      else set(out, scL, 0.55, w, 0.25);
      break;
    }
    case POSE.wave2: {
      const a = TAU * 1.1 * t + ph;
      set(out, 2.72 + 0.34 * Math.sin(a), 0.18, 2.72 + 0.34 * Math.sin(a + Math.PI), 0.18);
      break;
    }
    case POSE.limp: {
      const w = 1.95 + 0.28 * Math.sin(TAU * 0.5 * t + ph);
      if (arm < 0) set(out, w, 0.6, 0.42, 0.4);
      else set(out, 0.42, 0.4, w, 0.6);
      break;
    }
    case POSE.still:
      set(out, 0.34, 0.3, 0.36, 0.28);
      break;
    case POSE.panic: {
      const a = TAU * 2 * t + ph;
      set(out, 1.7 + 0.95 * Math.sin(a), 0.7 * Math.sin(a * 1.31 + 0.6), 1.7 + 0.95 * Math.sin(a + 2.1), 0.7 * Math.sin(a * 1.17 + 2.4));
      break;
    }
    case POSE.shield:
      if (arm < 0) set(out, 2.25, 1.8, scR, 0.55);
      else set(out, scL, 0.55, 2.25, 1.8);
      break;
    case POSE.hold: {
      const ps = Math.PI / Math.max(2, ringN);
      const bob = 0.06 * Math.sin(t * 0.7 + ph);
      set(out, 1.42 + bob, ps, 1.42 - bob, ps);
      break;
    }
    case POSE.cable:
      set(out, 2.5 + 0.05 * Math.sin(t * 1.3 + ph), 1.25, 2.5 + 0.05 * Math.sin(t * 1.1 + ph + 1), 1.25);
      break;
    case POSE.stretcher:
      set(out, 0.22, 0.0, 0.22, 0.0);
      break;
    case POSE.deck:
      set(out, 0.14 + 0.04 * Math.sin(t * 0.6 + ph), 0.15, 0.14 + 0.04 * Math.sin(t * 0.55 + ph + 2), 0.15);
      break;
    case POSE.sit:
      set(out, 0.95, 1.05, 0.95, 1.05);
      break;
    case POSE.raise: {
      const a = TAU * 0.8 * t + ph;
      set(out, 2.75 + 0.15 * Math.sin(a), 0.35, 2.75 + 0.15 * Math.sin(a + 1.3), 0.35);
      break;
    }
    case POSE.keel:
      if (arm < 0) set(out, scL, 0.5, 1.15, 1.25);
      else set(out, 1.15, 1.25, scR, 0.5);
      break;
    case POSE.flare: {
      const s = 0.06 * Math.sin(t * 2.1 + ph);
      if (arm < 0) set(out, 2.65 + s, 0.45, scR, 0.55);
      else set(out, scL, 0.55, 2.65 + s, 0.45);
      break;
    }
    case POSE.mirror: {
      const s = 0.05 * Math.sin(t * 7 + ph);
      if (arm < 0) set(out, 2.0 + s, 1.25, scR, 0.55);
      else set(out, scL, 0.55, 2.0 + s, 1.25);
      break;
    }
    default:
      set(out, scL, 0.55, scR, 0.55);
  }
  return out;
}

function set(out, a, b, c, d) {
  out[0] = a;
  out[1] = b;
  out[2] = c;
  out[3] = d;
}

// Smoothly move the person's current arm angles towards the targets (frozen people do not move).
export function applyPose(p, target, dt, lambda = 11) {
  p.aL = approach(p.aL, target[0], lambda, dt);
  p.pL = approach(p.pL, target[1], lambda, dt);
  p.aR = approach(p.aR, target[2], lambda, dt);
  p.pR = approach(p.pR, target[3], lambda, dt);
}
