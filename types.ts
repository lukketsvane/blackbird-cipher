export interface FrameAnalysis {
  bandEnergies: Float32Array;
  pitch: number;
  amplitude: number;
}

export type ProcessingMode = 'idle' | 'recording';

export interface DecodedFrame {
  bandEnergies: Float32Array;
  pitch: number;
  amplitude: number;
}