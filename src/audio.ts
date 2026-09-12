export class Sound {
  context?: AudioContext;
  muted = false;
  unlock() { try { this.context ??= new AudioContext(); void this.context.resume().catch(() => {}); } catch {} }
  play(event: 'jump' | 'coin' | 'crash') {
    if (this.muted || !this.context) return;
    const c = this.context, o = c.createOscillator(), gain = c.createGain();
    const duration = event === 'crash' ? .35 : .12;
    o.type = event === 'crash' ? 'sawtooth' : 'sine';
    o.frequency.setValueAtTime(event === 'coin' ? 1000 : event === 'jump' ? 240 : 130, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(event === 'coin' ? 1700 : event === 'jump' ? 480 : 35, c.currentTime + duration);
    gain.gain.setValueAtTime(.06, c.currentTime); gain.gain.exponentialRampToValueAtTime(.001, c.currentTime + duration);
    o.connect(gain).connect(c.destination); o.start(); o.stop(c.currentTime + duration);
  }
}
