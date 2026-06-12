import { useState } from 'react';
import { Smartphone, Monitor, Tv, Play, Zap, ArrowRight, Swords } from 'lucide-react';

export default function HomeView() {
  const [gameCode] = useState(() => Math.random().toString(36).substring(2, 8).toUpperCase());

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-4 py-2 mb-6">
            <Zap className="w-4 h-4 text-cyan-400" />
            <span className="text-cyan-300 text-sm font-medium">Real-Time Motion Gaming</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            <span className="bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-transparent">
              MotionPlay
            </span>
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-8">
            Your body is the controller. Use your phone's camera to track movements
            and control games on your computer or TV.
          </p>

          <div className="inline-block bg-slate-800/50 border border-slate-700 rounded-lg px-6 py-3 mb-12">
            <p className="text-sm text-slate-400 mb-1">Your Session Code</p>
            <p className="text-3xl font-mono font-bold text-cyan-400 tracking-widest">{gameCode}</p>
          </div>
        </div>

        {/* Role Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {/* Phone */}
          <div className="group relative bg-gradient-to-br from-slate-800/50 to-slate-800/30 border border-slate-700/50 rounded-2xl p-6 hover:border-cyan-500/50 transition-all duration-300">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-14 h-14 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-cyan-500/25">
                <Smartphone className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Phone View</h3>
              <p className="text-slate-400 text-sm mb-4">
                Open this on your phone. The camera will track your body movements and stream to your computer.
              </p>
              <a
                href="/phone"
                className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 font-medium text-sm group/link"
              >
                Open Phone View
                <ArrowRight className="w-4 h-4 group-hover/link:translate-x-1 transition-transform" />
              </a>
            </div>
          </div>

          {/* Computer */}
          <div className="group relative bg-gradient-to-br from-slate-800/50 to-slate-800/30 border border-slate-700/50 rounded-2xl p-6 hover:border-teal-500/50 transition-all duration-300">
            <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-14 h-14 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-teal-500/25">
                <Monitor className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Computer View</h3>
              <p className="text-slate-400 text-sm mb-4">
                Main control center. Receives camera feed, analyzes movements, runs the game, and can cast to TV.
              </p>
              <a
                href="/computer"
                className="inline-flex items-center gap-2 text-teal-400 hover:text-teal-300 font-medium text-sm group/link"
              >
                Open Computer View
                <ArrowRight className="w-4 h-4 group-hover/link:translate-x-1 transition-transform" />
              </a>
            </div>
          </div>

          {/* TV */}
          <div className="group relative bg-gradient-to-br from-slate-800/50 to-slate-800/30 border border-slate-700/50 rounded-2xl p-6 hover:border-orange-500/50 transition-all duration-300">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-14 h-14 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-orange-500/25">
                <Tv className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">TV View</h3>
              <p className="text-slate-400 text-sm mb-4">
                Open on your TV browser or use the Presentation API to cast the game for a big-screen experience.
              </p>
              <a
                href="/tv"
                className="inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 font-medium text-sm group/link"
              >
                Open TV View
                <ArrowRight className="w-4 h-4 group-hover/link:translate-x-1 transition-transform" />
              </a>
            </div>
          </div>
        </div>

        {/* How It Works */}
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { step: 1, title: 'Position Phone', desc: 'Set phone to capture full body' },
              { step: 2, title: 'Stream Video', desc: 'Camera streams to computer via WebRTC' },
              { step: 3, title: 'Detect Motion', desc: 'AI analyzes body pose in real-time' },
              { step: 4, title: 'Play Game', desc: 'Your movements control the game' },
            ].map((item) => (
              <div key={item.step} className="relative">
                <div className="flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center font-bold mb-3">
                    {item.step}
                  </div>
                  <h4 className="font-semibold mb-1">{item.title}</h4>
                  <p className="text-slate-400 text-xs">{item.desc}</p>
                </div>
                {item.step < 4 && (
                  <div className="hidden md:block absolute top-5 left-full w-full h-0.5 bg-gradient-to-r from-cyan-500/50 to-transparent -translate-x-1/2" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Games Available */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center mb-8">Available Games</h2>
          <div className="flex justify-center gap-6 flex-wrap">
            {/* MK9 — featured */}
            <div className="relative group bg-gradient-to-br from-red-900/40 to-slate-800/40 border-2 border-red-500/50 rounded-2xl p-5 flex items-center gap-5 hover:border-red-400 transition-all duration-300 hover:scale-105 cursor-pointer max-w-sm">
              <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">NEW</div>
              <div className="w-14 h-14 bg-gradient-to-br from-red-500 to-red-700 rounded-xl flex items-center justify-center shadow-lg shadow-red-500/30 flex-shrink-0">
                <Swords className="w-7 h-7 text-white" />
              </div>
              <div>
                <h4 className="font-bold text-lg text-white">MK9 Stick Fight</h4>
                <p className="text-slate-400 text-sm mt-0.5">
                  Red vs Blue stickman brawl. Jump to kick, crouch to dodge, lean to move!
                </p>
                <div className="flex gap-2 mt-2">
                  {['KICK', 'DODGE', 'PUNCH'].map(tag => (
                    <span key={tag} className="text-xs bg-red-500/20 border border-red-500/30 text-red-300 px-2 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Jump Dash */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5 flex items-center gap-5 max-w-sm hover:border-cyan-500/50 transition-all duration-300">
              <div className="w-14 h-14 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <Play className="w-7 h-7 text-white" />
              </div>
              <div>
                <h4 className="font-bold text-lg text-white">Jump Dash</h4>
                <p className="text-slate-400 text-sm mt-0.5">Endless runner — jump to clear obstacles</p>
                <div className="flex gap-2 mt-2">
                  {['JUMP', 'CROUCH'].map(tag => (
                    <span key={tag} className="text-xs bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="text-center mt-6">
            <a
              href="/computer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white font-bold rounded-xl shadow-lg shadow-red-500/20 transition-all hover:scale-105"
            >
              <Swords className="w-5 h-5" />
              Play Now
              <ArrowRight className="w-5 h-5" />
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6">
        <div className="max-w-7xl mx-auto px-4 text-center text-slate-500 text-sm">
          MotionPlay - Real-time body motion gaming with MediaPipe pose detection
        </div>
      </footer>
    </div>
  );
}
