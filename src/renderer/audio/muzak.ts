// Procedurally generated "classic elevator" bossa nova. Generated live in the browser, so it's
// copyright-free by construction and never repeats exactly.

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

// 8-bar loop: Fmaj7 | Em7 A7 | Dm9 | G13 | Cmaj7 | Am7 | Dm7 G7 | Cmaj9
const BARS: { chords: { root: number; tones: number[]; beats: number }[] }[] = [
  { chords: [{ root: 41, tones: [57, 60, 64, 69], beats: 4 }] },
  { chords: [{ root: 40, tones: [55, 59, 62, 67], beats: 2 }, { root: 45, tones: [55, 61, 64, 67], beats: 2 }] },
  { chords: [{ root: 38, tones: [53, 57, 60, 64], beats: 4 }] },
  { chords: [{ root: 43, tones: [53, 59, 64, 69], beats: 4 }] },
  { chords: [{ root: 36, tones: [52, 55, 59, 64], beats: 4 }] },
  { chords: [{ root: 45, tones: [55, 60, 64, 67], beats: 4 }] },
  { chords: [{ root: 38, tones: [53, 57, 60, 65], beats: 2 }, { root: 43, tones: [53, 59, 62, 65], beats: 2 }] },
  { chords: [{ root: 36, tones: [52, 55, 59, 62], beats: 4 }] }
]
const SCALE = [60, 62, 64, 67, 69, 72, 74, 76, 79] // C major pentatonic-ish for the vibraphone

export class Muzak {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private bus!: GainNode
  private reverb!: ConvolverNode
  private timer: number | null = null
  private nextBarTime = 0
  private bar = 0
  private volume = 0.35
  playing = false
  private readonly beat = 60 / 96

  private ensure() {
    if (this.ctx) return this.ctx
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(ctx.destination)
    this.bus = ctx.createGain()
    this.bus.gain.value = 0.9
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this.impulse(2.6)
    const wet = ctx.createGain()
    wet.gain.value = 0.32
    this.bus.connect(this.master)
    this.bus.connect(this.reverb)
    this.reverb.connect(wet)
    wet.connect(this.master)
    return ctx
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
    }
    return buf
  }

  setVolume(v: number) {
    this.volume = v
    if (this.ctx && this.playing) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3)
  }

  async start() {
    const ctx = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    if (this.playing) return
    this.playing = true
    this.master.gain.cancelScheduledValues(ctx.currentTime)
    this.master.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.8)
    this.nextBarTime = ctx.currentTime + 0.1
    this.timer = window.setInterval(() => this.schedule(), 120)
    this.schedule()
  }

  stop() {
    if (!this.ctx || !this.playing) return
    this.playing = false
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4)
    if (this.timer) window.clearInterval(this.timer)
    this.timer = null
  }

  private schedule() {
    const ctx = this.ctx!
    while (this.nextBarTime < ctx.currentTime + 1.2) {
      this.playBar(this.bar % BARS.length, this.nextBarTime)
      this.nextBarTime += 4 * this.beat
      this.bar++
    }
  }

  private playBar(i: number, t0: number) {
    const b = this.beat
    let t = t0
    for (const ch of BARS[i].chords) {
      // Bossa bass: root, fifth on the "and" of 2.
      this.bass(ch.root, t, b * 1.4)
      this.bass(ch.root + 7, t + b * 1.5, b * 0.45)
      if (ch.beats === 4) {
        this.bass(ch.root, t + b * 2, b * 1.4)
        this.bass(ch.root + 7, t + b * 3.5, b * 0.45)
      }
      // Electric piano comping (syncopated).
      const hits = ch.beats === 4 ? [0, 1.5, 2.5, 3.5] : [0, 1.5]
      for (const h of hits) this.epiano(ch.tones, t + h * b, b * (h === 0 ? 1.3 : 0.7), h === 0 ? 0.11 : 0.07)
      t += ch.beats * b
    }
    // Brushes / shaker on eighths.
    for (let k = 0; k < 8; k++) this.shaker(t0 + k * b * 0.5, k % 2 === 0 ? 0.035 : 0.02)
    // Vibraphone melody: sparse, gentle phrases on alternating bars.
    if (i % 2 === 0 || Math.random() < 0.35) {
      const rhythm = [0, 1, 1.5, 2.5, 3][Math.floor(Math.random() * 3)]
      let pos = rhythm
      let idx = Math.floor(Math.random() * SCALE.length)
      while (pos < 4) {
        idx = Math.max(0, Math.min(SCALE.length - 1, idx + [-2, -1, 1, 2][Math.floor(Math.random() * 4)]))
        const dur = [0.5, 1, 1.5][Math.floor(Math.random() * 3)]
        this.vibes(SCALE[idx] + 12, t0 + pos * b, dur * b * 1.6)
        pos += dur + (Math.random() < 0.3 ? 0.5 : 0)
      }
    }
  }

  private env(g: GainNode, t: number, peak: number, attack: number, dur: number, release: number) {
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.setTargetAtTime(peak * 0.55, t + attack, dur * 0.35)
    g.gain.setTargetAtTime(0, t + dur, release)
  }

  private epiano(notes: number[], t: number, dur: number, vol: number) {
    const ctx = this.ctx!
    const g = ctx.createGain()
    const trem = ctx.createOscillator()
    const tremGain = ctx.createGain()
    trem.frequency.value = 4.5
    tremGain.gain.value = vol * 0.25
    trem.connect(tremGain)
    tremGain.connect(g.gain)
    this.env(g, t, vol, 0.012, dur, 0.25)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    g.connect(lp)
    lp.connect(this.bus)
    for (const n of notes) {
      const o1 = ctx.createOscillator()
      o1.type = 'sine'
      o1.frequency.value = midi(n)
      const o2 = ctx.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = midi(n) * 2.001
      const g2 = ctx.createGain()
      g2.gain.value = 0.18
      o1.connect(g)
      o2.connect(g2)
      g2.connect(g)
      o1.start(t)
      o2.start(t)
      o1.stop(t + dur + 1.2)
      o2.stop(t + dur + 1.2)
    }
    trem.start(t)
    trem.stop(t + dur + 1.2)
  }

  private bass(n: number, t: number, dur: number) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = midi(n)
    const g = ctx.createGain()
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 600
    this.env(g, t, 0.22, 0.01, dur, 0.08)
    o.connect(lp)
    lp.connect(g)
    g.connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.6)
  }

  private vibes(n: number, t: number, dur: number) {
    const ctx = this.ctx!
    const g = ctx.createGain()
    this.env(g, t, 0.06, 0.005, dur, 0.6)
    const trem = ctx.createOscillator()
    const tg = ctx.createGain()
    trem.frequency.value = 5.5
    tg.gain.value = 0.02
    trem.connect(tg)
    tg.connect(g.gain)
    for (const [mult, amp] of [
      [1, 1],
      [4, 0.12],
      [10, 0.03]
    ]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = midi(n) * mult
      const og = ctx.createGain()
      og.gain.value = amp
      o.connect(og)
      og.connect(g)
      o.start(t)
      o.stop(t + dur + 2)
    }
    trem.start(t)
    trem.stop(t + dur + 2)
    g.connect(this.bus)
  }

  private shaker(t: number, vol: number) {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * 0.06)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 6000
    const g = ctx.createGain()
    g.gain.value = vol
    src.connect(hp)
    hp.connect(g)
    g.connect(this.bus)
    src.start(t)
  }

  /** The elevator arrival chime. Plays even when music is muted if sfx is on. */
  async ding(volume = 0.35) {
    const ctx = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    const t = ctx.currentTime + 0.02
    for (const [note, offset] of [
      [88, 0],
      [84, 0.32]
    ]) {
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t + offset)
      g.gain.linearRampToValueAtTime(volume * 0.5, t + offset + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 1.8)
      g.connect(ctx.destination)
      for (const [mult, amp] of [
        [1, 1],
        [2.76, 0.3],
        [5.4, 0.1]
      ]) {
        const o = ctx.createOscillator()
        o.frequency.value = midi(note) * mult
        const og = ctx.createGain()
        og.gain.value = amp
        o.connect(og)
        og.connect(g)
        o.start(t + offset)
        o.stop(t + offset + 2)
      }
    }
  }
}

export const muzak = new Muzak()
