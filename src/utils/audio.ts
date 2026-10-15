export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Generate stylized waveform values for audio bars
export function generateWaveform(sampleCount = 28): number[] {
  const bars: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    // Generate organic wave pattern
    const val = Math.floor(20 + Math.sin(i * 0.4) * 35 + Math.random() * 45);
    bars.push(Math.max(15, Math.min(100, val)));
  }
  return bars;
}

// Format duration in seconds to mm:ss
export function formatAudioDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
