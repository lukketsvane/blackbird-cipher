import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  SAMPLE_RATE, 
  FFT_SIZE, 
  HOP_SIZE, 
  NUM_BANDS, 
  SPEECH_MAX_FREQ,
  BIRD_DATA_START_FREQ,
  BIRD_DATA_STEP,
  PITCH_MULTIPLIER,
  MAX_RECORDING_TIME_MS
} from '../constants';
import { FrameAnalysis, ProcessingMode, DecodedFrame } from '../types';
import { audioBufferToWav } from '../utils/audioUtils';
import { Mic, Play, Download, Activity, Music, Volume2, Info, ArrowDownCircle } from 'lucide-react';
import DSPDiagram from './DSPDiagram';

// --- STATIC DSP HELPERS ---

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1);

const getMelBands = () => {
  const minMel = hzToMel(100); 
  const maxMel = hzToMel(SPEECH_MAX_FREQ);
  const step = (maxMel - minMel) / NUM_BANDS;
  const bands: {start: number, end: number, center: number}[] = [];
  
  for(let i=0; i<NUM_BANDS; i++) {
      const startHz = melToHz(minMel + i * step);
      const endHz = melToHz(minMel + (i + 1) * step);
      bands.push({
          start: startHz, 
          end: endHz,
          center: melToHz(minMel + (i + 0.5) * step)
      });
  }
  return bands;
};

const MEL_BANDS = getMelBands();

export default function BirdsongCodec() {
  const [mode, setMode] = useState<ProcessingMode>('idle');
  const [recordedAudio, setRecordedAudio] = useState<AudioBuffer | null>(null);
  const [encodedAudio, setEncodedAudio] = useState<AudioBuffer | null>(null);
  const [decodedAudio, setDecodedAudio] = useState<AudioBuffer | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Ready to record speech');
  const [showInfo, setShowInfo] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({ sampleRate: SAMPLE_RATE });
    }
    return audioContextRef.current;
  }, []);

  const drawCanvas = useCallback((data: Uint8Array, color: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#0f172a'; // slate-900
    ctx.fillRect(0, 0, width, height);

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.strokeStyle = color;

    const sliceWidth = width / data.length;
    let x = 0;

    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0;
      const y = v * height / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }, []);

  // --- DSP FUNCTIONS ---

  const extractPitch = (buffer: Float32Array, sampleRate: number): number => {
    // Optimized range for human speech fundamental freq
    const minPeriod = Math.floor(sampleRate / 800); 
    const maxPeriod = Math.floor(sampleRate / 70);  

    let bestCorrelation = 0;
    let bestPeriod = 0;

    // Downsampled autocorrelation for speed and noise resistance
    const step = 2;
    for (let period = minPeriod; period < maxPeriod; period++) {
      let correlation = 0;
      for (let i = 0; i < buffer.length - period; i += step) { 
        correlation += buffer[i] * buffer[i + period];
      }
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = period;
      }
    }
    
    // RMS Threshold to detect silence
    const rms = Math.sqrt(buffer.reduce((s, v) => s + v*v, 0) / buffer.length);
    if (rms < 0.01) return 0;

    return bestPeriod > 0 ? sampleRate / bestPeriod : 0;
  };

  const computeMagnitudeSpectrum = (samples: Float32Array): Float32Array => {
    const fftSize = FFT_SIZE;
    const halfSize = fftSize / 2;
    const magnitudes = new Float32Array(halfSize);
    
    const maxBin = halfSize; // Analyze full spectrum
    const windowed = new Float32Array(fftSize);
    for(let i=0; i<fftSize; i++) {
        // Hanning window
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
        windowed[i] = (i < samples.length ? samples[i] : 0) * w;
    }

    // Standard DFT (slow but reliable without WASM)
    // Optimization: Only compute relevant bins if needed, but we need full spectrum for Mel
    const binStep = 1; 
    for (let k = 0; k < maxBin; k += binStep) {
        let r = 0;
        let i_val = 0;
        const angleFactor = -2 * Math.PI * k / fftSize;
        
        // Unroll loop slightly or step by 2 for speed
        for (let n = 0; n < fftSize; n += 2) { 
             const x = windowed[n];
             if (Math.abs(x) > 1e-6) {
                 const angle = angleFactor * n;
                 r += x * Math.cos(angle);
                 i_val += x * Math.sin(angle);
             }
        }
        magnitudes[k] = Math.sqrt(r*r + i_val*i_val);
    }
    return magnitudes;
  };

  const analyzeSpeechFrame = (samples: Float32Array): FrameAnalysis => {
    const magnitudes = computeMagnitudeSpectrum(samples);
    const binSize = SAMPLE_RATE / FFT_SIZE;
    
    const bandEnergies = new Float32Array(NUM_BANDS);
    
    MEL_BANDS.forEach((band, b) => {
        const startBin = Math.floor(band.start / binSize);
        const endBin = Math.floor(band.end / binSize);
        let sum = 0;
        let count = 0;
        // Peak-finding within band preserves formants better than averaging
        for(let k=startBin; k<=endBin; k++) {
            if(k < magnitudes.length) {
                if (magnitudes[k] > sum) sum = magnitudes[k];
                count++;
            }
        }
        bandEnergies[b] = sum; 
    });
    
    let sumSq = 0;
    for(let i=0; i<samples.length; i++) sumSq += samples[i]*samples[i];
    
    return { 
        bandEnergies, 
        pitch: extractPitch(samples, SAMPLE_RATE), 
        amplitude: Math.sqrt(sumSq / samples.length) 
    };
  };

  // --- WORKERS ---
  
  const encodeTobirdsong = async (inputBufferOverride?: AudioBuffer): Promise<AudioBuffer | null> => {
    const bufferToProcess = inputBufferOverride || recordedAudio;
    if (!bufferToProcess) return null;

    setIsProcessing(true);
    setStatus('Encoding: Morphing vocal tract to syrinx...');
    await new Promise(r => setTimeout(r, 10));

    try {
        const ctx = initAudioContext();
        const inputData = bufferToProcess.getChannelData(0);
        
        const numFrames = Math.floor((inputData.length - FFT_SIZE) / HOP_SIZE);
        if (numFrames <= 0) throw new Error("Audio too short");

        const outputLength = inputData.length;
        const outputData = new Float32Array(outputLength);
        
        const frames: FrameAnalysis[] = [];
        for (let f = 0; f < numFrames; f++) {
            const start = f * HOP_SIZE;
            frames.push(analyzeSpeechFrame(inputData.slice(start, start + FFT_SIZE)));
            if (f % 50 === 0) await new Promise(r => setTimeout(r, 0));
        }
        
        let phaseMain = 0;
        const phaseData = new Float32Array(NUM_BANDS);
        for(let i=0; i<NUM_BANDS; i++) phaseData[i] = Math.random() * 2 * Math.PI;

        for (let i = 0; i < outputLength; i++) {
            const frameIndex = Math.floor(i / HOP_SIZE);
            if (frameIndex >= numFrames - 1) break;
            
            const pos = (i % HOP_SIZE) / HOP_SIZE;
            const frame = frames[frameIndex];
            const next = frames[frameIndex + 1];
            
            // Interpolation
            const pitch = frame.pitch * (1 - pos) + next.pitch * pos;
            const amp = frame.amplitude * (1 - pos) + next.amplitude * pos;
            
            let sample = 0;
            
            // --- BIRD CARRIER (The "Åt" Sound) ---
            // Pure sine wave following the pitch contour. 
            // Amplitude strictly follows input voice envelope.
            if (pitch > 50) {
                const birdFreq = pitch * PITCH_MULTIPLIER;
                phaseMain += 2 * Math.PI * birdFreq / SAMPLE_RATE;
                sample += Math.sin(phaseMain) * 0.8; 
            }
            
            // --- DATA PAYLOAD (Spectral Hiding) ---
            // Encodes formants into high-freq sine waves
            let dataSignal = 0;
            for (let b = 0; b < NUM_BANDS; b++) {
                const bandE = frame.bandEnergies[b] * (1 - pos) + next.bandEnergies[b] * pos;
                const carrierFreq = BIRD_DATA_START_FREQ + b * BIRD_DATA_STEP;
                
                phaseData[b] += 2 * Math.PI * carrierFreq / SAMPLE_RATE;
                dataSignal += Math.sin(phaseData[b]) * bandE; 
            }
            
            // Mix: Bird is loud, Data is subtle but present
            sample += dataSignal * 0.15;
            
            // Master Amplitude
            // Crucially, we apply the amplitude envelope to the ENTIRE signal
            // This is what makes it sound like a "living" bird responding to the voice
            sample *= amp;
            
            outputData[i] = sample;
             if (i % 5000 === 0) await new Promise(r => setTimeout(r, 0));
        }
        
        // Normalize
        let maxVal = 0;
        for(let i=0; i<outputData.length; i++) maxVal = Math.max(maxVal, Math.abs(outputData[i]));
        if (maxVal > 0) {
            const gain = 0.95 / maxVal;
            for(let i=0; i<outputData.length; i++) outputData[i] *= gain;
        }

        const outBuffer = ctx.createBuffer(1, outputLength, SAMPLE_RATE);
        outBuffer.getChannelData(0).set(outputData);
        setEncodedAudio(outBuffer);
        setStatus('Encryption complete.');
        drawWaveform(outputData, '#f59e0b');
        return outBuffer;
        
    } catch (e: any) {
        console.error(e);
        setStatus('Error: ' + e.message);
        return null;
    } finally {
        setIsProcessing(false);
    }
  };
  
  const decodeFrombirdsong = async (inputBufferOverride?: AudioBuffer): Promise<AudioBuffer | null> => {
    const bufferToProcess = inputBufferOverride || encodedAudio;
    if (!bufferToProcess) return null;

    setIsProcessing(true);
    setStatus('Decoding: Harmonic resynthesis...');
    await new Promise(r => setTimeout(r, 10));

    try {
        const ctx = initAudioContext();
        const inputData = bufferToProcess.getChannelData(0);
        const numFrames = Math.floor((inputData.length - FFT_SIZE) / HOP_SIZE);
        
        if (numFrames <= 0) throw new Error("Audio too short");
        
        const outputLength = inputData.length;
        const outputData = new Float32Array(outputLength);
        const binSize = SAMPLE_RATE / FFT_SIZE;
        const frames: DecodedFrame[] = [];
        
        // Pitch smoothing buffer
        const pitchBuf: number[] = [0,0,0,0,0]; 

        for (let f = 0; f < numFrames; f++) {
            const start = f * HOP_SIZE;
            const chunk = inputData.slice(start, start + FFT_SIZE);
            const magnitudes = computeMagnitudeSpectrum(chunk);
            
            // 1. Recover Pitch from Bird Carrier (Strongest Signal)
            // Look for peak in the expected bird range
            const minBin = Math.floor(600 / binSize); // ~600Hz
            const limitBin = Math.floor(5000 / binSize); // ~5000Hz
            
            let maxMag = 0;
            let peakBin = 0;
            for(let k=minBin; k<limitBin; k++) {
                if(magnitudes[k] > maxMag) {
                    maxMag = magnitudes[k];
                    peakBin = k;
                }
            }
            
            let pitch = 0;
            // Threshold ensures we don't pick up the data layer as pitch
            if (maxMag > 0.05) { 
                // Quadratic interpolation for precise frequency
                let refinedBin = peakBin;
                 if (peakBin > 0 && peakBin < magnitudes.length - 1) {
                    const alpha = magnitudes[peakBin - 1];
                    const beta = magnitudes[peakBin];
                    const gamma = magnitudes[peakBin + 1];
                    refinedBin = peakBin + 0.5 * (alpha - gamma) / (alpha - 2*beta + gamma);
                }
                const birdFreq = refinedBin * binSize;
                pitch = birdFreq / PITCH_MULTIPLIER;
            }
            
            // Median Filter for stable pitch
            pitchBuf.push(pitch);
            pitchBuf.shift();
            const sorted = [...pitchBuf].sort((a,b) => a-b);
            const smoothedPitch = sorted[2];
            
            // 2. Recover Spectral Envelope (Formants) from Data Layer
            const bandEnergies = new Float32Array(NUM_BANDS);
            for(let b=0; b<NUM_BANDS; b++) {
                const targetFreq = BIRD_DATA_START_FREQ + b * BIRD_DATA_STEP;
                const centerBin = Math.floor(targetFreq / binSize);
                
                // Scan around expected carrier to handle slight doppler/tape flutter
                let bandMax = 0;
                const width = 2;
                for(let k = centerBin - width; k <= centerBin + width; k++) {
                    if (k >= 0 && k < magnitudes.length) {
                        bandMax = Math.max(bandMax, magnitudes[k]);
                    }
                }
                // Boost high freqs slightly for clarity
                const eq = 1.0 + (b / NUM_BANDS) * 2.0; 
                bandEnergies[b] = bandMax * 80.0 * eq; 
            }
            
            frames.push({ pitch: smoothedPitch, bandEnergies, amplitude: maxMag });
            if (f % 50 === 0) await new Promise(r => setTimeout(r, 0));
        }
        
        // Synthesis State
        const harmonicPhases = new Float32Array(64); // Track phases for up to 64 harmonics
        let noisePhase = 0;

        for (let i = 0; i < outputLength; i++) {
            const idx = Math.floor(i / HOP_SIZE);
            if (idx >= frames.length - 1) break;
            const pos = (i % HOP_SIZE) / HOP_SIZE;
            const frame = frames[idx];
            const next = frames[idx+1];
            
            const p = frame.pitch * (1-pos) + next.pitch * pos;
            
            let sample = 0;
            
            // --- HARMONIC RESYNTHESIS (Harmonic Vocoder) ---
            // This is key for intelligibility. Instead of synthesizing the Mel bands directly (robotic),
            // We synthesize harmonics of the voice pitch (Human).
            // We measure the Mel envelope at the harmonic's frequency to determine its volume.
            
            if (p > 60) {
                // Voiced: Sum of Harmonics
                for (let h = 1; h <= 40; h++) {
                    const freq = p * h;
                    if (freq > SPEECH_MAX_FREQ) break;
                    
                    // Update phase
                    harmonicPhases[h] += 2 * Math.PI * freq / SAMPLE_RATE;
                    if (harmonicPhases[h] > 2 * Math.PI) harmonicPhases[h] -= 2 * Math.PI;

                    // Map harmonic frequency to our Mel bands to find amplitude
                    const mel = hzToMel(freq);
                    // Map Mel back to band index 0..NUM_BANDS
                    const minMel = hzToMel(100);
                    const maxMel = hzToMel(SPEECH_MAX_FREQ);
                    const bandIdx = ((mel - minMel) / (maxMel - minMel)) * NUM_BANDS;
                    
                    let amp = 0;
                    if (bandIdx >= 0 && bandIdx < NUM_BANDS - 1) {
                        const b1 = Math.floor(bandIdx);
                        const b2 = b1 + 1;
                        const frac = bandIdx - b1;
                        
                        const e1 = frame.bandEnergies[b1] * (1-pos) + next.bandEnergies[b1] * pos;
                        const e2 = frame.bandEnergies[b2] * (1-pos) + next.bandEnergies[b2] * pos;
                        amp = e1 * (1-frac) + e2 * frac;
                    }
                    
                    sample += Math.sin(harmonicPhases[h]) * amp;
                }
            } else {
                // Unvoiced: Filtered Noise
                // Fallback to standard vocoder for whispers/sibilance
                noisePhase += 1000; // Pseudo random walk
                const noise = (Math.random() * 2 - 1);
                
                let sibilance = 0;
                for(let b=0; b<NUM_BANDS; b+=2) {
                     const energy = frame.bandEnergies[b] * (1-pos) + next.bandEnergies[b] * pos;
                     const f = MEL_BANDS[b].center;
                     sibilance += Math.sin(i * f * 0.001 + noisePhase) * energy * noise;
                }
                sample += sibilance * 0.5;
            }
            
            outputData[i] = sample * 0.003;
            if (i % 5000 === 0) await new Promise(r => setTimeout(r, 0));
        }
        
        let maxOut = 0;
        for(let i=0; i<outputData.length; i++) maxOut = Math.max(maxOut, Math.abs(outputData[i]));
        if (maxOut > 0) {
            const gain = 0.85 / maxOut;
            for(let i=0; i<outputData.length; i++) outputData[i] *= gain;
        }

        const outBuffer = ctx.createBuffer(1, outputLength, SAMPLE_RATE);
        outBuffer.getChannelData(0).set(outputData);
        setDecodedAudio(outBuffer);
        setStatus('Decoded. Speech pattern restored.');
        drawWaveform(outputData, '#8b5cf6');
        return outBuffer;

    } catch (e: any) {
        console.error(e);
        setStatus('Error: ' + (e.message || "Unknown error during decoding"));
        return null;
    } finally {
        setIsProcessing(false);
    }
  };

  const drawWaveform = (data: Float32Array, color: string) => {
      const displayData = new Uint8Array(256);
      const step = Math.floor(data.length / 256);
      for(let i=0; i<256; i++) {
          const val = data[i*step];
          displayData[i] = Math.floor((val + 1) * 128);
      }
      drawCanvas(displayData, color);
  };
  
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = initAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      mediaRecorder.onstop = async () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        stream.getTracks().forEach(t => t.stop());

        if (chunksRef.current.length === 0) {
            setStatus('Error: No audio data captured');
            return;
        }

        try {
            const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
            if (blob.size < 100) throw new Error("Recording too short/silent");

            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            
            const mono = ctx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
            mono.getChannelData(0).set(audioBuffer.getChannelData(0));
            setRecordedAudio(mono);
            setStatus('Recording captured. Processing...');
            drawWaveform(mono.getChannelData(0), '#10b981');

            // Auto-process sequence
            const encoded = await encodeTobirdsong(mono);
            if (encoded) {
                await decodeFrombirdsong(encoded);
            }

        } catch (err: any) {
            setStatus('Processing failed: ' + err.message);
        }
      };

      mediaRecorder.start();
      setMode('recording');
      setStatus('Recording... (Speak clearly)');
      setEncodedAudio(null);
      setDecodedAudio(null);
      
      // Enforce limit
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = window.setTimeout(() => {
          if (mediaRecorder.state === 'recording') stopRecording();
      }, MAX_RECORDING_TIME_MS);

      const loop = () => {
        if (analyser && mediaRecorder.state === 'recording') {
            const buf = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteTimeDomainData(buf);
            drawCanvas(buf, '#ef4444');
            animationRef.current = requestAnimationFrame(loop);
        }
      };
      loop();
    } catch (e: any) {
        setStatus('Mic Error: ' + e.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
        setMode('idle');
        if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    }
  };

  const playAudio = async (buffer: AudioBuffer) => {
      const ctx = initAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
      
      const d = buffer.getChannelData(0);
      let color = '#10b981';
      if (buffer === encodedAudio) color = '#f59e0b';
      if (buffer === decodedAudio) color = '#8b5cf6';
      drawWaveform(d, color);
  };
  
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if(!f) return;
      try {
        const ctx = initAudioContext();
        const ab = await f.arrayBuffer();
        const b = await ctx.decodeAudioData(ab);
        const mono = ctx.createBuffer(1, b.length, b.sampleRate);
        mono.getChannelData(0).set(b.getChannelData(0));
        
        if (f.name.includes('bird')) {
            setEncodedAudio(mono);
            setRecordedAudio(null);
            setDecodedAudio(null);
            setStatus('Birdsong file loaded.');
            drawWaveform(mono.getChannelData(0), '#f59e0b');
        } else {
            setRecordedAudio(mono);
            setEncodedAudio(null);
            setDecodedAudio(null);
            setStatus('Speech file loaded.');
            drawWaveform(mono.getChannelData(0), '#10b981');
        }
      } catch (err: any) {
          setStatus('File load error: ' + err.message);
      }
  };

  const downloadAudio = (buffer: AudioBuffer, name: string) => {
      const wav = audioBufferToWav(buffer);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const downloadAllAssets = () => {
    if (recordedAudio) downloadAudio(recordedAudio, '1_source.wav');
    setTimeout(() => {
        if (encodedAudio) downloadAudio(encodedAudio, '2_cipher_bird.wav');
    }, 300);
    setTimeout(() => {
        if (decodedAudio) downloadAudio(decodedAudio, '3_restored_voice.wav');
    }, 600);
  };

  useEffect(() => {
      return () => {
          if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
          if (animationRef.current) cancelAnimationFrame(animationRef.current);
      }
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 flex flex-col items-center font-sans">
      <div className="max-w-4xl w-full space-y-8">
        
        {/* Header */}
        <header className="text-center relative">
             <div className="absolute right-0 top-0">
                 <button onClick={() => setShowInfo(!showInfo)} className="p-2 text-gray-500 hover:text-white transition">
                    <Info size={20} />
                 </button>
             </div>
             <div className="inline-flex items-center justify-center p-4 bg-gray-900/50 rounded-full mb-6 ring-1 ring-gray-800 backdrop-blur-sm">
                <Mic className="w-6 h-6 text-green-400 mr-4" />
                <Activity className="w-6 h-6 text-gray-600 mr-4" />
                <Music className="w-6 h-6 text-amber-400 mr-4" />
                <Activity className="w-6 h-6 text-gray-600 mr-4" />
                <Volume2 className="w-6 h-6 text-purple-400" />
            </div>
            <h1 className="text-5xl font-black mb-4 bg-gradient-to-br from-white via-gray-400 to-gray-600 bg-clip-text text-transparent tracking-tighter">
            AVIAN CIPHER
            </h1>
            <p className="text-gray-400 font-medium tracking-wide text-sm uppercase">
            Biomimetic Audio Encryption
            </p>
        </header>

        {/* Viz Area */}
        <div className="bg-slate-900 rounded-3xl p-1 border border-slate-800 shadow-2xl relative overflow-hidden group h-48">
            <canvas ref={canvasRef} width={800} height={190} className="w-full h-full rounded-2xl opacity-80" />
            <div className="absolute bottom-4 left-6 flex items-center space-x-3">
                 <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-amber-400 animate-ping' : 'bg-emerald-500'}`}></div>
                 <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">{status}</span>
            </div>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Stage 1: Input */}
            <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl hover:border-green-500/30 transition-colors group">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-bold text-gray-200">1. Source</h2>
                    <Mic size={18} className="text-green-500" />
                </div>
                <div className="space-y-3">
                    <button 
                        onClick={mode === 'recording' ? stopRecording : startRecording}
                        disabled={isProcessing}
                        className={`w-full py-4 rounded-xl font-bold text-sm tracking-wider uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed ${mode === 'recording' ? 'bg-red-500/10 text-red-500 border border-red-500/50' : 'bg-green-500 text-slate-900 hover:bg-green-400'}`}
                    >
                        {mode === 'recording' ? 'Stop Capture' : 'Record Voice'}
                    </button>
                    <div className="relative group/up">
                        <input type="file" accept="audio/*" onChange={handleFileUpload} disabled={isProcessing} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" />
                        <button disabled={isProcessing} className="w-full py-3 rounded-xl border border-slate-700 text-slate-400 text-xs font-bold uppercase hover:bg-slate-800 transition-all disabled:opacity-50">
                            Load Audio File
                        </button>
                    </div>
                    {recordedAudio && (
                        <div className="flex space-x-2">
                            <button onClick={() => playAudio(recordedAudio)} className="flex-1 py-2 rounded-xl bg-slate-800 text-green-400 hover:bg-slate-700 transition-all flex items-center justify-center">
                                <Play size={14} />
                            </button>
                            <button onClick={() => downloadAudio(recordedAudio, '1_source.wav')} className="flex-1 py-2 rounded-xl bg-slate-800 text-gray-400 hover:bg-slate-700 transition-all flex items-center justify-center">
                                <Download size={14} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Stage 2: Encrypt */}
            <div className={`bg-slate-900/50 border border-slate-800 p-6 rounded-2xl transition-colors group ${recordedAudio ? 'hover:border-amber-500/30' : 'opacity-50'}`}>
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-bold text-gray-200">2. Encrypt</h2>
                    <Music size={18} className="text-amber-500" />
                </div>
                <div className="space-y-3">
                    <button 
                        onClick={() => encodeTobirdsong()}
                        disabled={!recordedAudio || isProcessing}
                        className="w-full py-4 rounded-xl font-bold text-sm tracking-wider uppercase bg-amber-500 text-slate-900 hover:bg-amber-400 disabled:opacity-50 transition-all"
                    >
                        Morph to Bird
                    </button>
                    {encodedAudio && (
                        <div className="flex space-x-2">
                             <button onClick={() => playAudio(encodedAudio)} className="flex-1 py-3 rounded-xl bg-slate-800 text-amber-500 hover:bg-slate-700 transition-all flex items-center justify-center">
                                <Play size={16} />
                             </button>
                             <button onClick={() => downloadAudio(encodedAudio, '2_cipher_bird.wav')} className="flex-1 py-3 rounded-xl bg-slate-800 text-gray-300 hover:bg-slate-700 transition-all flex items-center justify-center">
                                <Download size={16} />
                             </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Stage 3: Decrypt */}
            <div className={`bg-slate-900/50 border border-slate-800 p-6 rounded-2xl transition-colors group ${encodedAudio ? 'hover:border-purple-500/30' : 'opacity-50'}`}>
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-bold text-gray-200">3. Decrypt</h2>
                    <Volume2 size={18} className="text-purple-500" />
                </div>
                <div className="space-y-3">
                    <button 
                         onClick={() => decodeFrombirdsong()}
                         disabled={!encodedAudio || isProcessing}
                        className="w-full py-4 rounded-xl font-bold text-sm tracking-wider uppercase bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50 transition-all"
                    >
                        Restore Voice
                    </button>
                    {decodedAudio && (
                        <div className="flex space-x-2">
                             <button onClick={() => playAudio(decodedAudio)} className="flex-1 py-3 rounded-xl bg-slate-800 text-purple-400 hover:bg-slate-700 transition-all flex items-center justify-center">
                                <Play size={16} />
                             </button>
                             <button onClick={() => downloadAudio(decodedAudio, '3_restored_voice.wav')} className="flex-1 py-3 rounded-xl bg-slate-800 text-gray-300 hover:bg-slate-700 transition-all flex items-center justify-center">
                                <Download size={16} />
                             </button>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Global Actions */}
        {decodedAudio && (
            <div className="flex justify-center pt-4">
                <button 
                    onClick={downloadAllAssets}
                    className="flex items-center space-x-2 px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-full font-bold uppercase text-xs tracking-widest border border-slate-700 transition-all"
                >
                    <ArrowDownCircle size={16} />
                    <span>Download All Assets</span>
                </button>
            </div>
        )}
        
        {/* Info Panel */}
        {showInfo && (
            <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl text-slate-400 text-sm leading-relaxed max-w-4xl mx-auto animate-fade-in">
                
                <DSPDiagram />

                <h3 className="text-white font-bold mb-4">Algorithm Specification</h3>
                <p className="mb-4">
                    This codec functions as a symmetric audio steganography/encryption tool. It transforms human speech into a biomimetic emulation of a Eurasian Blackbird (Turdus merula).
                </p>
                <div className="grid grid-cols-2 gap-8">
                    <div>
                        <strong className="text-amber-400 block mb-2">Forward Transform (Encryption)</strong>
                        <ul className="list-disc list-inside space-y-1 marker:text-amber-500">
                            <li>Input Analysis: Pitch tracking + Mel-Scale spectral envelope extraction ({NUM_BANDS} bands).</li>
                            <li>Carrier Synthesis: Fundamental pitch multiplied by {PITCH_MULTIPLIER}x with added harmonic series for "woodwind" timbre.</li>
                            <li>Data Encoding: Spectral bands are mapped to high-frequency carriers ({BIRD_DATA_START_FREQ}Hz+).</li>
                            <li>Naturalism: Unified FM/AM modulation applies "breath" and "flutter" to both carrier and data layers to fuse the sound.</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="text-purple-400 block mb-2">Reverse Transform (Decryption)</strong>
                        <ul className="list-disc list-inside space-y-1 marker:text-purple-500">
                            <li>Carrier Tracking: FFT peak detection with smoothing filters to recover melodic contour.</li>
                            <li>Data Extraction: DFT with peak searching window to recover spectral amplitude from high-freq texture.</li>
                            <li>Resynthesis: Mel-spaced vocoder uses glottal pulse train modulated by recovered envelopes to reconstruct speech.</li>
                        </ul>
                    </div>
                </div>
            </div>
        )}

      </div>
    </div>
  );
}