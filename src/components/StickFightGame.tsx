import { useRef, useEffect, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { MovementType } from '../utils/movementAnalyzer';
import { PoseResult, POSE_LANDMARKS } from '../utils/poseDetection';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? '',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
);

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type AnimState = 'idle' | 'walk_fwd' | 'walk_back' | 'kick' | 'punch' | 'crouch' | 'hurt' | 'ko';
type KickZone = 'head' | 'body' | 'leg';
type LobbyStep = 'level' | 'player_color' | 'bot_color';
type GamePhase = 'lobby' | 'countdown' | 'fighting' | 'result';
type Difficulty = 1 | 2 | 3;

interface Fighter {
  x: number;
  health: number;
  anim: AnimState;
  animT: number;
  animDur: number;
  facingRight: boolean;
  invFrames: number;
  hitFlash: number;
  pendingKickZone: KickZone;
  scale: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}

interface FloatText {
  x: number; y: number;
  text: string; color: string;
  vy: number; life: number; maxLife: number;
}

interface GameConfig {
  difficulty: Difficulty;
  playerColor: string;
  botColor: string;
}

interface GameState {
  player: Fighter;
  bot: Fighter;
  particles: Particle[];
  floats: FloatText[];
  botAttackCD: number;
  botMoveCD: number;
  phase: GamePhase;
  lobbyStep: LobbyStep;
  dwellZone: number;
  dwellFrames: number;
  countdownFrames: number;
  config: GameConfig;
}

interface StickFightGameProps {
  movement: MovementType;
  poseData: PoseResult | null;
  isRunning: boolean;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const MAX_HP = 150;
const ATTACK_DIST = 135;
const ANIM_DURS: Record<AnimState, number> = {
  idle: Infinity, walk_fwd: Infinity, walk_back: Infinity,
  kick: 28, punch: 24, crouch: Infinity, hurt: 20, ko: Infinity,
};
const DWELL_REQ = 100; // frames (~1.7s) to confirm lobby selection
const AUTOSTART_FRAMES = 600; // 10s auto-start with defaults if no pose

const ZONE_DMG: Record<KickZone, number> = { head: 50, body: 40, leg: 35 };
const PUNCH_DMG = 30;

const COLORS = ['#dc2626', '#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#0891b2'];
const COLOR_NAMES = ['RED', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE', 'CYAN'];

interface BotConfig {
  speedMult: number;
  attackCDMin: number;
  attackCDMax: number;
  dodgeChance: number;
  hitZones: KickZone[];
}

const BOT_CONFIGS: Record<Difficulty, BotConfig> = {
  1: { speedMult: 0.65, attackCDMin: 160, attackCDMax: 230, dodgeChance: 0.04, hitZones: ['leg'] },
  2: { speedMult: 1.0,  attackCDMin: 90,  attackCDMax: 140, dodgeChance: 0.22, hitZones: ['body', 'leg'] },
  3: { speedMult: 1.45, attackCDMin: 42,  attackCDMax: 72,  dodgeChance: 0.50, hitZones: ['head', 'body', 'body', 'leg'] },
};

const DIFF_LABELS: Record<Difficulty, string> = { 1: 'EASY', 2: 'MEDIUM', 3: 'HARD' };
const DIFF_COLORS: Record<Difficulty, string> = { 1: '#16a34a', 2: '#ca8a04', 3: '#dc2626' };

// ─────────────────────────────────────────────────────────
// Supabase helpers
// ─────────────────────────────────────────────────────────

const SESSION_ID = Math.random().toString(36).slice(2, 10);

async function saveScore(winner: 'player' | 'bot', config: GameConfig, playerHp: number) {
  try {
    await supabase.from('mk9_scores').insert({
      winner,
      difficulty: config.difficulty,
      player_color: config.playerColor,
      bot_color: config.botColor,
      player_hp_remaining: playerHp,
      session_id: SESSION_ID,
    });
  } catch { /* silently fail */ }
}

async function fetchWinStreak(): Promise<number> {
  try {
    const { data } = await supabase
      .from('mk9_scores')
      .select('winner')
      .eq('session_id', SESSION_ID)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data) return 0;
    let streak = 0;
    for (const row of data) {
      if (row.winner === 'player') streak++;
      else break;
    }
    return streak;
  } catch { return 0; }
}

async function fetchTotalScore(): Promise<number> {
  try {
    const { data } = await supabase
      .from('mk9_scores')
      .select('winner, difficulty, player_hp_remaining')
      .eq('session_id', SESSION_ID);
    if (!data) return 0;
    return data.reduce((acc, row) => {
      if (row.winner !== 'player') return acc;
      return acc + 10 + row.difficulty * 5 + Math.floor(row.player_hp_remaining / 10);
    }, 0);
  } catch { return 0; }
}

// ─────────────────────────────────────────────────────────
// Pose analysis utilities
// ─────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function getArenaX(pose: PoseResult | null, cw: number): number | null {
  if (!pose?.landmarks) return null;
  const nose = pose.landmarks[POSE_LANDMARKS.NOSE];
  if (!nose || nose.visibility < 0.4) return null;
  // Mirror so player walks naturally (left in real life → left in arena)
  const mirrored = 1 - nose.x;
  return cw * clamp(mirrored * 1.1 - 0.05, 0.06, 0.94); // slight stretch + margin
}

function getKickZone(pose: PoseResult | null): KickZone {
  if (!pose?.landmarks) return 'body';
  const L = pose.landmarks;
  const lAnkle = L[POSE_LANDMARKS.LEFT_ANKLE];
  const rAnkle = L[POSE_LANDMARKS.RIGHT_ANKLE];
  const lHip   = L[POSE_LANDMARKS.LEFT_HIP];
  const rHip   = L[POSE_LANDMARKS.RIGHT_HIP];
  const lShoulder = L[POSE_LANDMARKS.LEFT_SHOULDER];
  const rShoulder = L[POSE_LANDMARKS.RIGHT_SHOULDER];

  const hipY      = (lHip.y + rHip.y) / 2;
  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  // Lower Y = higher up in frame
  const highAnkleY = Math.min(lAnkle.y, rAnkle.y);

  if (highAnkleY <= shoulderY + 0.06) return 'head';
  if (highAnkleY <= hipY + 0.04)      return 'body';
  return 'leg';
}

function getBodyScale(pose: PoseResult | null): number {
  if (!pose?.landmarks) return 1.0;
  const L = pose.landmarks;
  const lShoulder = L[POSE_LANDMARKS.LEFT_SHOULDER];
  const rShoulder = L[POSE_LANDMARKS.RIGHT_SHOULDER];
  const lHip = L[POSE_LANDMARKS.LEFT_HIP];
  const rHip = L[POSE_LANDMARKS.RIGHT_HIP];
  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  const hipY = (lHip.y + rHip.y) / 2;
  const bodyH = hipY - shoulderY;
  return clamp(bodyH / 0.24, 0.55, 1.6);
}

function getLobbyZone(pose: PoseResult | null, numZones: number): number {
  if (!pose?.landmarks) return -1;
  const nose = pose.landmarks[POSE_LANDMARKS.NOSE];
  if (!nose || nose.visibility < 0.35) return -1;
  const mirrored = 1 - nose.x;
  return clamp(Math.floor(mirrored * numZones), 0, numZones - 1);
}

// ─────────────────────────────────────────────────────────
// Stickman pose keyframes & drawing
// ─────────────────────────────────────────────────────────

interface Pose {
  torsoAngle: number; hipDrop: number;
  frontUpperLeg: number; frontLowerLeg: number;
  backUpperLeg: number;  backLowerLeg: number;
  frontUpperArm: number; frontLowerArm: number;
  backUpperArm: number;  backLowerArm: number;
}

const P: Record<string, Pose> = {
  idle: {
    torsoAngle: 0, hipDrop: 0,
    frontUpperLeg: 7, frontLowerLeg: -5,
    backUpperLeg: -7, backLowerLeg: 6,
    frontUpperArm: 38, frontLowerArm: -52,
    backUpperArm: -30, backLowerArm: 44,
  },
  walk_a: {
    torsoAngle: 8, hipDrop: -3,
    frontUpperLeg: 38, frontLowerLeg: -6,
    backUpperLeg: -30, backLowerLeg: 28,
    frontUpperArm: -36, frontLowerArm: 28,
    backUpperArm: 30, backLowerArm: -20,
  },
  walk_b: {
    torsoAngle: 8, hipDrop: -3,
    frontUpperLeg: -30, frontLowerLeg: 30,
    backUpperLeg: 38, backLowerLeg: -5,
    frontUpperArm: 30, frontLowerArm: -20,
    backUpperArm: -36, backLowerArm: 28,
  },
  kick_w: {
    torsoAngle: 12, hipDrop: 0,
    frontUpperLeg: 44, frontLowerLeg: -62,
    backUpperLeg: -8, backLowerLeg: 5,
    frontUpperArm: -40, frontLowerArm: 55,
    backUpperArm: 50, backLowerArm: -42,
  },
  kick_e: {
    torsoAngle: -6, hipDrop: 0,
    frontUpperLeg: -74, frontLowerLeg: 20,
    backUpperLeg: 12, backLowerLeg: -8,
    frontUpperArm: -24, frontLowerArm: 38,
    backUpperArm: 62, backLowerArm: -56,
  },
  punch_e: {
    torsoAngle: -9, hipDrop: 0,
    frontUpperLeg: 10, frontLowerLeg: -5,
    backUpperLeg: -15, backLowerLeg: 14,
    frontUpperArm: -8, frontLowerArm: -10,
    backUpperArm: -68, backLowerArm: 80,
  },
  crouch: {
    torsoAngle: 15, hipDrop: 30,
    frontUpperLeg: 52, frontLowerLeg: -82,
    backUpperLeg: -46, backLowerLeg: 78,
    frontUpperArm: 20, frontLowerArm: -58,
    backUpperArm: -24, backLowerArm: 54,
  },
  hurt: {
    torsoAngle: -22, hipDrop: -4,
    frontUpperLeg: -12, frontLowerLeg: 8,
    backUpperLeg: 14, backLowerLeg: -8,
    frontUpperArm: 64, frontLowerArm: -70,
    backUpperArm: 70, backLowerArm: -60,
  },
  ko: {
    torsoAngle: 78, hipDrop: 48,
    frontUpperLeg: 62, frontLowerLeg: -28,
    backUpperLeg: 40, backLowerLeg: -18,
    frontUpperArm: 90, frontLowerArm: -40,
    backUpperArm: 78, backLowerArm: -50,
  },
};

function lerpP(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => x + (y - x) * clamp(t, 0, 1);
  return {
    torsoAngle: l(a.torsoAngle, b.torsoAngle),
    hipDrop: l(a.hipDrop, b.hipDrop),
    frontUpperLeg: l(a.frontUpperLeg, b.frontUpperLeg),
    frontLowerLeg: l(a.frontLowerLeg, b.frontLowerLeg),
    backUpperLeg: l(a.backUpperLeg, b.backUpperLeg),
    backLowerLeg: l(a.backLowerLeg, b.backLowerLeg),
    frontUpperArm: l(a.frontUpperArm, b.frontUpperArm),
    frontLowerArm: l(a.frontLowerArm, b.frontLowerArm),
    backUpperArm: l(a.backUpperArm, b.backUpperArm),
    backLowerArm: l(a.backLowerArm, b.backLowerArm),
  };
}

function getPose(f: Fighter, now: number): Pose {
  const t = f.animT;
  switch (f.anim) {
    case 'idle': {
      const s = Math.sin(now / 650) * 0.07;
      return { ...P.idle, torsoAngle: s * 5, frontUpperLeg: 7 + s * 2 };
    }
    case 'walk_fwd':
    case 'walk_back': {
      const c = Math.abs(Math.sin((now / 220) * Math.PI));
      return lerpP(P.walk_a, P.walk_b, c);
    }
    case 'kick':
      if (t < 0.4) return lerpP(P.idle, P.kick_w, t / 0.4);
      return lerpP(P.kick_w, P.kick_e, (t - 0.4) / 0.6);
    case 'punch':
      if (t < 0.42) return lerpP(P.idle, P.punch_e, t / 0.42);
      return lerpP(P.punch_e, P.idle, (t - 0.42) / 0.58);
    case 'crouch':
      return lerpP(P.idle, P.crouch, clamp(t * 5, 0, 1));
    case 'hurt':
      if (t < 0.4) return lerpP(P.idle, P.hurt, t / 0.4);
      return lerpP(P.hurt, P.idle, (t - 0.4) / 0.6);
    case 'ko':
      return lerpP(P.hurt, P.ko, clamp(t * 2, 0, 1));
  }
}

function drawStickman(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  groundY: number,
  facingRight: boolean,
  color: string,
  fighter: Fighter,
  now: number,
  hitZoneShow?: KickZone,
) {
  const pose  = getPose(fighter, now);
  const dir   = facingRight ? 1 : -1;
  const sc    = fighter.scale;
  const TORSO = 50 * sc;
  const U_LEG = 42 * sc;
  const L_LEG = 40 * sc;
  const U_ARM = 36 * sc;
  const L_ARM = 32 * sc;
  const LW    = Math.round(12 * sc);
  const HR    = Math.round(17 * sc);
  const JR    = Math.round(5 * sc);

  const hipY = groundY - pose.hipDrop * sc;

  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  if (fighter.hitFlash > 0 && fighter.hitFlash % 4 < 2) ctx.globalAlpha = 0.3;

  function ep(ox: number, oy: number, deg: number, len: number): [number, number] {
    const r = (deg * Math.PI) / 180;
    return [ox + Math.sin(r) * len * dir, oy + Math.cos(r) * len];
  }

  function seg(x1: number, y1: number, x2: number, y2: number, w: number) {
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function joint(x: number, y: number, r: number) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  ctx.strokeStyle = color;
  ctx.fillStyle   = color;

  // Torso
  const [sx, sy] = ep(hipX, hipY, -pose.torsoAngle, TORSO);
  seg(hipX, hipY, sx, sy, LW);
  joint(hipX, hipY, JR + 1);

  // Head
  const hn = (pose.torsoAngle * 0.6);
  const [nx, ny] = ep(sx, sy, -hn, 12 * sc);
  joint(nx, ny - HR, HR);

  // Hit zone highlight on opponent
  if (hitZoneShow) {
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.25 * Math.sin(now / 80);
    const zoneColors: Record<KickZone, string> = { head: '#fbbf24', body: '#f97316', leg: '#4ade80' };
    ctx.fillStyle = zoneColors[hitZoneShow];
    ctx.strokeStyle = zoneColors[hitZoneShow];
    ctx.lineWidth = 3;
    if (hitZoneShow === 'head') {
      ctx.beginPath(); ctx.arc(nx, ny - HR, HR + 6, 0, Math.PI * 2); ctx.stroke();
    } else if (hitZoneShow === 'body') {
      const bx = (hipX + sx) / 2;
      const by = (hipY + sy) / 2;
      ctx.beginPath(); ctx.ellipse(bx, by, 22 * sc, 14 * sc, 0, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(hipX, hipY + 20 * sc, 26 * sc, 12 * sc, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
  }

  // Front leg
  const [fkx, fky] = ep(hipX, hipY, pose.frontUpperLeg, U_LEG);
  seg(hipX, hipY, fkx, fky, LW); joint(fkx, fky, JR);
  const [fax, fay] = ep(fkx, fky, pose.frontUpperLeg + pose.frontLowerLeg, L_LEG);
  seg(fkx, fky, fax, fay, LW); joint(fax, fay, JR - 1);

  // Back leg
  const [bkx, bky] = ep(hipX, hipY, pose.backUpperLeg, U_LEG);
  seg(hipX, hipY, bkx, bky, LW - 3); joint(bkx, bky, JR - 1);
  const [bax, bay] = ep(bkx, bky, pose.backUpperLeg + pose.backLowerLeg, L_LEG);
  seg(bkx, bky, bax, bay, LW - 3); joint(bax, bay, JR - 2);

  // Front arm
  const [fex, fey] = ep(sx, sy, pose.frontUpperArm, U_ARM);
  seg(sx, sy, fex, fey, LW); joint(fex, fey, JR);
  const [fwx, fwy] = ep(fex, fey, pose.frontUpperArm + pose.frontLowerArm, L_ARM);
  seg(fex, fey, fwx, fwy, LW); joint(fwx, fwy, JR - 1);

  // Back arm
  const [beX, beY] = ep(sx, sy, pose.backUpperArm, U_ARM);
  seg(sx, sy, beX, beY, LW - 3); joint(beX, beY, JR - 1);
  const [bwX, bwY] = ep(beX, beY, pose.backUpperArm + pose.backLowerArm, L_ARM);
  seg(beX, beY, bwX, bwY, LW - 3); joint(bwX, bwY, JR - 2);

  // Shoulder joint
  joint(sx, sy, JR + 2);

  ctx.restore();
}

// ─────────────────────────────────────────────────────────
// Arena drawing
// ─────────────────────────────────────────────────────────

function drawArena(ctx: CanvasRenderingContext2D, cw: number, ch: number, groundY: number) {
  // Sky background
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#07071a');
  sky.addColorStop(0.5, '#0d0d28');
  sky.addColorStop(1, '#12122e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cw, groundY);

  // Arena back wall
  const wallL = cw * 0.05, wallR = cw * 0.95;
  ctx.fillStyle = '#0a0a22';
  ctx.fillRect(wallL, 0, wallR - wallL, groundY);

  // Wall accent lights top
  for (let i = 0; i < 5; i++) {
    const lx = wallL + (wallR - wallL) * (i + 0.5) / 5;
    const lg = ctx.createRadialGradient(lx, 8, 1, lx, 8, 60);
    lg.addColorStop(0, 'rgba(255,40,40,0.3)');
    lg.addColorStop(1, 'transparent');
    ctx.fillStyle = lg;
    ctx.fillRect(lx - 60, 0, 120, 80);
  }

  // Crowd silhouettes
  ctx.fillStyle = '#08082a';
  for (let i = 0; i < 40; i++) {
    const cx2 = wallL + (wallR - wallL) * i / 40;
    const cyH = 20 + (i % 3) * 18;
    ctx.beginPath();
    ctx.ellipse(cx2, cyH + 14, 10, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx2 - 8, cyH + 12, 16, 20);
  }

  // Floor trapezoid (perspective)
  const fl = ctx.createLinearGradient(0, groundY, 0, ch);
  fl.addColorStop(0, '#18183a');
  fl.addColorStop(1, '#0f0f28');
  ctx.fillStyle = fl;
  ctx.beginPath();
  ctx.moveTo(0, ch);
  ctx.lineTo(cw, ch);
  ctx.lineTo(cw * 0.82, groundY);
  ctx.lineTo(cw * 0.18, groundY);
  ctx.closePath();
  ctx.fill();

  // Perspective floor grid
  ctx.setLineDash([]);
  const vp = { x: cw / 2, y: groundY };
  ctx.strokeStyle = 'rgba(100,60,180,0.18)';
  ctx.lineWidth = 1;
  // Radial lines
  for (let i = 0; i <= 10; i++) {
    const bx = cw * i / 10;
    ctx.beginPath(); ctx.moveTo(bx, ch); ctx.lineTo(vp.x, vp.y); ctx.stroke();
  }
  // Horizontal lines
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const gy = groundY + (ch - groundY) * t;
    const lx = cw * 0.18 + (0 - cw * 0.18) * t;
    const rx = cw * 0.82 + (cw - cw * 0.82) * t;
    ctx.beginPath(); ctx.moveTo(lx, gy); ctx.lineTo(rx, gy); ctx.stroke();
  }

  // Ground glow line
  const gg = ctx.createLinearGradient(0, groundY, 0, groundY + 20);
  gg.addColorStop(0, 'rgba(180,40,220,0.5)');
  gg.addColorStop(1, 'transparent');
  ctx.fillStyle = gg;
  ctx.fillRect(0, groundY, cw, 20);

  ctx.strokeStyle = 'rgba(200,60,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cw * 0.18, groundY); ctx.lineTo(cw * 0.82, groundY); ctx.stroke();
}

// ─────────────────────────────────────────────────────────
// HUD
// ─────────────────────────────────────────────────────────

function drawHUD(
  ctx: CanvasRenderingContext2D,
  cw: number,
  player: Fighter,
  bot: Fighter,
  config: GameConfig,
  score: number,
  winStreak: number,
  lastZone: KickZone | null,
) {
  const barW = cw * 0.35, barH = 22, barY = 14;

  function hpBar(x: number, y: number, w: number, h: number, hp: number, color: string, flip: boolean) {
    const pct = clamp(hp / MAX_HP, 0, 1);
    const fc = pct > 0.5 ? color : pct > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillStyle = '#111827';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill();
    const fw = w * pct;
    ctx.fillStyle = fc;
    ctx.beginPath(); ctx.roundRect(flip ? x + w - fw : x, y, fw, h, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui';
    ctx.textBaseline = 'middle';
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(`${Math.ceil(hp)} HP`, flip ? x + w - 4 : x + 4, y + h / 2);
  }

  hpBar(14, barY, barW, barH, player.health, config.playerColor, false);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px system-ui';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('YOU', 14, barY - 12);

  hpBar(cw - 14 - barW, barY, barW, barH, bot.health, config.botColor, true);

  ctx.textAlign = 'right';
  ctx.fillText('BOT', cw - 14, barY - 12);

  // VS + difficulty
  ctx.fillStyle = DIFF_COLORS[config.difficulty];
  ctx.font = 'bold 15px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`VS  [${DIFF_LABELS[config.difficulty]}]`, cw / 2, barY + barH / 2);

  // Score + streak
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 13px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`SCORE: ${score}`, 14, barY + barH + 5);

  if (winStreak > 0) {
    ctx.fillStyle = '#f97316';
    ctx.textAlign = 'right';
    ctx.fillText(`${winStreak}x STREAK`, cw - 14, barY + barH + 5);
  }

  // Last kick zone label
  if (lastZone) {
    const zc: Record<KickZone, string> = { head: '#fbbf24', body: '#f97316', leg: '#4ade80' };
    ctx.fillStyle = zc[lastZone];
    ctx.font = 'bold 16px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${lastZone.toUpperCase()} SHOT!`, cw / 2, barY + barH + 22);
  }

  // Controls
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = '11px system-ui';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
}

// ─────────────────────────────────────────────────────────
// Lobby drawing
// ─────────────────────────────────────────────────────────

function drawLobby(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  step: LobbyStep,
  dwellZone: number,
  dwellFrames: number,
  config: GameConfig,
  noSignalFrames: number,
) {
  // Background
  ctx.fillStyle = '#080818';
  ctx.fillRect(0, 0, cw, ch);

  // Title
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 28px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let title = '';
  if (step === 'level') title = 'SELECT DIFFICULTY';
  else if (step === 'player_color') title = 'SELECT YOUR COLOR';
  else title = 'SELECT BOT COLOR';
  ctx.fillText(title, cw / 2, ch * 0.1);

  const numZones = step === 'level' ? 3 : 6;
  const zoneW = cw / numZones;

  for (let i = 0; i < numZones; i++) {
    const zx = i * zoneW;
    const isActive = i === dwellZone;
    const alpha = isActive ? 0.35 : 0.12;

    let zoneColor = '#fff';
    let label = '';
    if (step === 'level') {
      const d = (i + 1) as Difficulty;
      zoneColor = DIFF_COLORS[d];
      label = `${i + 1}\n${DIFF_LABELS[d]}`;
    } else {
      zoneColor = COLORS[i];
      label = COLOR_NAMES[i];
    }

    // Zone background
    ctx.fillStyle = zoneColor;
    ctx.globalAlpha = alpha;
    ctx.fillRect(zx + 2, ch * 0.15, zoneW - 4, ch * 0.72);
    ctx.globalAlpha = 1;

    // Zone border
    ctx.strokeStyle = isActive ? zoneColor : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = isActive ? 3 : 1;
    ctx.beginPath();
    ctx.roundRect(zx + 6, ch * 0.16, zoneW - 12, ch * 0.70, 12);
    ctx.stroke();

    // Color swatch or level number
    if (step !== 'level') {
      ctx.fillStyle = zoneColor;
      ctx.beginPath();
      ctx.arc(zx + zoneW / 2, ch * 0.38, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Zone label
    ctx.fillStyle = isActive ? '#fff' : 'rgba(255,255,255,0.5)';
    ctx.font = step === 'level' ? 'bold 72px system-ui' : 'bold 16px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelY = step === 'level' ? ch * 0.52 : ch * 0.62;
    ctx.fillText(label.split('\n')[0], zx + zoneW / 2, labelY);

    if (step === 'level') {
      ctx.font = 'bold 18px system-ui';
      ctx.fillStyle = isActive ? DIFF_COLORS[(i + 1) as Difficulty] : 'rgba(255,255,255,0.35)';
      ctx.fillText(label.split('\n')[1] ?? '', zx + zoneW / 2, labelY + 52);
    }

    // Dwell bar
    if (isActive && dwellFrames > 0) {
      const pct = clamp(dwellFrames / DWELL_REQ, 0, 1);
      const bw = (zoneW - 24) * pct;
      ctx.fillStyle = zoneColor;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.roundRect(zx + 12, ch * 0.82, bw, 10, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(zx + 12, ch * 0.82, zoneW - 24, 10, 5);
      ctx.stroke();
    }
  }

  // Current config summary
  const summaryParts: string[] = [];
  if (step === 'player_color') summaryParts.push(`Difficulty: ${DIFF_LABELS[config.difficulty]}`);
  if (step === 'bot_color') summaryParts.push(`Difficulty: ${DIFF_LABELS[config.difficulty]}  |  Your color: ${COLOR_NAMES[COLORS.indexOf(config.playerColor)]}`);
  if (summaryParts.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(summaryParts[0], cw / 2, ch - 12);
  }

  // No pose warning
  if (noSignalFrames > 120) {
    ctx.fillStyle = 'rgba(251,191,36,0.85)';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('No pose detected — stand in front of camera  (auto-start in ~' + Math.ceil((AUTOSTART_FRAMES - noSignalFrames) / 60) + 's)', cw / 2, ch * 0.13);
  }

  // Hint
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '13px system-ui';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Stand in a zone for ~2 seconds to select', cw / 2, ch * 0.95);
}

// ─────────────────────────────────────────────────────────
// Particles & float text
// ─────────────────────────────────────────────────────────

function spawnParticles(
  ps: Particle[],
  x: number, y: number,
  dmg: number,
  zone: KickZone,
) {
  const colors: Record<KickZone, string> = { head: '#fbbf24', body: '#f97316', leg: '#4ade80' };
  const c = colors[zone];
  const count = 8 + Math.floor(dmg / 8);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    ps.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 30 + Math.floor(Math.random() * 20),
      maxLife: 50,
      color: c,
      size: 3 + Math.random() * 4,
    });
  }
}

function spawnFloat(fs: FloatText[], x: number, y: number, text: string, color: string) {
  fs.push({ x, y, text, color, vy: -2.2, life: 55, maxLife: 55 });
}

function updateParticles(ps: Particle[]) {
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life--;
    if (p.life <= 0) ps.splice(i, 1);
  }
}

function updateFloats(fs: FloatText[]) {
  for (let i = fs.length - 1; i >= 0; i--) {
    const f = fs[i];
    f.y += f.vy; f.vy *= 0.96; f.life--;
    if (f.life <= 0) fs.splice(i, 1);
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, ps: Particle[]) {
  for (const p of ps) {
    ctx.save();
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawFloats(ctx: CanvasRenderingContext2D, fs: FloatText[]) {
  for (const f of fs) {
    ctx.save();
    ctx.globalAlpha = f.life / f.maxLife;
    ctx.fillStyle = f.color;
    ctx.font = 'bold 20px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────
// Bot AI
// ─────────────────────────────────────────────────────────

function updateBot(g: GameState, cw: number, now: number) {
  const bot = g.bot;
  const player = g.player;
  if (bot.anim === 'ko' || bot.anim === 'hurt') return;

  const bc = BOT_CONFIGS[g.config.difficulty];
  const minX = cw * 0.06, maxX = cw * 0.94;
  const dist = Math.abs(bot.x - player.x);
  bot.facingRight = bot.x > player.x;

  // Bot dodge: if player is kicking and bot hasn't cooldown'd out
  if (player.anim === 'kick' && player.animT > 0.35 && player.animT < 0.6) {
    if (Math.random() < bc.dodgeChance / 30 && bot.anim !== 'crouch') {
      setAnim(bot, 'crouch');
    }
  } else if (bot.anim === 'crouch' && Math.random() < 0.05) {
    bot.anim = 'idle'; bot.animT = 0; bot.animDur = Infinity;
  }

  // Move
  if (g.botMoveCD > 0) {
    g.botMoveCD--;
  } else if (dist > ATTACK_DIST + 30) {
    const dir = bot.x > player.x ? -1 : 1;
    bot.x = clamp(bot.x + dir * 3.5 * bc.speedMult, minX, maxX);
    setAnim(bot, 'walk_fwd');
  } else if (dist < ATTACK_DIST - 35) {
    const dir = bot.x > player.x ? 1 : -1;
    bot.x = clamp(bot.x + dir * 2.8 * bc.speedMult, minX, maxX);
    setAnim(bot, 'walk_back');
    g.botMoveCD = 18;
  } else if (bot.anim !== 'kick' && bot.anim !== 'punch' && bot.anim !== 'crouch') {
    bot.anim = 'idle'; bot.animT = 0; bot.animDur = Infinity;
  }

  // Attack
  if (g.botAttackCD > 0) {
    g.botAttackCD--;
  } else if (dist <= ATTACK_DIST && bot.anim !== 'crouch') {
    const useKick = Math.random() < 0.55;
    setAnim(bot, useKick ? 'kick' : 'punch');
    if (useKick) {
      const zones = bc.hitZones;
      bot.pendingKickZone = zones[Math.floor(Math.random() * zones.length)];
    }
    const cdMin = bc.attackCDMin, cdMax = bc.attackCDMax;
    g.botAttackCD = cdMin + Math.floor(Math.random() * (cdMax - cdMin));
  }

  // Hard mode: occasional combo
  if (g.config.difficulty === 3 && now % 4200 < 60 && bot.anim === 'idle' && dist <= ATTACK_DIST) {
    setAnim(bot, 'punch');
    g.botAttackCD = 50;
  }
}

// ─────────────────────────────────────────────────────────
// Game state helpers
// ─────────────────────────────────────────────────────────

function makeFighter(x: number, facingRight: boolean, scale: number): Fighter {
  return {
    x, health: MAX_HP, anim: 'idle', animT: 0, animDur: Infinity,
    facingRight, invFrames: 0, hitFlash: 0,
    pendingKickZone: 'body', scale,
  };
}

function setAnim(f: Fighter, anim: AnimState) {
  if (f.anim === 'ko') return;
  if ((f.anim === 'kick' || f.anim === 'punch') && f.animT < 0.78) return;
  if (f.anim === anim && ANIM_DURS[anim] === Infinity) return;
  f.anim = anim; f.animT = 0; f.animDur = ANIM_DURS[anim];
}

function tryHit(
  attacker: Fighter,
  defender: Fighter,
  zone: KickZone,
  dmg: number,
  groundY: number,
  particles: Particle[],
  floats: FloatText[],
): boolean {
  if (defender.invFrames > 0) return false;
  if (defender.anim === 'crouch') {
    spawnFloat(floats, defender.x, groundY - 140 * defender.scale, 'DODGE!', '#60a5fa');
    return false;
  }
  const dist = Math.abs(attacker.x - defender.x);
  if (dist > ATTACK_DIST) return false;
  const facing = attacker.facingRight ? attacker.x < defender.x : attacker.x > defender.x;
  if (!facing) return false;

  defender.health = Math.max(0, defender.health - dmg);
  defender.invFrames = 34;
  defender.hitFlash  = 16;
  setAnim(defender, defender.health <= 0 ? 'ko' : 'hurt');

  const zoneY: Record<KickZone, number> = {
    head: groundY - 160 * defender.scale,
    body: groundY - 100 * defender.scale,
    leg:  groundY - 45 * defender.scale,
  };
  spawnParticles(particles, defender.x, zoneY[zone], dmg, zone);
  spawnFloat(floats, defender.x, zoneY[zone] - 20, `-${dmg}  ${zone.toUpperCase()}!`,
    zone === 'head' ? '#fbbf24' : zone === 'body' ? '#f97316' : '#4ade80');
  return true;
}

// ─────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────

export function StickFightGame({ movement, poseData, isRunning }: StickFightGameProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const gameRef     = useRef<GameState | null>(null);
  const frameRef    = useRef<number>(0);
  const prevMovRef  = useRef<MovementType>('idle');
  const isRunRef    = useRef(isRunning);
  isRunRef.current  = isRunning;
  const poseRef     = useRef<PoseResult | null>(poseData);
  poseRef.current   = poseData;
  const movRef      = useRef<MovementType>(movement);
  movRef.current    = movement;

  const [score, setScore]           = useState(0);
  const [winStreak, setWinStreak]   = useState(0);
  const [phase, setPhase]           = useState<GamePhase>('lobby');
  const [resultWinner, setResultWinner] = useState<'player' | 'bot' | null>(null);
  const lastZoneRef = useRef<KickZone | null>(null);
  const noSignalRef = useRef(0);

  const makeGame = useCallback((cw: number, config: GameConfig): GameState => {
    const playerScale = getBodyScale(poseRef.current);
    return {
      player: makeFighter(cw * 0.27, true, playerScale),
      bot: makeFighter(cw * 0.73, false, playerScale), // bot matches player scale
      particles: [], floats: [],
      botAttackCD: 90, botMoveCD: 40,
      phase: 'countdown', lobbyStep: 'level',
      dwellZone: -1, dwellFrames: 0,
      countdownFrames: 180, // 3 seconds at 60fps
      config,
    };
  }, []);

  const startLobby = useCallback((cw: number): GameState => {
    return {
      player: makeFighter(cw * 0.27, true, 1),
      bot: makeFighter(cw * 0.73, false, 1),
      particles: [], floats: [],
      botAttackCD: 90, botMoveCD: 40,
      phase: 'lobby', lobbyStep: 'level',
      dwellZone: -1, dwellFrames: 0,
      countdownFrames: 180,
      config: { difficulty: 2, playerColor: COLORS[0], botColor: COLORS[1] },
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      if (!gameRef.current) {
        gameRef.current = startLobby(canvas.width);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const tick = () => {
      frameRef.current = requestAnimationFrame(tick);
      const g   = gameRef.current;
      const ctx = canvas.getContext('2d');
      if (!g || !ctx) return;

      const cw      = canvas.width;
      const ch      = canvas.height;
      const groundY = ch * 0.78;
      const now     = performance.now();
      const pose    = poseRef.current;
      const mov     = movRef.current;

      // Track no-signal time
      if (!pose) noSignalRef.current++;
      else noSignalRef.current = 0;

      // ── Lobby phase ───────────────────────────────────
      if (g.phase === 'lobby') {
        const numZones = g.lobbyStep === 'level' ? 3 : 6;
        const zone = getLobbyZone(pose, numZones);

        if (zone === g.dwellZone && zone !== -1) {
          g.dwellFrames++;
        } else {
          g.dwellZone  = zone;
          g.dwellFrames = 0;
        }

        // Auto-start if no signal for too long
        if (noSignalRef.current > AUTOSTART_FRAMES) {
          noSignalRef.current = 0;
          // skip remaining steps → start with defaults
          g.phase = 'countdown';
          const gs = makeGame(cw, g.config);
          gameRef.current = gs;
          setPhase('countdown');
        } else if (g.dwellFrames >= DWELL_REQ) {
          // Confirm selection
          g.dwellFrames = 0;
          if (g.lobbyStep === 'level') {
            g.config.difficulty = (zone + 1) as Difficulty;
            g.lobbyStep = 'player_color';
          } else if (g.lobbyStep === 'player_color') {
            g.config.playerColor = COLORS[zone];
            g.lobbyStep = 'bot_color';
          } else {
            // Pick bot color (avoid same as player)
            let bc = COLORS[zone];
            if (bc === g.config.playerColor) {
              bc = COLORS[(zone + 1) % COLORS.length];
            }
            g.config.botColor = bc;
            // All selected → start game
            const gs = makeGame(cw, g.config);
            gameRef.current = gs;
            setPhase('countdown');
            return;
          }
        }

        drawArena(ctx, cw, ch, groundY);
        drawLobby(ctx, cw, ch, g.lobbyStep, g.dwellZone, g.dwellFrames, g.config, noSignalRef.current);

        // Draw player indicator dot
        const arenaX = getArenaX(pose, cw);
        if (arenaX !== null) {
          ctx.save();
          ctx.fillStyle = g.config.playerColor;
          ctx.shadowColor = g.config.playerColor;
          ctx.shadowBlur = 20;
          ctx.beginPath(); ctx.arc(arenaX, ch * 0.89, 14, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        return;
      }

      // ── Countdown phase ──────────────────────────────
      if (g.phase === 'countdown') {
        g.countdownFrames--;
        drawArena(ctx, cw, ch, groundY);
        // Draw fighters in idle
        drawStickman(ctx, g.bot.x,    groundY, g.bot.facingRight,    g.config.botColor,    g.bot,    now);
        drawStickman(ctx, g.player.x, groundY, g.player.facingRight, g.config.playerColor, g.player, now);

        const num = Math.ceil(g.countdownFrames / 60);
        const txt = num > 0 ? `${num}` : 'FIGHT!';
        ctx.fillStyle = num > 0 ? '#fff' : '#fbbf24';
        ctx.font = `bold ${num > 0 ? 100 : 72}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, cw / 2, ch * 0.4);

        if (g.countdownFrames <= 0) {
          g.phase = 'fighting';
          setPhase('fighting');
        }
        return;
      }

      // ── Fighting phase ───────────────────────────────
      if (!isRunRef.current) {
        // Just draw, no updates
        drawArena(ctx, cw, ch, groundY);
        drawStickman(ctx, g.bot.x,    groundY, g.bot.facingRight,    g.config.botColor,    g.bot,    now);
        drawStickman(ctx, g.player.x, groundY, g.player.facingRight, g.config.playerColor, g.player, now);
        drawHUD(ctx, cw, g.player, g.bot, g.config, score, winStreak, lastZoneRef.current);
        return;
      }

      const p   = g.player;
      const bot = g.bot;
      const prev = prevMovRef.current;

      // Always face opponent
      p.facingRight   = p.x < bot.x;
      bot.facingRight = bot.x > p.x;

      // Player position from pose (camera = arena)
      const arenaX = getArenaX(pose, cw);
      if (arenaX !== null && p.anim !== 'kick' && p.anim !== 'punch') {
        const moved = Math.abs(arenaX - p.x) > 3;
        p.x = arenaX;
        if (moved) setAnim(p, arenaX > p.x ? 'walk_fwd' : 'walk_back');
      }

      // Crouch (dodge)
      if (mov === 'crouch') {
        setAnim(p, 'crouch');
      } else if (p.anim === 'crouch') {
        p.anim = 'idle'; p.animT = 0; p.animDur = Infinity;
      }

      // Jump → Kick
      if (mov === 'jump' && prev !== 'jump') {
        setAnim(p, 'kick');
        p.pendingKickZone = getKickZone(pose);
      }

      // Arm raise → Punch
      if ((mov === 'left-arm-raise' || mov === 'right-arm-raise' || mov === 'arms-up') && prev !== mov) {
        setAnim(p, 'punch');
      }

      prevMovRef.current = mov;

      // ── Tick both fighters ────────────────────────────
      for (const f of [p, bot]) {
        if (f.animDur !== Infinity) {
          f.animT = Math.min(f.animT + 1 / f.animDur, 1);
          if (f.animT >= 1) {
            f.anim = f.anim === 'ko' ? 'ko' : 'idle';
            f.animT = 0; f.animDur = Infinity;
          }
        }
        if (f.invFrames > 0) f.invFrames--;
        if (f.hitFlash  > 0) f.hitFlash--;

        // Register hits at correct animation frames
        const target = f === p ? bot : p;

        if (f.anim === 'kick' && f.animT > 0.55 && f.animT < 0.72) {
          const zone = f.pendingKickZone;
          const dmg  = ZONE_DMG[zone];
          if (tryHit(f, target, zone, dmg, groundY, g.particles, g.floats)) {
            if (f === p) lastZoneRef.current = zone;
          }
        }
        if (f.anim === 'punch' && f.animT > 0.40 && f.animT < 0.58) {
          tryHit(f, target, 'body', PUNCH_DMG, groundY, g.particles, g.floats);
        }
      }

      // ── Bot AI ────────────────────────────────────────
      updateBot(g, cw, now);

      // ── Win check ─────────────────────────────────────
      if (bot.anim === 'ko' && bot.health <= 0) {
        g.phase = 'result';
        setPhase('result');
        setResultWinner('player');
        saveScore('player', g.config, Math.ceil(p.health)).then(async () => {
          const [streak, total] = await Promise.all([fetchWinStreak(), fetchTotalScore()]);
          setWinStreak(streak);
          setScore(total);
        });
      } else if (p.anim === 'ko' && p.health <= 0) {
        g.phase = 'result';
        setPhase('result');
        setResultWinner('bot');
        saveScore('bot', g.config, 0).then(async () => {
          const streak = await fetchWinStreak();
          setWinStreak(0);
          setScore(s => s); // no change on loss
          setWinStreak(streak);
        });
      }

      // ── Particles & floats ────────────────────────────
      updateParticles(g.particles);
      updateFloats(g.floats);

      // ── Draw ──────────────────────────────────────────
      drawArena(ctx, cw, ch, groundY);

      // Shadows
      for (const f of [p, bot]) {
        ctx.save();
        ctx.translate(f.x, groundY);
        ctx.scale(1, 0.22);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 38 * f.scale, 16 * f.scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Determine hit zone to show on each fighter (incoming attack)
      const playerShowZone: KickZone | undefined = (bot.anim === 'kick' && bot.animT > 0.45)
        ? bot.pendingKickZone : undefined;
      const botShowZone: KickZone | undefined = (p.anim === 'kick' && p.animT > 0.45)
        ? p.pendingKickZone : undefined;

      drawStickman(ctx, bot.x, groundY, bot.facingRight, g.config.botColor, bot, now, botShowZone);
      drawStickman(ctx, p.x,   groundY, p.facingRight,   g.config.playerColor, p, now, playerShowZone);

      drawParticles(ctx, g.particles);
      drawFloats(ctx, g.floats);
      drawHUD(ctx, cw, p, bot, g.config, score, winStreak, lastZoneRef.current);

      // Controls hint at bottom
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('JUMP = Kick  •  CROUCH = Dodge  •  MOVE IN CAMERA = Move Fighter  •  RAISE ARM = Punch', cw / 2, ch - 6);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [makeGame, startLobby]);

  // ─── Result overlay ──────────────────────────────────
  const handleRematch = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gameRef.current) return;
    const prev = gameRef.current.config;
    gameRef.current = makeGame(canvas.width, prev);
    lastZoneRef.current = null;
    setPhase('countdown');
    setResultWinner(null);
  }, [makeGame]);

  const handleNewGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    gameRef.current = startLobby(canvas.width);
    lastZoneRef.current = null;
    setPhase('lobby');
    setResultWinner(null);
  }, [startLobby]);

  return (
    <div className="relative w-full h-full min-h-[420px] select-none bg-[#080818]">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Scoreboard ribbon */}
      {phase === 'fighting' && winStreak >= 3 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-orange-500/90 text-white text-sm font-black px-4 py-1 rounded-full shadow-lg animate-pulse">
          {winStreak}x WIN STREAK!
        </div>
      )}

      {/* Result overlay */}
      {phase === 'result' && resultWinner && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
          <p
            className="text-8xl font-black tracking-widest mb-2"
            style={{
              color: resultWinner === 'player' ? '#fbbf24' : '#ef4444',
              textShadow: `0 0 50px ${resultWinner === 'player' ? '#fbbf24' : '#ef4444'}`,
            }}
          >
            {resultWinner === 'player' ? 'VICTORY' : 'K.O.'}
          </p>
          <p className="text-xl text-white/80 mb-2">
            {resultWinner === 'player' ? 'You defeated the bot!' : 'The bot wins this round.'}
          </p>

          {/* Stats */}
          <div className="flex gap-6 mb-8 mt-2">
            <div className="text-center">
              <p className="text-3xl font-black text-yellow-400">{score}</p>
              <p className="text-sm text-white/50">TOTAL SCORE</p>
            </div>
            {winStreak > 0 && (
              <div className="text-center">
                <p className="text-3xl font-black text-orange-400">{winStreak}x</p>
                <p className="text-sm text-white/50">WIN STREAK</p>
              </div>
            )}
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleRematch}
              className="px-8 py-3 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 text-white text-lg font-black rounded-xl shadow-xl transition-all hover:scale-105 active:scale-95"
            >
              REMATCH
            </button>
            <button
              onClick={handleNewGame}
              className="px-8 py-3 bg-slate-700 hover:bg-slate-600 text-white text-lg font-bold rounded-xl transition-all hover:scale-105 active:scale-95"
            >
              CHANGE SETTINGS
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
