import React from 'react';

export default function DSPDiagram() {
  return (
    <div className="w-full overflow-x-auto bg-[#1a1a1a] rounded-xl border border-gray-800 p-6 mb-8 shadow-2xl">
      <div className="min-w-[700px]">
        <svg viewBox="0 0 800 380" className="w-full h-auto font-mono text-xs select-none">
          <defs>
            <marker id="arrow-green" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
               <path d="M0,0 L6,3 L0,6" fill="#4ade80" />
            </marker>
            <marker id="arrow-magenta" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
               <path d="M0,0 L6,3 L0,6" fill="#d946ef" />
            </marker>
             <marker id="arrow-cyan" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
               <path d="M0,0 L6,3 L0,6" fill="#22d3ee" />
            </marker>
          </defs>

          {/* --- ENCRYPTION FLOW --- */}
          <text x="20" y="30" fill="#9ca3af" className="font-bold tracking-[0.2em] text-sm">ENCRYPTION FLOW</text>

          {/* MIC */}
          <g transform="translate(50, 80)">
             <circle cx="0" cy="0" r="18" stroke="white" strokeWidth="2" fill="none" />
             <text x="-12" y="4" fill="white" fontSize="10" fontWeight="bold">MIC</text>
             <line x1="18" y1="0" x2="50" y2="0" stroke="#4ade80" strokeWidth="2" markerEnd="url(#arrow-green)" />
          </g>

          {/* ANALYSER */}
          <g transform="translate(110, 50)">
             <rect x="0" y="0" width="70" height="60" rx="4" stroke="white" strokeWidth="2" fill="#111" />
             <text x="18" y="25" fill="white">Pitch</text>
             <line x1="0" y1="30" x2="70" y2="30" stroke="#333" strokeWidth="1" />
             <text x="22" y="50" fill="white">Mel</text>
          </g>

          {/* Pitch Path (Magenta) */}
          <path d="M 180 65 L 220 65" stroke="#d946ef" strokeWidth="2" fill="none" markerEnd="url(#arrow-magenta)" />
          <text x="185" y="58" fill="#d946ef" fontSize="9">f0</text>
          
          {/* x8 Multiplier */}
          <g transform="translate(230, 45)">
            <rect x="0" y="0" width="40" height="40" stroke="white" strokeWidth="2" fill="#111" />
            <text x="10" y="25" fill="white" fontSize="14" fontWeight="bold">x8</text>
          </g>

          {/* Osc */}
          <g transform="translate(310, 65)">
             <circle cx="0" cy="0" r="16" stroke="white" strokeWidth="2" fill="#111" />
             <path d="M -8 2 Q 0 -10 8 2" stroke="#d946ef" fill="none" strokeWidth="1.5" />
          </g>
          <line x1="270" y1="65" x2="288" y2="65" stroke="#d946ef" strokeWidth="2" markerEnd="url(#arrow-magenta)" />

          {/* Spectrum Path (Cyan) */}
          <path d="M 180 95 L 220 120" stroke="#22d3ee" strokeWidth="2" fill="none" markerEnd="url(#arrow-cyan)" />

          {/* Data Oscs */}
          <g transform="translate(230, 110)">
            <rect x="0" y="0" width="50" height="40" stroke="white" strokeWidth="2" fill="#111" />
            <text x="10" y="18" fill="white" fontSize="9">Data</text>
            <text x="10" y="32" fill="white" fontSize="9">Bank</text>
          </g>

          {/* Mixer (+ symbol) */}
          <g transform="translate(370, 90)">
             <circle cx="0" cy="0" r="18" stroke="white" strokeWidth="2" fill="#111" />
             <path d="M -8 0 L 8 0 M 0 -8 L 0 8" stroke="white" strokeWidth="2" />
          </g>

          <line x1="326" y1="65" x2="356" y2="82" stroke="#d946ef" strokeWidth="2" markerEnd="url(#arrow-magenta)" />
          <line x1="280" y1="130" x2="356" y2="98" stroke="#22d3ee" strokeWidth="2" markerEnd="url(#arrow-cyan)" />

          {/* AM Modulator (X symbol) */}
          <g transform="translate(440, 90)">
             <circle cx="0" cy="0" r="18" stroke="white" strokeWidth="2" fill="#111" />
             <path d="M -7 -7 L 7 7 M -7 7 L 7 -7" stroke="white" strokeWidth="2" />
          </g>
          <line x1="388" y1="90" x2="416" y2="90" stroke="#4ade80" strokeWidth="2" markerEnd="url(#arrow-green)" />
          <text x="400" y="85" fill="#4ade80" fontSize="9">Σ</text>
          
          {/* Amplitude Path */}
          <path d="M 145 110 L 145 160 L 440 160 L 440 114" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="4,4" fill="none" markerEnd="url(#arrow-green)" />
          <text x="150" y="155" fill="#4ade80" fontSize="10" fontWeight="bold">AM Envelope</text>

          {/* Output */}
          <g transform="translate(520, 90)">
             <path d="M 0 -12 L 12 -22 L 12 22 L 0 12 L -12 12 L -12 -12 Z" stroke="white" strokeWidth="2" fill="none" />
             <path d="M 18 -12 Q 24 0 18 12" stroke="#eab308" strokeWidth="2" fill="none" />
             <path d="M 24 -16 Q 32 0 24 16" stroke="#eab308" strokeWidth="2" fill="none" />
          </g>
          <line x1="458" y1="90" x2="500" y2="90" stroke="#4ade80" strokeWidth="2" markerEnd="url(#arrow-green)" />
          <text x="560" y="95" fill="#eab308" fontWeight="bold" fontSize="14">BIRD</text>


          {/* --- DECRYPTION FLOW --- */}
          <text x="20" y="230" fill="#9ca3af" className="font-bold tracking-[0.2em] text-sm">DECRYPTION FLOW</text>

          {/* Bird In */}
          <g transform="translate(50, 280)">
             <circle cx="0" cy="0" r="18" stroke="white" strokeWidth="2" fill="none" />
             <text x="-12" y="4" fill="#eab308" fontSize="10" fontWeight="bold">BIRD</text>
             <line x1="18" y1="0" x2="50" y2="0" stroke="#4ade80" strokeWidth="2" markerEnd="url(#arrow-green)" />
          </g>

          {/* FFT */}
          <g transform="translate(110, 250)">
             <rect x="0" y="0" width="60" height="60" rx="4" stroke="white" strokeWidth="2" fill="#111" />
             <text x="18" y="35" fill="white" fontWeight="bold">FFT</text>
          </g>

          {/* Low Path (Magenta) */}
          <path d="M 170 265 L 210 265" stroke="#d946ef" strokeWidth="2" fill="none" markerEnd="url(#arrow-magenta)" />
          <text x="175" y="258" fill="#d946ef" fontSize="9">Carrier</text>

          <g transform="translate(220, 245)">
            <rect x="0" y="0" width="40" height="40" stroke="white" strokeWidth="2" fill="#111" />
            <text x="10" y="25" fill="white" fontSize="14" fontWeight="bold">÷8</text>
          </g>

          {/* Harmonic Gen */}
          <g transform="translate(320, 265)">
             <circle cx="0" cy="0" r="18" stroke="white" strokeWidth="2" fill="#111" />
             <path d="M -10 4 Q 0 -12 10 4" stroke="#d946ef" fill="none" strokeWidth="1.5" />
             <text x="-12" y="26" fill="white" fontSize="8">Harmonics</text>
          </g>
          <line x1="260" y1="265" x2="296" y2="265" stroke="#d946ef" strokeWidth="2" markerEnd="url(#arrow-magenta)" />

          {/* High Path (Cyan) */}
          <path d="M 170 295 L 220 320" stroke="#22d3ee" strokeWidth="2" fill="none" markerEnd="url(#arrow-cyan)" />
          <text x="175" y="325" fill="#22d3ee" fontSize="9">Data Layer</text>

          <g transform="translate(230, 310)">
            <rect x="0" y="0" width="70" height="40" rx="4" stroke="white" strokeWidth="2" fill="#111" />
            <text x="10" y="24" fill="white" fontSize="10">Envelope</text>
          </g>

          {/* Vocoder/Filter */}
          <g transform="translate(400, 250)">
            <rect x="0" y="0" width="60" height="80" rx="4" stroke="white" strokeWidth="2" fill="#111" />
            <text x="6" y="45" fill="white" fontSize="10">Vocoder</text>
          </g>

          {/* Connections to Vocoder */}
          <line x1="338" y1="265" x2="394" y2="280" stroke="#d946ef" strokeWidth="2" markerEnd="url(#arrow-magenta)" />
          <line x1="300" y1="330" x2="394" y2="300" stroke="#22d3ee" strokeWidth="2" markerEnd="url(#arrow-cyan)" />

          {/* Speaker Out */}
          <g transform="translate(520, 290)">
             <path d="M 0 -12 L 12 -22 L 12 22 L 0 12 L -12 12 L -12 -12 Z" stroke="white" strokeWidth="2" fill="none" />
             <path d="M 18 -12 Q 24 0 18 12" stroke="#a855f7" strokeWidth="2" fill="none" />
          </g>
          <line x1="460" y1="290" x2="500" y2="290" stroke="#4ade80" strokeWidth="2" markerEnd="url(#arrow-green)" />
          <text x="550" y="295" fill="#a855f7" fontWeight="bold" fontSize="14">VOICE</text>

        </svg>
      </div>
    </div>
  );
}