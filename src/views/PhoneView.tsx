import { useEffect, useRef, useState, useCallback } from 'react';
import { useBroadcastChannel } from '../hooks/useBroadcastChannel';
import { Camera, CameraOff, RotateCcw, Wifi, Users } from 'lucide-react';

export default function PhoneView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);

  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [useBackCamera, setUseBackCamera] = useState(true);
  const [connectedClients, setConnectedClients] = useState(0);

  const { sendMessage, lastMessage } = useBroadcastChannel('motion-play');

  const fpsCounterRef = useRef({ frames: 0, lastTime: performance.now() });

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: useBackCamera ? 'environment' : 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsStreaming(true);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access camera');
      setIsStreaming(false);
    }
  }, [useBackCamera]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    cancelAnimationFrame(animationRef.current);
  }, []);

  const broadcastFrame = useCallback(() => {
    if (!videoRef.current || !isStreaming) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    // Use lower resolution for performance
    const scale = 0.5;
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const frameData = canvas.toDataURL('image/jpeg', 0.5);

    sendMessage('camera-frame', {
      frame: frameData,
      width: video.videoWidth,
      height: video.videoHeight,
      timestamp: performance.now()
    });

    // FPS tracking
    fpsCounterRef.current.frames++;
    const now = performance.now();
    if (now - fpsCounterRef.current.lastTime >= 1000) {
      setFps(fpsCounterRef.current.frames);
      fpsCounterRef.current.frames = 0;
      fpsCounterRef.current.lastTime = now;
    }

    animationRef.current = requestAnimationFrame(broadcastFrame);
  }, [isStreaming, sendMessage]);

  useEffect(() => {
    if (isStreaming) {
      animationRef.current = requestAnimationFrame(broadcastFrame);
    }

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [isStreaming, broadcastFrame]);

  useEffect(() => {
    if (lastMessage?.type === 'client-connected') {
      setConnectedClients(prev => prev + 1);
    } else if (lastMessage?.type === 'client-disconnected') {
      setConnectedClients(prev => Math.max(0, prev - 1));
    } else if (lastMessage?.type === 'ping-computer') {
      sendMessage('pong-phone', { timestamp: Date.now() });
    }
  }, [lastMessage, sendMessage]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="font-medium">
            {isStreaming ? 'Streaming' : 'Not Connected'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {fps > 0 && (
            <span className="text-xs text-slate-400 bg-slate-700 px-2 py-1 rounded">
              {fps} FPS
            </span>
          )}
        </div>
      </header>

      {/* Video Feed */}
      <div className="flex-1 relative bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          autoPlay
        />

        {/* Overlay when not streaming */}
        {!isStreaming && (
          <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center">
            <Camera className="w-16 h-16 text-slate-600 mb-4" />
            <p className="text-slate-400 text-center px-4">
              Tap the camera button below to start streaming
            </p>
          </div>
        )}

        {/* Connection status */}
        {isStreaming && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
            {connectedClients > 0 ? (
              <>
                <Wifi className="w-4 h-4 text-green-400" />
                <span className="text-sm text-white">
                  {connectedClients} client{connectedClients !== 1 ? 's' : ''} connected
                </span>
              </>
            ) : (
              <>
                <Users className="w-4 h-4 text-amber-400" />
                <span className="text-sm text-white">Waiting for computer...</span>
              </>
            )}
          </div>
        )}

        {/* Camera placement guide */}
        {isStreaming && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-64 border-2 border-dashed border-white/30 rounded-lg flex items-center justify-center">
              <span className="text-white/50 text-xs text-center px-2">
                Position yourself here
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-500/20 border-t border-red-500/50 px-4 py-3">
          <p className="text-red-300 text-sm text-center">{error}</p>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 p-4 bg-slate-800 border-t border-slate-700">
        <button
          onClick={isStreaming ? stopCamera : startCamera}
          className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium transition-all ${
            isStreaming
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-cyan-500 hover:bg-cyan-600 text-white'
          }`}
        >
          {isStreaming ? (
            <>
              <CameraOff className="w-5 h-5" />
              Stop Camera
            </>
          ) : (
            <>
              <Camera className="w-5 h-5" />
              Start Camera
            </>
          )}
        </button>

        <button
          onClick={() => {
            stopCamera();
            setUseBackCamera(prev => !prev);
          }}
          disabled={!isStreaming}
          className="flex items-center justify-center p-3 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          title="Switch camera"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </div>

      {/* Instructions */}
      <div className="bg-slate-800/50 px-4 py-3 border-t border-slate-700">
        <p className="text-slate-400 text-xs text-center">
          Open Computer View on your computer to receive the camera feed and play games
        </p>
      </div>
    </div>
  );
}
