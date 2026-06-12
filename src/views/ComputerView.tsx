import { useRef, useState, useEffect, useCallback } from 'react';
import { useBroadcastChannel } from '../hooks/useBroadcastChannel';
import { JumpGame } from '../components/JumpGame';
import { PoseDetector, PoseResult } from '../utils/poseDetection';
import { MovementAnalyzer, MovementType, movementToKeyMap } from '../utils/movementAnalyzer';
import {
  Camera,
  Play,
  RefreshCw,
  Tv,
  Settings,
  Activity,
  Eye,
  Wifi,
  WifiOff,
  VolumeX,
} from 'lucide-react';

type ViewMode = 'game' | 'pose-view' | 'both';

export default function ComputerView() {
  const receivedCanvasRef = useRef<HTMLCanvasElement>(null);
  const poseOverlayRef = useRef<HTMLCanvasElement>(null);

  const poseDetectorRef = useRef<PoseDetector | null>(null);
  const movementAnalyzerRef = useRef<MovementAnalyzer | null>(null);

  const [isReceiving, setIsReceiving] = useState(false);
  const [currentMovement, setCurrentMovement] = useState<MovementType>('idle');
  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [score, setScore] = useState(0);
  const [gameActive, setGameActive] = useState(true);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [detectedPose, setDetectedPose] = useState<PoseResult | null>(null);
  const [fps, setFps] = useState({ receive: 0, pose: 0 });
  const [showPresentation, setShowPresentation] = useState(false);
  const [presentationConnection, setPresentationConnection] = useState<PresentationConnection | null>(null);

  const { sendMessage, lastMessage } = useBroadcastChannel('motion-play');

  const fpsCountersRef = useRef({ receiveFrames: 0, poseFrames: 0, lastTime: performance.now() });
  const animationRef = useRef<number>(0);
  const lastFrameRef = useRef<string | null>(null);
  const receivedWidthRef = useRef(640);
  const receivedHeightRef = useRef(480);

  // Initialize pose detector
  useEffect(() => {
    const initPoseDetector = async () => {
      poseDetectorRef.current = new PoseDetector();
      movementAnalyzerRef.current = new MovementAnalyzer();
      await poseDetectorRef.current.initialize();
    };
    initPoseDetector();
  }, []);

  // Handle broadcast messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'camera-frame') {
      const { frame, width, height } = lastMessage.payload as {
        frame: string;
        width: number;
        height: number;
      };

      lastFrameRef.current = frame;
      receivedWidthRef.current = width;
      receivedHeightRef.current = height;
      setIsReceiving(true);

      // FPS counting
      fpsCountersRef.current.receiveFrames++;
      const now = performance.now();
      if (now - fpsCountersRef.current.lastTime >= 1000) {
        setFps((prev) => ({
          ...prev,
          receive: fpsCountersRef.current.receiveFrames,
          pose: fpsCountersRef.current.poseFrames,
        }));
        fpsCountersRef.current.receiveFrames = 0;
        fpsCountersRef.current.poseFrames = 0;
        fpsCountersRef.current.lastTime = now;
      }
    }
  }, [lastMessage]);

  // Process frames
  const processFrame = useCallback(async () => {
    if (!lastFrameRef.current || !poseDetectorRef.current) {
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const canvas = receivedCanvasRef.current;
    const overlay = poseOverlayRef.current;
    if (!canvas || !overlay) {
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // Draw received frame
    const img = new Image();
    img.src = lastFrameRef.current;
    await img.decode();

    canvas.width = img.width;
    canvas.height = img.height;
    overlay.width = img.width;
    overlay.height = img.height;
    ctx.drawImage(img, 0, 0);

    // Pose detection
    const poseResult = await poseDetectorRef.current.detect(canvas);
    if (poseResult) {
      setDetectedPose(poseResult);

      // Analyze movement
      const movementState = movementAnalyzerRef.current?.analyze(poseResult);
      if (movementState) {
        setCurrentMovement(movementState.type);

        // Send to presentation
        if (presentationConnection && presentationConnection.state === 'connected') {
          presentationConnection.send(JSON.stringify({ type: 'movement', movement: movementState.type }));
        }
      }

      // FPS counting
      fpsCountersRef.current.poseFrames++;
    }

    animationRef.current = requestAnimationFrame(processFrame);
  }, [presentationConnection]);

  useEffect(() => {
    if (isReceiving) {
      animationRef.current = requestAnimationFrame(processFrame);
    }

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [isReceiving, processFrame]);

  // Calibrate
  const calibrate = useCallback(() => {
    if (!detectedPose || !movementAnalyzerRef.current) return;

    movementAnalyzerRef.current.resetBaseline();
    movementAnalyzerRef.current.calibrate(detectedPose);
    setIsCalibrated(true);
  }, [detectedPose]);

  // Send game state to TV
  useEffect(() => {
    sendMessage('game-state', { score, movement: currentMovement });
  }, [score, currentMovement, sendMessage]);

  // Presentation API for TV casting
  const startPresentation = useCallback(async () => {
    if (!navigator.presentation) {
      alert('Presentation API not supported. Try using Chrome on a device that supports casting.');
      return;
    }

    try {
      const presentationRequest = new PresentationRequest(['/tv']);
      const connection = await presentationRequest.start();

      connection.onconnect = () => {
        setPresentationConnection(connection);
        setShowPresentation(true);
        sendMessage('client-connected', { type: 'computer' });
      };

      connection.onclose = () => {
        setPresentationConnection(null);
        setShowPresentation(false);
      };

      connection.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'ready') {
          console.log('TV ready');
        }
      };
    } catch (error) {
      console.error('Presentation error:', error);
    }
  }, [sendMessage]);

  const endPresentation = useCallback(() => {
    if (presentationConnection) {
      presentationConnection.close();
      setPresentationConnection(null);
      setShowPresentation(false);
    }
  }, [presentationConnection]);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      {/* Main Game Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-cyan-400">MotionPlay</h1>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              {isReceiving ? (
                <Wifi className="w-4 h-4 text-green-400" />
              ) : (
                <WifiOff className="w-4 h-4 text-slate-500" />
              )}
              <span>{isReceiving ? 'Connected' : 'Waiting for phone...'}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-700 rounded-lg p-1">
              {(['game', 'both', 'pose-view'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    viewMode === mode
                      ? 'bg-cyan-500 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {mode === 'game' ? 'Game' : mode === 'both' ? 'Both' : 'Pose'}
                </button>
              ))}
            </div>

            {/* Score */}
            {viewMode !== 'pose-view' && (
              <div className="flex items-center gap-2 bg-slate-700 rounded-lg px-4 py-2">
                <Activity className="w-5 h-5 text-cyan-400" />
                <span className="text-lg font-bold">{score}</span>
              </div>
            )}

            {/* Presentation */}
            <button
              onClick={showPresentation ? endPresentation : startPresentation}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                showPresentation
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              <Tv className="w-5 h-5" />
              <span>{showPresentation ? 'End Cast' : 'Cast to TV'}</span>
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 flex">
          {/* Game View */}
          {(viewMode === 'game' || viewMode === 'both') && (
            <div className={`${viewMode === 'both' ? 'w-1/2' : 'w-full'} p-4 flex flex-col`}>
              <JumpGame
                movement={currentMovement}
                isRunning={gameActive}
                onScoreChange={setScore}
                onGameOver={() => setGameActive(false)}
              />
            </div>
          )}

          {/* Camera View */}
          {(viewMode === 'pose-view' || viewMode === 'both') && (
            <div className={`${viewMode === 'both' ? 'w-1/2' : 'w-full'} p-4 flex flex-col`}>
              <div className="relative flex-1 bg-slate-800 rounded-lg overflow-hidden">
                {/* Received video */}
                <canvas
                  ref={receivedCanvasRef}
                  className="absolute inset-0 w-full h-full object-contain"
                />

                {/* Pose overlay */}
                <canvas
                  ref={poseOverlayRef}
                  className="absolute inset-0 w-full h-full object-contain"
                />

                {/* Status overlay */}
                <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start bg-gradient-to-b from-black/50 to-transparent">
                  <div className="flex flex-col gap-2">
                    {/* Movement indicator */}
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          currentMovement !== 'idle' ? 'bg-green-400 animate-pulse' : 'bg-slate-500'
                        }`}
                      />
                      <span className="text-sm font-medium capitalize">
                        {currentMovement.replace(/-/g, ' ')}
                      </span>
                      {movementToKeyMap[currentMovement] && (
                        <span className="text-xs text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">
                          → {movementToKeyMap[currentMovement]}
                        </span>
                      )}
                    </div>

                    {/* Calibration status */}
                    <div className="flex items-center gap-2 text-sm">
                      <Eye
                        className={`w-4 h-4 ${
                          isCalibrated ? 'text-green-400' : 'text-amber-400'
                        }`}
                      />
                      <span className={isCalibrated ? 'text-green-400' : 'text-amber-400'}>
                        {isCalibrated ? 'Calibrated' : 'Not calibrated'}
                      </span>
                    </div>
                  </div>

                  {/* FPS */}
                  <div className="flex gap-2 text-xs text-slate-400">
                    <span className="bg-slate-700 px-2 py-1 rounded">
                      Receive: {fps.receive} fps
                    </span>
                    <span className="bg-slate-700 px-2 py-1 rounded">
                      Pose: {fps.pose} fps
                    </span>
                  </div>
                </div>

                {/* Waiting message */}
                {!isReceiving && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900">
                    <Camera className="w-16 h-16 text-slate-600 mb-4" />
                    <p className="text-slate-400">
                      Open Phone View on your mobile device to start streaming
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <footer className="flex items-center justify-between px-4 py-3 bg-slate-800 border-t border-slate-700">
          <div className="flex items-center gap-4">
            {!isCalibrated ? (
              <button
                onClick={calibrate}
                disabled={!detectedPose}
                className="flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <Settings className="w-5 h-5" />
                Calibrate Pose
              </button>
            ) : (
              <button
                onClick={() => {
                  setIsCalibrated(false);
                  movementAnalyzerRef.current?.resetBaseline();
                }}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                <RefreshCw className="w-5 h-5" />
                Recalibrate
              </button>
            )}

            <button
              onClick={() => setGameActive(!gameActive)}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 rounded-lg transition-colors"
            >
              {gameActive ? (
                <>
                  <VolumeX className="w-5 h-5" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Resume
                </>
              )}
            </button>
          </div>

          <div className="text-sm text-slate-400">
            Stand in camera view and calibrate before playing
          </div>
        </footer>
      </div>
    </div>
  );
}
