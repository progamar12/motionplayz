import { useState, useEffect } from 'react';
import { useBroadcastChannel } from '../hooks/useBroadcastChannel';
import { JumpGame } from '../components/JumpGame';
import { MovementType } from '../utils/movementAnalyzer';
import { Tv, Wifi, WifiOff, Play } from 'lucide-react';

export default function TVView() {
  const [movement, setMovement] = useState<MovementType>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const [score, setScore] = useState(0);
  const [showGame, setShowGame] = useState(true);

  const { sendMessage, lastMessage } = useBroadcastChannel('motion-play');

  // Handle incoming messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'movement') {
      setMovement((lastMessage.payload as { movement: MovementType }).movement);
      setIsConnected(true);
    } else if (lastMessage.type === 'game-state') {
      const { score: newScore } = lastMessage.payload as { score: number; movement: MovementType };
      setScore(newScore);
    }
  }, [lastMessage]);

  // Notify computer that TV is ready
  useEffect(() => {
    sendMessage('client-connected', { type: 'tv' });

    const interval = setInterval(() => {
      sendMessage('pong-phone', { timestamp: Date.now() });
    }, 5000);

    return () => {
      clearInterval(interval);
      sendMessage('client-disconnected', { type: 'tv' });
    };
  }, [sendMessage]);

  // Listen for Presentation connections
  useEffect(() => {
    if (navigator.presentation?.receiver) {
      navigator.presentation.receiver.connectionList.then((list: PresentationConnectionList) => {
        list.connections.forEach((connection: PresentationConnection) => {
          connection.addEventListener('message', (event: Event) => {
            const messageEvent = event as MessageEvent;
            const data = JSON.parse(messageEvent.data);
            if (data.type === 'movement') {
              setMovement(data.movement as MovementType);
              setIsConnected(true);
            }
          });
        });

        // Set up connection availability handler
        list.addEventListener('connectionavailable', () => {
          setIsConnected(true);
        });
      });
    }
  }, []);

  // Handle custom presentation protocol
  useEffect(() => {
    const handlePresentationMessage = (event: MessageEvent) => {
      if (event.data && typeof event.data === 'string') {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'movement') {
            setMovement(data.movement as MovementType);
            setIsConnected(true);
          }
        } catch {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener('message', handlePresentationMessage);

    return () => {
      window.removeEventListener('message', handlePresentationMessage);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 bg-slate-800/50 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <Tv className="w-8 h-8 text-orange-400" />
          <div>
            <h1 className="text-2xl font-bold">MotionPlay TV</h1>
            <p className="text-sm text-slate-400">Big Screen Mode</p>
          </div>
        </div>

        <div className="flex items-center gap-8">
          {/* Score */}
          <div className="text-center">
            <p className="text-sm text-slate-400">Score</p>
            <p className="text-4xl font-bold text-cyan-400">{score}</p>
          </div>

          {/* Movement */}
          <div className="text-center">
            <p className="text-sm text-slate-400">Movement</p>
            <p className="text-2xl font-bold capitalize text-teal-400">
              {movement.replace(/-/g, ' ')}
            </p>
          </div>

          {/* Connection */}
          <div className="flex items-center gap-2 bg-slate-700 rounded-lg px-4 py-2">
            {isConnected ? (
              <>
                <Wifi className="w-5 h-5 text-green-400" />
                <span className="text-green-400">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-5 h-5 text-slate-500" />
                <span className="text-slate-500">Waiting</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Game Area */}
      <div className="flex-1 p-6">
        {showGame ? (
          <div className="h-full bg-slate-800 rounded-xl overflow-hidden shadow-2xl">
            <JumpGame
              movement={movement}
              isRunning={true}
              onScoreChange={setScore}
            />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center bg-slate-800 rounded-xl">
            <Tv className="w-24 h-24 text-slate-600 mb-4" />
            <p className="text-slate-400 text-xl mb-4">
              Open Computer View and cast to this screen
            </p>
            <button
              onClick={() => setShowGame(true)}
              className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 rounded-lg text-lg font-medium transition-colors"
            >
              <Play className="w-6 h-6" />
              Start Game Display
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="text-center py-4 bg-slate-800/50 border-t border-slate-700">
        <p className="text-slate-400 text-sm">
          Open Computer View on your computer to start casting
        </p>
      </footer>
    </div>
  );
}
