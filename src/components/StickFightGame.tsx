import { useRef, useEffect, useState, useCallback } from 'react';
import { MovementType } from '../utils/movementAnalyzer';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────

type AnimState =
  | 'idle'
  | 'walk_fwd'
  | 'walk_back'
  | 'kick'
  | 'punch'
  | 'crouch'
  | 'hurt'
  | 'ko';

interface Fighter {
  x: number;
  health: number;
  anim: AnimState;
  animT: number;       // 0..1 progress through current anim
  animDur: number;     // total duration in frames
  facingRight: boolean;
  invFrames: number;   // invincibility frames (after being hit)
  hitFlash: number;    // white flash frames
}

interface GameState {
  player: Fighter;
  bot: Fighter;
  status: 'playing' | 'player_wins' | 'bot_wins';
  botAttackCD: number;
  botMoveCD: number;
}

interface StickFightGameProps {
  movement: MovementType;
  isRunning: boolean;
}

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────

const GROUND_FRAC = 0.80;   // ground Y as fraction of canvas height
const MOVE_SPD    = 4;
const ATTACK_DIST = 130;
const KICK_DMG    = 20;
const PUNCH_DMG   = 13;
const ANIM_DURS: Record<AnimState, number> = {
  idle:       Infinity,
  walk_fwd:   Infinity,
  walk_back:  Infinity,
  kick:       26,
  punch:      22,
  crouch:     Infinity,
  hurt:       18,
  ko:         Infinity,
};

// ─────────────────────────────────────────────
//  Pose definitions
//  All angles in degrees; 0 = straight down
//  Positive = towards front (the direction the fighter faces)
// ─────────────────────────────────────────────

interface Pose {
  torsoAngle: number;       // tilt from vertical
  hipOffsetY: number;       // how much the hips are lowered (crouch)
  // legs: front = leg facing opponent; back = other leg
  frontUpperLeg: number;
  frontLowerLeg: number;
  backUpperLeg: number;
  backLowerLeg: number;
  // arms
  frontUpperArm: number;
  frontLowerArm: number;
  backUpperArm: number;
  backLowerArm: number;
}

const POSE: Record<string, Pose> = {
  idle: {
    torsoAngle: 0, hipOffsetY: 0,
    frontUpperLeg: 8,  frontLowerLeg: -5,
    backUpperLeg: -8,  backLowerLeg: 6,
    frontUpperArm: 35, frontLowerArm: -50,
    backUpperArm: -28, backLowerArm: 42,
  },
  walk_a: {
    torsoAngle: 7, hipOffsetY: -3,
    frontUpperLeg: 38,  frontLowerLeg: -6,
    backUpperLeg: -32,  backLowerLeg: 28,
    frontUpperArm: -36, frontLowerArm: 28,
    backUpperArm:  30,  backLowerArm: -18,
  },
  walk_b: {
    torsoAngle: 7, hipOffsetY: -3,
    frontUpperLeg: -32,  frontLowerLeg: 30,
    backUpperLeg:  38,   backLowerLeg: -5,
    frontUpperArm:  30,  frontLowerArm: -18,
    backUpperArm:  -36,  backLowerArm:  28,
  },
  kick_wind: {
    torsoAngle: 12, hipOffsetY: 0,
    frontUpperLeg: 42,  frontLowerLeg: -60,
    backUpperLeg: -8,   backLowerLeg: 5,
    frontUpperArm: -38, frontLowerArm: 52,
    backUpperArm: 48,   backLowerArm: -38,
  },
  kick_ext: {
    torsoAngle: -5, hipOffsetY: 0,
    frontUpperLeg: -72, frontLowerLeg: 18,
    backUpperLeg: 12,   backLowerLeg: -8,
    frontUpperArm: -22, frontLowerArm: 38,
    backUpperArm:  58,  backLowerArm: -52,
  },
  punch_ext: {
    torsoAngle: -8, hipOffsetY: 0,
    frontUpperLeg: 10,  frontLowerLeg: -5,
    backUpperLeg: -14,  backLowerLeg: 14,
    frontUpperArm: -8,  frontLowerArm: -8,
    backUpperArm: -65,  backLowerArm: 78,
  },
  crouch: {
    torsoAngle: 14, hipOffsetY: 30,
    frontUpperLeg: 52,  frontLowerLeg: -80,
    backUpperLeg: -44,  backLowerLeg: 76,
    frontUpperArm: 18,  frontLowerArm: -55,
    backUpperArm: -22,  backLowerArm:  52,
  },
  hurt: {
    torsoAngle: -22, hipOffsetY: -4,
    frontUpperLeg: -12, frontLowerLeg: 8,
    backUpperLeg: 16,   backLowerLeg: -8,
    frontUpperArm: 62,  frontLowerArm: -68,
    backUpperArm:  68,  backLowerArm: -58,
  },
  ko: {
    torsoAngle: 75, hipOffsetY: 48,
    frontUpperLeg: 58,  frontLowerLeg: -25,
    backUpperLeg: 38,   backLowerLeg: -15,
    frontUpperArm: 88,  frontLowerArm: -38,
    backUpperArm: 76,   backLowerArm: -48,
  },
};

function lerpN(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => lerpN(x, y, t);
  return {
    torsoAngle:    l(a.torsoAngle, b.torsoAngle),
    hipOffsetY:    l(a.hipOffsetY, b.hipOffsetY),
    frontUpperLeg: l(a.frontUpperLeg, b.frontUpperLeg),
    frontLowerLeg: l(a.frontLowerLeg, b.frontLowerLeg),
    backUpperLeg:  l(a.backUpperLeg, b.backUpperLeg),
    backLowerLeg:  l(a.backLowerLeg, b.backLowerLeg),
    frontUpperArm: l(a.frontUpperArm, b.frontUpperArm),
    frontLowerArm: l(a.frontLowerArm, b.frontLowerArm),
    backUpperArm:  l(a.backUpperArm, b.backUpperArm),
    backLowerArm:  l(a.backLowerArm, b.backLowerArm),
  };
}

function getCurrentPose(fighter: Fighter, now: number): Pose {
  const t = fighter.animT;

  switch (fighter.anim) {
    case 'idle': {
      const sway = Math.sin(now / 650) * 0.08;
      const p = { ...POSE.idle };
      p.torsoAngle += sway * 6;
      return p;
    }
    case 'walk_fwd':
    case 'walk_back': {
      const cycle = Math.abs(Math.sin((now / 230) * Math.PI));
      return lerpPose(POSE.walk_a, POSE.walk_b, cycle);
    }
    case 'kick':
      if (t < 0.38) return lerpPose(POSE.idle, POSE.kick_wind, t / 0.38);
      return lerpPose(POSE.kick_wind, POSE.kick_ext, (t - 0.38) / 0.62);
    case 'punch':
      if (t < 0.42) return lerpPose(POSE.idle, POSE.punch_ext, t / 0.42);
      return lerpPose(POSE.punch_ext, POSE.idle, (t - 0.42) / 0.58);
    case 'crouch':
      return lerpPose(POSE.idle, POSE.crouch, Math.min(t * 5, 1));
    case 'hurt':
      if (t < 0.4) return lerpPose(POSE.idle, POSE.hurt, t / 0.4);
      return lerpPose(POSE.hurt, POSE.idle, (t - 0.4) / 0.6);
    case 'ko':
      return lerpPose(POSE.hurt, POSE.ko, Math.min(t * 2, 1));
  }
}

// ─────────────────────────────────────────────
//  Stickman renderer
// ─────────────────────────────────────────────

function drawStickman(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  groundY: number,
  facingRight: boolean,
  color: string,
  fighter: Fighter,
  now: number,
) {
  const pose = getCurrentPose(fighter, now);
  const dir  = facingRight ? 1 : -1;  // +1 = right

  // Segment lengths (px)
  const TORSO  = 50;
  const U_LEG  = 42;
  const L_LEG  = 40;
  const U_ARM  = 36;
  const L_ARM  = 32;
  const LW     = 14;   // line width
  const HEAD_R = 18;

  const hipY = groundY - pose.hipOffsetY;

  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  // Optional hit-flash
  if (fighter.hitFlash > 0 && fighter.hitFlash % 4 < 2) {
    ctx.globalAlpha = 0.35;
  }

  ctx.strokeStyle = color;
  ctx.fillStyle   = color;

  // Helper: compute endpoint given a start, cumulative angle from vertical, length
  function endpoint(ox: number, oy: number, angleDeg: number, len: number): [number, number] {
    const rad = (angleDeg * Math.PI) / 180;
    return [ox + Math.sin(rad) * len * dir, oy + Math.cos(rad) * len];
  }

  // ── Torso ──
  const [shoulderX, shoulderY] = endpoint(hipX, hipY, -pose.torsoAngle, TORSO);

  ctx.lineWidth = LW;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(shoulderX, shoulderY);
  ctx.stroke();

  // ── Head ──
  const neckLen = 12;
  const headAngle = -pose.torsoAngle * 0.6;
  const [neckX, neckY] = endpoint(shoulderX, shoulderY, headAngle, neckLen);
  ctx.beginPath();
  ctx.arc(neckX, neckY - HEAD_R, HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  // ── Front leg ──
  const [fkX, fkY] = endpoint(hipX, hipY, pose.frontUpperLeg, U_LEG);
  ctx.lineWidth = LW;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(fkX, fkY);
  ctx.stroke();

  const [faX, faY] = endpoint(fkX, fkY, pose.frontUpperLeg + pose.frontLowerLeg, L_LEG);
  ctx.beginPath();
  ctx.moveTo(fkX, fkY);
  ctx.lineTo(faX, faY);
  ctx.stroke();

  // ── Back leg ──
  const [bkX, bkY] = endpoint(hipX, hipY, pose.backUpperLeg, U_LEG);
  ctx.lineWidth = LW - 3;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(bkX, bkY);
  ctx.stroke();

  const [baX, baY] = endpoint(bkX, bkY, pose.backUpperLeg + pose.backLowerLeg, L_LEG);
  ctx.beginPath();
  ctx.moveTo(bkX, bkY);
  ctx.lineTo(baX, baY);
  ctx.stroke();

  // ── Front arm ──
  const [feX, feY] = endpoint(shoulderX, shoulderY, pose.frontUpperArm, U_ARM);
  ctx.lineWidth = LW;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(feX, feY);
  ctx.stroke();

  const [fwX, fwY] = endpoint(feX, feY, pose.frontUpperArm + pose.frontLowerArm, L_ARM);
  ctx.beginPath();
  ctx.moveTo(feX, feY);
  ctx.lineTo(fwX, fwY);
  ctx.stroke();

  // ── Back arm ──
  const [beX, beY] = endpoint(shoulderX, shoulderY, pose.backUpperArm, U_ARM);
  ctx.lineWidth = LW - 3;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(beX, beY);
  ctx.stroke();

  const [bwX, bwY] = endpoint(beX, beY, pose.backUpperArm + pose.backLowerArm, L_ARM);
  ctx.beginPath();
  ctx.moveTo(beX, beY);
  ctx.lineTo(bwX, bwY);
  ctx.stroke();

  ctx.restore();
}

// ─────────────────────────────────────────────
//  HUD helpers
// ─────────────────────────────────────────────

function drawHBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  hp: number, color: string, label: string, flipFill: boolean,
) {
  const pct = Math.max(0, hp / 100);
  const barColor = pct > 0.5 ? color : pct > 0.25 ? '#f59e0b' : '#ef4444';
  const fillW = w * pct;

  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
  ctx.fill();

  ctx.fillStyle = barColor;
  ctx.beginPath();
  ctx.roundRect(flipFill ? x + w - fillW : x, y, fillW, h, 5);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px system-ui';
  ctx.textBaseline = 'middle';
  ctx.textAlign = flipFill ? 'right' : 'left';
  ctx.fillText(label, flipFill ? x + w - 4 : x + 4, y + h / 2);
}

// ─────────────────────────────────────────────
//  Game logic helpers
// ─────────────────────────────────────────────

function makeFighter(x: number, facingRight: boolean): Fighter {
  return {
    x, health: 100,
    anim: 'idle', animT: 0, animDur: Infinity,
    facingRight, invFrames: 0, hitFlash: 0,
  };
}

function setAnim(f: Fighter, anim: AnimState) {
  // Don't interrupt an active attack or KO
  if (f.anim === 'ko') return;
  if ((f.anim === 'kick' || f.anim === 'punch') && f.animT < 0.75 && f.animDur !== Infinity) return;
  if (f.anim === anim && (anim === 'idle' || anim === 'walk_fwd' || anim === 'walk_back' || anim === 'crouch')) return;

  f.anim    = anim;
  f.animT   = 0;
  f.animDur = ANIM_DURS[anim];
}

function tryHit(attacker: Fighter, defender: Fighter, dmg: number) {
  if (defender.invFrames > 0) return;
  if (defender.anim === 'crouch') return; // dodge!

  const dist = Math.abs(attacker.x - defender.x);
  if (dist > ATTACK_DIST) return;

  // Must be facing defender
  const facing = attacker.facingRight ? attacker.x < defender.x : attacker.x > defender.x;
  if (!facing) return;

  defender.health    = Math.max(0, defender.health - dmg);
  defender.invFrames = 32;
  defender.hitFlash  = 14;
  setAnim(defender, defender.health <= 0 ? 'ko' : 'hurt');
}

// ─────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────

export function StickFightGame({ movement, isRunning }: StickFightGameProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const gameRef     = useRef<GameState | null>(null);
  const frameRef    = useRef<number>(0);
  const prevMovRef  = useRef<MovementType>('idle');
  const isRunRef    = useRef(isRunning);
  isRunRef.current  = isRunning;

  const [status, setStatus] = useState<'playing' | 'player_wins' | 'bot_wins'>('playing');

  const newGame = useCallback((cw: number) => {
    gameRef.current = {
      player:      makeFighter(cw * 0.27, true),
      bot:         makeFighter(cw * 0.73, false),
      status:      'playing',
      botAttackCD: 100,
      botMoveCD:   40,
    };
    setStatus('playing');
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      if (!gameRef.current) newGame(canvas.width);
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
      const groundY = ch * GROUND_FRAC;
      const minX    = cw * 0.06;
      const maxX    = cw * 0.94;
      const now     = performance.now();

      // ── Player input (only when game is active) ──────────────
      if (g.status === 'playing' && isRunRef.current) {
        const p    = g.player;
        const mov  = movement;
        const prev = prevMovRef.current;

        // Always face the bot
        p.facingRight = p.x < g.bot.x;

        // Jump → kick (edge trigger)
        if (mov === 'jump' && prev !== 'jump') {
          setAnim(p, 'kick');
        }

        // Arm raise → punch (edge trigger)
        if (
          (mov === 'left-arm-raise' || mov === 'right-arm-raise' || mov === 'arms-up') &&
          prev !== mov
        ) {
          setAnim(p, 'punch');
        }

        // Crouch → dodge
        if (mov === 'crouch') {
          setAnim(p, 'crouch');
        } else if (p.anim === 'crouch') {
          setAnim(p, 'idle');
          p.animT = 0;
          p.animDur = Infinity;
          p.anim = 'idle';
        }

        // Lean right = move toward enemy (always "forward"), lean left = back
        const isAttacking = p.anim === 'kick' || p.anim === 'punch';
        const isCrouching = p.anim === 'crouch';

        if (!isAttacking && !isCrouching) {
          if (mov === 'right') {
            p.x = Math.min(maxX, p.x + MOVE_SPD);
            setAnim(p, 'walk_fwd');
          } else if (mov === 'left') {
            p.x = Math.max(minX, p.x - MOVE_SPD);
            setAnim(p, 'walk_back');
          } else if (p.anim === 'walk_fwd' || p.anim === 'walk_back') {
            setAnim(p, 'idle');
            p.animT = 0; p.animDur = Infinity; p.anim = 'idle';
          }
        }

        prevMovRef.current = mov;
      }

      // ── Bot AI ────────────────────────────────────────────────
      if (g.status === 'playing') {
        const b   = g.bot;
        const p   = g.player;
        const dist = Math.abs(b.x - p.x);
        b.facingRight = b.x > p.x;   // bot always faces left (toward player)

        if (b.anim !== 'ko' && b.anim !== 'hurt') {
          // Movement
          if (g.botMoveCD > 0) {
            g.botMoveCD--;
          } else if (dist > ATTACK_DIST + 30) {
            const dir = b.x > p.x ? -1 : 1;
            b.x = Math.max(minX, Math.min(maxX, b.x + dir * MOVE_SPD * 1.05));
            setAnim(b, 'walk_fwd');
          } else if (dist < ATTACK_DIST - 40) {
            const dir = b.x > p.x ? 1 : -1;
            b.x = Math.max(minX, Math.min(maxX, b.x + dir * MOVE_SPD * 0.8));
            setAnim(b, 'walk_back');
            g.botMoveCD = 18;
          } else {
            setAnim(b, 'idle');
            b.animT = 0; b.animDur = Infinity; b.anim = 'idle';
          }

          // Attack
          if (g.botAttackCD > 0) {
            g.botAttackCD--;
          } else if (dist <= ATTACK_DIST) {
            setAnim(b, Math.random() < 0.55 ? 'kick' : 'punch');
            g.botAttackCD = 75 + Math.floor(Math.random() * 55);
          }
        }
      }

      // ── Tick fighters ─────────────────────────────────────────
      for (const f of [g.player, g.bot]) {
        if (f.animDur !== Infinity) {
          f.animT = Math.min(f.animT + 1 / f.animDur, 1);
          if (f.animT >= 1) {
            f.anim    = f.anim === 'ko' ? 'ko' : 'idle';
            f.animT   = 0;
            f.animDur = Infinity;
          }
        }
        if (f.invFrames > 0) f.invFrames--;
        if (f.hitFlash  > 0) f.hitFlash--;

        // Register hits at the right moment of each attack anim
        if (f.anim === 'kick'  && f.animT > 0.52 && f.animT < 0.74) {
          const target = f === g.player ? g.bot : g.player;
          tryHit(f, target, KICK_DMG);
        }
        if (f.anim === 'punch' && f.animT > 0.38 && f.animT < 0.58) {
          const target = f === g.player ? g.bot : g.player;
          tryHit(f, target, PUNCH_DMG);
        }
      }

      // ── Win check ─────────────────────────────────────────────
      if (g.status === 'playing') {
        if (g.bot.anim === 'ko' && g.bot.health <= 0) {
          g.status = 'player_wins';
          setStatus('player_wins');
        } else if (g.player.anim === 'ko' && g.player.health <= 0) {
          g.status = 'bot_wins';
          setStatus('bot_wins');
        }
      }

      // ── Draw ──────────────────────────────────────────────────

      // Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, ch);
      bgGrad.addColorStop(0, '#0c0c1e');
      bgGrad.addColorStop(0.68, '#0f0f28');
      bgGrad.addColorStop(1, '#18181a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, cw, ch);

      // Arena floor
      ctx.fillStyle = '#16162a';
      ctx.fillRect(0, groundY, cw, ch - groundY);

      // Floor glow line
      const glow = ctx.createLinearGradient(0, groundY, 0, groundY + 24);
      glow.addColorStop(0, 'rgba(200, 60, 60, 0.35)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, groundY, cw, 24);

      ctx.strokeStyle = 'rgba(220, 60, 60, 0.6)';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(cw, groundY);
      ctx.stroke();

      // Center divider
      ctx.setLineDash([6, 10]);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(cw / 2, groundY - 50);
      ctx.lineTo(cw / 2, groundY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Shadows under fighters
      for (const f of [g.player, g.bot]) {
        ctx.save();
        ctx.translate(f.x, groundY);
        ctx.scale(1, 0.25);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 38, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Fighters — draw bot first (behind player)
      drawStickman(ctx, g.bot.x,    groundY, g.bot.facingRight,    '#2563eb', g.bot,    now);
      drawStickman(ctx, g.player.x, groundY, g.player.facingRight, '#dc2626', g.player, now);

      // ── HUD ───────────────────────────────────────────────────
      const barW = cw * 0.36;
      const barH = 20;
      const barY = 16;

      drawHBar(ctx, 16, barY, barW, barH, g.player.health, '#dc2626', 'YOU', false);
      drawHBar(ctx, cw - 16 - barW, barY, barW, barH, g.bot.health, '#2563eb', 'BOT', true);

      // VS label
      ctx.fillStyle    = '#fbbf24';
      ctx.font         = 'bold 18px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('VS', cw / 2, barY + barH / 2);

      // Live movement label
      if (movement !== 'idle' && g.status === 'playing') {
        const labels: Partial<Record<MovementType, string>> = {
          jump: 'KICK!', crouch: 'DODGE!',
          left: 'BACK', right: 'FORWARD',
          'left-arm-raise': 'PUNCH!', 'right-arm-raise': 'PUNCH!', 'arms-up': 'UPPERCUT!',
        };
        const colors: Partial<Record<MovementType, string>> = {
          jump: '#fbbf24', crouch: '#60a5fa',
          left: '#86efac', right: '#86efac',
          'left-arm-raise': '#f472b6', 'right-arm-raise': '#f472b6', 'arms-up': '#f472b6',
        };
        const lbl = labels[movement];
        if (lbl) {
          ctx.fillStyle = colors[movement] ?? '#fff';
          ctx.font      = 'bold 20px system-ui';
          ctx.fillText(lbl, cw / 2, barY + barH + 28);
        }
      }

      // Dodge indicator
      if (g.player.anim === 'crouch') {
        ctx.fillStyle = 'rgba(96,165,250,0.06)';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = '#60a5fa';
        ctx.font      = 'bold 15px system-ui';
        ctx.fillText('DODGE', g.player.x, groundY - 130);
      }

      // Controls reminder (bottom)
      ctx.fillStyle    = 'rgba(255,255,255,0.22)';
      ctx.font         = '12px system-ui';
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        'JUMP = Kick   •   CROUCH = Dodge   •   LEAN = Move   •   RAISE ARM = Punch',
        cw / 2, ch - 8,
      );
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [newGame, movement]);

  const restart = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) newGame(canvas.width);
  }, [newGame]);

  return (
    <div className="relative w-full h-full min-h-[400px] select-none bg-[#0c0c1e]">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* KO / Win overlay */}
      {status !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm">
          <p
            className="text-8xl font-black tracking-widest mb-3"
            style={{
              color: status === 'player_wins' ? '#fbbf24' : '#ef4444',
              textShadow: `0 0 40px ${status === 'player_wins' ? '#fbbf24' : '#ef4444'}`,
            }}
          >
            {status === 'player_wins' ? 'VICTORY' : 'K.O.'}
          </p>
          <p className="text-2xl text-white font-semibold mb-10">
            {status === 'player_wins' ? 'You defeated the bot!' : 'The bot wins this round.'}
          </p>
          <button
            onClick={restart}
            className="px-10 py-4 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 text-white text-xl font-black rounded-2xl shadow-xl shadow-red-600/30 transition-all hover:scale-105 active:scale-95 tracking-wide"
          >
            REMATCH
          </button>
        </div>
      )}
    </div>
  );
}
