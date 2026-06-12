import { useRef, useEffect, useState, useCallback } from 'react';
import { MovementType } from '../utils/movementAnalyzer';

interface Player {
  x: number;
  y: number;
  vy: number;
  width: number;
  height: number;
  isJumping: boolean;
  color: string;
}

interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  color: string;
}

interface GameState {
  player: Player;
  obstacles: Obstacle[];
  score: number;
  isRunning: boolean;
  isGameOver: boolean;
  speed: number;
  groundY: number;
}

interface JumpGameProps {
  movement: MovementType;
  isRunning: boolean;
  onScoreChange?: (score: number) => void;
  onGameOver?: () => void;
}

export function JumpGame({ movement, isRunning, onScoreChange, onGameOver }: JumpGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const animationRef = useRef<number>(0);
  const [score, setScore] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const lastMovementRef = useRef<MovementType>('idle');
  const jumpTriggeredRef = useRef(false);

  const initGame = useCallback((canvas: HTMLCanvasElement) => {
    const groundY = canvas.height - 50;
    const playerHeight = 60;
    const playerWidth = 40;

    gameStateRef.current = {
      player: {
        x: 80,
        y: groundY - playerHeight,
        vy: 0,
        width: playerWidth,
        height: playerHeight,
        isJumping: false,
        color: '#10b981',
      },
      obstacles: [],
      score: 0,
      isRunning: true,
      isGameOver: false,
      speed: 6,
      groundY: groundY,
    };
  }, []);

  const jump = useCallback(() => {
    const state = gameStateRef.current;
    if (!state || state.player.isJumping) return;

    state.player.vy = -18;
    state.player.isJumping = true;
  }, []);

  const crouch = useCallback(() => {
    const state = gameStateRef.current;
    if (!state) return;

    if (!state.player.isJumping) {
      state.player.height = 30;
      state.player.y = state.groundY - 30;
      state.player.color = '#059669';
    }
  }, []);

  const standUp = useCallback(() => {
    const state = gameStateRef.current;
    if (!state) return;

    state.player.height = 60;
    state.player.color = '#10b981';
  }, []);

  const resetGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    initGame(canvas);
    setScore(0);
    setIsGameOver(false);
    gameStateRef.current?.isRunning && (gameStateRef.current.isRunning = true);
  }, [initGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize game
    initGame(canvas);

    const gameLoop = () => {
      const state = gameStateRef.current;
      if (!state || !state.isRunning || state.isGameOver) {
        animationRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      // Handle movement input
      if (movement === 'jump' && lastMovementRef.current !== 'jump') {
        jumpTriggeredRef.current = true;
      }

      if (jumpTriggeredRef.current) {
        jump();
        jumpTriggeredRef.current = false;
      }

      if (movement === 'crouch') {
        crouch();
      } else {
        standUp();
      }

      lastMovementRef.current = movement;

      // Update player physics
      const gravity = 0.8;
      const player = state.player;

      if (state.player.isJumping) {
        player.vy += gravity;
        player.y += player.vy;

        if (player.y >= state.groundY - player.height) {
          player.y = state.groundY - player.height;
          player.vy = 0;
          player.isJumping = false;
        }
      }

      // Spawn obstacles
      const shouldSpawn = Math.random() < 0.02;
      if (shouldSpawn) {
        const obstacleType = Math.random();
        let obstacle: Obstacle;

        if (obstacleType < 0.7) {
          // Ground obstacle
          obstacle = {
            x: canvas.width,
            y: state.groundY - 40,
            width: 30 + Math.random() * 20,
            height: 40,
            speed: state.speed,
            color: '#ef4444',
          };
        } else {
          // Flying obstacle (need to duck)
          obstacle = {
            x: canvas.width,
            y: state.groundY - 80,
            width: 50,
            height: 30,
            speed: state.speed,
            color: '#f97316',
          };
        }

        state.obstacles.push(obstacle);
      }

      // Update obstacles
      state.obstacles = state.obstacles.filter((obs) => {
        obs.x -= obs.speed;
        return obs.x + obs.width > 0;
      });

      // Check collisions
      for (const obs of state.obstacles) {
        const playerLeft = player.x;
        const playerRight = player.x + player.width;
        const playerTop = player.y;
        const playerBottom = player.y + player.height;

        const obsLeft = obs.x;
        const obsRight = obs.x + obs.width;
        const obsTop = obs.y;
        const obsBottom = obs.y + obs.height;

        if (
          playerRight > obsLeft + 10 &&
          playerLeft < obsRight - 10 &&
          playerBottom > obsTop + 5 &&
          playerTop < obsBottom - 5
        ) {
          state.isGameOver = true;
          state.isRunning = false;
          setIsGameOver(true);
          onGameOver?.();
          break;
        }
      }

      // Score
      state.score = (state.score + 0.1);
      state.speed = Math.min(18, 6 + state.score / 200);

      // Clear and draw
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw ground
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, state.groundY, canvas.width, canvas.height - state.groundY);

      // Draw ground line
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, state.groundY);
      ctx.lineTo(canvas.width, state.groundY);
      ctx.stroke();

      // Draw player
      ctx.fillStyle = player.color;
      ctx.fillRect(player.x, player.y, player.width, player.height);

      // Player face
      ctx.fillStyle = '#fff';
      ctx.fillRect(player.x + 8, player.y + 10, 8, 8); // Left eye
      ctx.fillRect(player.x + 24, player.y + 10, 8, 8); // Right eye

      // Draw obstacles
      for (const obs of state.obstacles) {
        ctx.fillStyle = obs.color;
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);

        // Obstacle detail
        ctx.fillStyle = '#000';
        ctx.fillRect(obs.x + 5, obs.y + 5, obs.width - 10, 3);
      }

      // Draw score
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px system-ui';
      ctx.fillText(`Score: ${Math.floor(state.score)}`, 20, 40);

      // Update score state
      if (Math.floor(state.score) > score) {
        setScore(Math.floor(state.score));
        onScoreChange?.(Math.floor(state.score));
      }

      if (!state.isGameOver) {
        animationRef.current = requestAnimationFrame(gameLoop);
      }
    };

    animationRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [initGame, jump, crouch, standUp, movement, onScoreChange, onGameOver, score]);

  useEffect(() => {
    if (!isRunning) {
      cancelAnimationFrame(animationRef.current);
    }
  }, [isRunning]);

  return (
    <div className="relative w-full h-full min-h-[300px]">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ imageRendering: 'pixelated' }}
      />

      {/* Game Over Overlay */}
      {isGameOver && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
          <h2 className="text-4xl font-bold text-white mb-2">Game Over!</h2>
          <p className="text-2xl text-cyan-400 mb-6">Score: {Math.floor(score)}</p>
          <button
            onClick={resetGame}
            className="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-bold rounded-lg transition-colors"
          >
            Play Again
          </button>
        </div>
      )}

      {/* Controls hint */}
      <div className="absolute bottom-4 left-4 right-4 flex justify-center gap-4 text-sm text-slate-400">
        <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1 rounded">
          <span className="text-cyan-400">JUMP</span>
          <span>to jump over obstacles</span>
        </div>
        <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1 rounded">
          <span className="text-orange-400">CROUCH</span>
          <span>to duck under flying ones</span>
        </div>
      </div>
    </div>
  );
}
