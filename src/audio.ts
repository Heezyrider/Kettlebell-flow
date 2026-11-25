/** Beeps (Web Audio) and spoken announcements (speechSynthesis). */
let ctx: AudioContext | null = null;

export const audioPrefs = { beep: true, voice: true };

/**
 * Must be called from a user gesture (the Start button): mobile browsers only
 * allow audio and speech that was first triggered by a tap.
 */
export function unlockAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx && AC) ctx = new AC();
    void ctx?.resume();
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch {
    /* audio is a nice-to-have */
  }
}

export function beep(freq = 880, ms = 120, volume = 0.5): void {
  if (!audioPrefs.beep || !ctx) return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  } catch {
    /* ignore */
  }
}

export const repBeep = (): void => beep(880, 110);
export const tickBeep = (): void => beep(520, 90, 0.35);
export const goBeep = (): void => beep(1175, 350);
export function doneBeep(): void {
  beep(988, 120);
  setTimeout(() => beep(1319, 260), 140);
}

export function speak(text: string): void {
  if (!audioPrefs.voice || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

export function stopSpeaking(): void {
  try {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
