export class Sound {
  context?: AudioContext;
  muted = false;
  unlock() { try { this.context ??= new AudioContext(); void this.context.resume().catch(() => {}); } catch {} }
  play(event: 'jump' | 'coin' | 'bonk' | 'crash') {
    if (this.muted || !this.context) return;
    const c = this.context, o = c.createOscillator(), gain = c.createGain();
    const duration = event === 'crash' ? .35 : event === 'bonk' ? .2 : .12;
    o.type = event === 'crash' || event === 'bonk' ? 'sawtooth' : 'sine';
    o.frequency.setValueAtTime(event === 'coin' ? 1000 : event === 'jump' ? 240 : event === 'bonk' ? 190 : 130, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(event === 'coin' ? 1700 : event === 'jump' ? 480 : event === 'bonk' ? 90 : 35, c.currentTime + duration);
    gain.gain.setValueAtTime(.06, c.currentTime); gain.gain.exponentialRampToValueAtTime(.001, c.currentTime + duration);
    o.connect(gain).connect(c.destination); o.start(); o.stop(c.currentTime + duration);
  }
}
