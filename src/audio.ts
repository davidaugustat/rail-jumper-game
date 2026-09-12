export class Sound {
  context?: AudioContext;
  muted = false;
  unlock() {
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch {
      // Audio is unavailable in some browser contexts.
    }
  }
  play(event: 'jump' | 'coin' | 'bonk' | 'crash') {
    if (this.muted || !this.context) return;
    const c = this.context,
      o = c.createOscillator(),
      gain = c.createGain();
    const duration = event === 'crash' ? 0.35 : event === 'bonk' ? 0.2 : 0.12;
    o.type = event === 'crash' || event === 'bonk' ? 'sawtooth' : 'sine';
    o.frequency.setValueAtTime(
      event === 'coin' ? 1000 : event === 'jump' ? 240 : event === 'bonk' ? 190 : 130,
      c.currentTime,
    );
    o.frequency.exponentialRampToValueAtTime(
      event === 'coin' ? 1700 : event === 'jump' ? 480 : event === 'bonk' ? 90 : 35,
      c.currentTime + duration,
    );
    gain.gain.setValueAtTime(0.06, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    o.connect(gain).connect(c.destination);
    o.start();
    o.stop(c.currentTime + duration);
  }
}
