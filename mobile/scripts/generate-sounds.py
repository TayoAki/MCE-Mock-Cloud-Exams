"""Synthesizes the app's sound effects into assets/sounds (original tones, no samples).

Run with: python3 scripts/generate-sounds.py
"""
import math
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'sounds'


def note(freq, start, length, decay, harmonics=(1.0, 0.3, 0.1), attack=0.005, sweep_to=None):
    """One plucked tone as (start, samples), with an exponential decay."""
    n = int(length * RATE)
    out = []
    phase = [0.0] * len(harmonics)
    for i in range(n):
        t = i / RATE
        f = freq if sweep_to is None else freq + (sweep_to - freq) * min(1.0, t / length)
        env = min(1.0, t / attack) * math.exp(-t / decay)
        s = 0.0
        for h, amp in enumerate(harmonics, start=1):
            phase[h - 1] += 2 * math.pi * f * h / RATE
            s += amp * math.sin(phase[h - 1])
        out.append(s * env)
    return start, out


def render(name, notes, peak):
    total = max(int(start * RATE) + len(samples) for start, samples in notes)
    mix = [0.0] * total
    for start, samples in notes:
        offset = int(start * RATE)
        for i, s in enumerate(samples):
            mix[offset + i] += s
    top = max(abs(s) for s in mix) or 1.0
    fade = int(0.01 * RATE)
    with wave.open(str(OUT / f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        frames = bytearray()
        for i, s in enumerate(mix):
            gain = min(1.0, (total - i) / fade)
            frames += struct.pack('<h', int(s / top * peak * gain * 32767))
        w.writeframes(bytes(frames))


OUT.mkdir(parents=True, exist_ok=True)
# A bright rising fifth.
render('correct', [note(1046.5, 0.0, 0.25, 0.08), note(1568.0, 0.08, 0.37, 0.12)], peak=0.5)
# Soft and low, never a buzzer: a wrong answer is part of learning.
render('wrong', [note(392.0, 0.0, 0.3, 0.1, harmonics=(1.0, 0.15), attack=0.012), note(329.6, 0.11, 0.32, 0.13, harmonics=(1.0, 0.15), attack=0.012)], peak=0.32)
# Quick sparkle for answers in a row.
render('combo', [note(f, i * 0.045, 0.3, 0.07, harmonics=(1.0, 0.2)) for i, f in enumerate((1046.5, 1318.5, 1568.0, 2093.0))], peak=0.45)
# Lesson complete: an arpeggio into a held major chord with a soft shimmer.
fanfare = [note(f, i * 0.09, 0.35, 0.12) for i, f in enumerate((523.3, 659.3, 784.0))]
fanfare += [note(f, 0.27, 1.0, 0.35, harmonics=(1.0, 0.25, 0.08)) for f in (523.3, 659.3, 784.0, 1046.5)]
fanfare += [note(2093.0, 0.33, 0.6, 0.18, harmonics=(1.0,)), note(2637.0, 0.42, 0.5, 0.15, harmonics=(1.0,))]
render('complete', fanfare, peak=0.55)
# A small upward pop when the next lesson unlocks.
render('unlock', [note(660.0, 0.0, 0.14, 0.05, harmonics=(1.0, 0.2), sweep_to=1320.0), note(1760.0, 0.06, 0.2, 0.06, harmonics=(1.0,))], peak=0.4)
print('wrote', sorted(p.name for p in OUT.glob('*.wav')))
