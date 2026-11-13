#!/usr/bin/env python3
"""Synthesize Night Raid's piezo-style sound effects into ../sounds/*.wav.

Handheld LED games of the late '70s had a single piezo buzzer driven by a
square wave, so every effect here is a sequence of square-wave tones (with an
optional pitch sweep and vibrato). Run it after changing a recipe:

    python3 tools/gen_sounds.py
"""
import math
import os
import random
import struct
import wave

RATE = 22050
VOLUME = 0.32
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sounds")


def tone(freq, ms, end=None, vibrato=0.0, vib_rate=0.0, duty=0.5, noise=0.0):
    """One square-wave note. `end` sweeps the pitch linearly to that frequency."""
    n = int(RATE * ms / 1000)
    end = freq if end is None else end
    out, phase = [], 0.0
    for i in range(n):
        t = i / RATE
        f = freq + (end - freq) * (i / max(1, n - 1))
        if vibrato:
            f *= 1 + vibrato * math.sin(2 * math.pi * vib_rate * t)
        phase = (phase + f / RATE) % 1.0
        s = 1.0 if phase < duty else -1.0
        if noise:
            s = s * (1 - noise) + random.uniform(-1, 1) * noise
        # 3 ms attack/release so notes click like a buzzer, not like a pop.
        edge = min(1.0, i / (RATE * 0.003), (n - i) / (RATE * 0.003))
        out.append(s * edge)
    return out


def rest(ms):
    return [0.0] * int(RATE * ms / 1000)


def write(name, *parts):
    # Lead-in and tail silence: DSP sinks (e.g. the Apple Silicon speaker
    # convolver, ~170 ms of latency) drop a stream's last samples when the
    # stream disconnects, which swallows short beeps entirely.
    samples = rest(30) + [s for part in parts for s in part] + rest(260)
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * VOLUME * 32767)) for s in samples))


def main():
    random.seed(23)
    os.makedirs(OUT, exist_ok=True)
    # Launcher sliding between lanes.
    write("step", tone(1400, 14, duty=0.3))
    # Fire: a falling "pew".
    write("fire", tone(1900, 110, 700, duty=0.35))
    # Empty: out of shells.
    write("click", tone(300, 18, noise=0.4))
    # Explosion: a burst of noise falling in pitch.
    write("boom", tone(240, 260, 60, noise=0.85, duty=0.4))
    # Mega bomb: a rising whistle, then a long rolling rumble.
    write("megabomb", tone(600, 260, 2200, duty=0.3), tone(260, 500, 70, noise=0.9, duty=0.4),
          tone(90, 900, 45, noise=0.8, duty=0.5, vibrato=0.2, vib_rate=9))
    # Armored raider dented: a metallic clang.
    write("clang", tone(880, 40), tone(1320, 40), tone(990, 80, 940, vibrato=0.05, vib_rate=40))
    # Launcher knocked out: an angry buzz.
    write("hurt", tone(160, 380, 110, vibrato=0.15, vib_rate=22, noise=0.3))
    # City lost: a slow, sad descent.
    write("city", tone(660, 160), tone(523, 160), tone(392, 160), tone(262, 420, 240, vibrato=0.05, vib_rate=6))
    # Radar ping when a raider appears.
    write("ping", tone(1760, 60, 1700, duty=0.25))
    # Air-raid siren: two rising-and-falling wails.
    write("siren", *[p for _ in range(2) for p in (tone(380, 600, 900, duty=0.5), tone(900, 600, 380, duty=0.5))])
    # Wave cleared: a bright little fanfare.
    write("clear", *[p for f in (523, 659, 784, 1047, 784, 1047) for p in (tone(f, 90), rest(20))], tone(1319, 300))
    # Game over: the lights go out.
    final = [(784, 220), (659, 220), (523, 220), (392, 220), (330, 220), (262, 700)]
    write("gameover", *[p for f, ms in final for p in (tone(f, ms), rest(40))])
    # UI blip for status/score/menu keys.
    write("blip", tone(2000, 22, duty=0.25))


if __name__ == "__main__":
    main()
