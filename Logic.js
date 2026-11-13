.pragma library
// Night Raid rules engine. Pure JS, no QML: BarWidget.qml owns timers and
// rendering and calls in here; test/logic.test.js runs it under node.
//
// The display is 10 columns x 3 lanes. Column 0 holds the three cities (one
// per lane), column 1 is the launcher's track, and raiders fly in from the
// right edge (column 9) toward the cities. Shells fly right from column 2.
//
// Every mutating call may push events onto s.events ({ sound, code, label }):
// the host drains them to play sounds and flash readout messages.

var COLS = 10
var LANES = 3
var CITY_X = 0
var LAUNCHER_X = 1
var SPAWN_X = COLS - 1
var MAX_SHELLS = 2
var RELOAD_MS = 500         // time between shots
var SHELL_TICK_MS = 70      // the host runs shellTick at this rate
var STUN_TICKS = 3          // raider ticks the launcher is knocked out after a hit
var CITY_BONUS = 50
var MEGA_BOMBS = 3          // per game: each one clears every raider on screen

// Mutable so tests can make waves deterministic.
var random = Math.random

function rint(lo, hi) { return lo + Math.floor(random() * (hi - lo + 1)) }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function emit(s, sound, code, label) {
  s.events.push({ sound: sound || "", code: code || "", label: label || "" })
}

function newGame(pro, high) {
  var s = {
    pro: pro === 2 ? 2 : 1,
    wave: 1,
    score: 0,
    high: high || 0,
    phase: "ready",        // ready | live | dead (between waves) | gameover
    launcher: 1,           // lane
    stun: 0,
    cities: [true, true, true],
    raiders: [],           // { x, lane, hp, fast, hit }
    shells: [],            // { x, lane }
    blasts: [],            // { x, lane, ttl } explosion flashes, in shell ticks
    toSpawn: 0,
    cooldown: 0,
    hits: 0,               // raider hits so far; drives the explosion LED
    bombs: MEGA_BOMBS,
    reload: 0,             // ms until the launcher can fire again
    events: []
  }
  setupWave(s, 1)
  return s
}

// ---------------------------------------------------------------- waves

function waveSize(wave) { return 6 + wave * 3 }

function setupWave(s, wave) {
  s.wave = wave
  s.phase = "ready"
  s.raiders = []
  s.shells = []
  s.blasts = []
  s.stun = 0
  s.reload = 0
  s.toSpawn = waveSize(wave)
  s.cooldown = 1
}

// Raider tick length in ms: waves get faster, Pro 2 starts faster.
function raiderInterval(s) {
  var base = s.pro === 2 ? 640 : 880
  return Math.max(s.pro === 2 ? 240 : 340, base - (s.wave - 1) * 60)
}

function citiesLeft(s) { return s.cities.filter(function(c) { return c }).length }

// ---------------------------------------------------------------- queries

function raiderAt(s, x, lane) {
  for (var i = 0; i < s.raiders.length; i++) {
    var r = s.raiders[i]
    if (!r.gone && r.x === x && r.lane === lane) return i
  }
  return -1
}

// Destroyed raiders are only marked during a step, then cleared out here, so
// loops over the raider list never skip anyone.
function prune(s) { s.raiders = s.raiders.filter(function(r) { return !r.gone }) }

function canFire(s) {
  return (s.phase === "live" || s.phase === "ready") && s.stun === 0 && s.reload <= 0
    && s.shells.length < MAX_SHELLS
}

// ---------------------------------------------------------------- actions

function start(s) {
  if (s.phase !== "ready") return false
  s.phase = "live"
  emit(s, "siren", "", "WAVE " + s.wave + " - INCOMING")
  return true
}

// dl: -1 up, +1 down. The launcher only slides between lanes. Between waves
// a move also starts the next wave.
function move(s, dl) {
  if (s.phase === "dead") nextWave(s)
  if (s.phase === "ready") start(s)
  if (s.phase !== "live" || s.stun > 0) return
  var nl = clamp(s.launcher + dl, 0, LANES - 1)
  if (nl === s.launcher) return
  s.launcher = nl
  // Sliding into a raider that's sitting on your track knocks you out.
  var r = raiderAt(s, LAUNCHER_X, nl)
  if (r >= 0) { launcherHit(s, r); prune(s); return }
  emit(s, "step")
}

function fire(s) {
  if (s.phase === "ready") start(s)
  if (!canFire(s)) { if (s.phase === "live" && s.stun === 0) emit(s, "click"); return false }
  var shell = { x: LAUNCHER_X + 1, lane: s.launcher }
  s.reload = RELOAD_MS
  emit(s, "fire")
  // Point blank: a raider right in front of the launcher is hit immediately.
  var r = raiderAt(s, shell.x, shell.lane)
  if (r >= 0) { hit(s, r); prune(s); checkWaveOver(s); return true }
  s.shells.push(shell)
  return true
}

// ---------------------------------------------------------------- ticks

// Shells fly fast: one column per shell tick.
function shellTick(s) {
  for (var b = s.blasts.length - 1; b >= 0; b--) if (--s.blasts[b].ttl <= 0) s.blasts.splice(b, 1)
  if (s.phase !== "live") return
  // Reloading: ready once less than half a tick is left.
  if (s.reload > 0) s.reload = s.reload - SHELL_TICK_MS < SHELL_TICK_MS / 2 ? 0 : s.reload - SHELL_TICK_MS
  for (var i = s.shells.length - 1; i >= 0; i--) {
    var sh = s.shells[i]
    sh.x += 1
    var r = raiderAt(s, sh.x, sh.lane)
    if (r >= 0) { s.shells.splice(i, 1); hit(s, r); continue }
    if (sh.x >= COLS) s.shells.splice(i, 1)
  }
  prune(s)
  checkWaveOver(s)
}

// Raiders advance one column per raider tick (fast ones two), and new ones
// appear at the right edge.
function raiderTick(s) {
  if (s.phase !== "live") return
  if (s.stun > 0) s.stun -= 1
  // Leftmost first so a raider never steps onto one that hasn't moved yet.
  s.raiders.sort(function(a, b) { return a.x - b.x })
  for (var i = 0; i < s.raiders.length; i++) {
    var rd = s.raiders[i]
    var steps = rd.fast ? 2 : 1
    for (var k = 0; k < steps && !rd.gone; k++) stepRaider(s, rd)
    if (s.phase !== "live") break
  }
  prune(s)
  if (s.phase !== "live") return
  spawn(s)
  checkWaveOver(s)
}

// Chance a raider veers into a neighboring lane on a step; later waves jink more.
function jinkChance(s) { return Math.min(0.25, 0.06 + 0.025 * s.wave) }

function stepRaider(s, rd) {
  var nx = rd.x - 1
  // Now and then a raider veers diagonally into a neighboring free lane.
  var nl = rd.lane
  if (nx > CITY_X && random() < jinkChance(s)) {
    var choices = [rd.lane - 1, rd.lane + 1].filter(function(l) {
      return l >= 0 && l < LANES && raiderAt(s, nx, l) < 0 && raiderAt(s, rd.x, l) < 0
    })
    if (choices.length) nl = choices[rint(0, choices.length - 1)]
  }
  // Flying into a shell (in the lane it's leaving or the one it's entering):
  // the shell scores the hit.
  for (var j = 0; j < s.shells.length; j++) {
    var sh = s.shells[j]
    var meets = (sh.lane === rd.lane && (sh.x === nx || sh.x === rd.x)) || (sh.lane === nl && sh.x === nx)
    if (meets) {
      s.shells.splice(j, 1)
      hit(s, s.raiders.indexOf(rd))
      if (rd.gone) return
      break
    }
  }
  // Blocked by another raider: hold position.
  if (raiderAt(s, nx, nl) >= 0) return
  rd.x = nx
  rd.lane = nl
  if (rd.x === LAUNCHER_X && rd.lane === s.launcher) { launcherHit(s, s.raiders.indexOf(rd)); return }
  if (rd.x <= CITY_X) {
    rd.gone = true
    if (s.cities[rd.lane]) {
      s.cities[rd.lane] = false
      blast(s, CITY_X, rd.lane)
      if (citiesLeft(s) === 0) { gameOver(s); return }
      emit(s, "city", "", "CITY LOST - " + citiesLeft(s) + " LEFT")
    }
  }
}

function spawn(s) {
  if (s.toSpawn <= 0) return
  if (--s.cooldown > 0) return
  var lanes = [0, 1, 2].filter(function(l) { return raiderAt(s, SPAWN_X, l) < 0 && raiderAt(s, SPAWN_X - 1, l) < 0 })
  if (!lanes.length) { s.cooldown = 1; return }
  var lane = lanes[rint(0, lanes.length - 1)]
  var w = s.wave
  var armored = w >= 2 && random() < Math.min(0.35, 0.1 + 0.05 * w)
  var fast = !armored && w >= 3 && random() < Math.min(0.3, 0.05 * w)
  s.raiders.push({ x: SPAWN_X, lane: lane, hp: armored ? 2 : 1, fast: fast, armored: armored })
  s.toSpawn -= 1
  // Gaps between raiders shrink as the waves go on.
  s.cooldown = rint(1, Math.max(1, 4 - Math.floor(w / 2)))
  emit(s, "ping")
}

// ---------------------------------------------------------------- outcomes

function blast(s, x, lane, ttl) { s.blasts.push({ x: x, lane: lane, ttl: ttl || 4 }) }

// Mega bomb: every raider on screen is destroyed at once (armor and all) and
// scores as usual. Three per game, so save them for when you're swamped.
function megaBomb(s) {
  if (s.phase === "ready") start(s)
  if (s.phase !== "live") return false
  if (s.bombs <= 0) { emit(s, "click", "", "NO MEGA BOMBS LEFT"); return false }
  s.bombs -= 1
  var downed = 0
  for (var i = 0; i < s.raiders.length; i++) {
    var rd = s.raiders[i]
    if (rd.gone) continue
    rd.gone = true
    downed += 1
    s.score += (rd.fast ? 20 : rd.armored ? 30 : 10) * s.wave
    blast(s, rd.x, rd.lane, 9)
  }
  s.hits += 1
  prune(s)
  emit(s, "megabomb", "bAnG", "MEGA BOMB - " + downed + " DOWN, " + s.bombs + " LEFT")
  checkWaveOver(s)
  return true
}

function hit(s, idx) {
  var rd = s.raiders[idx]
  if (!rd || rd.gone) return
  rd.hp -= 1
  s.hits += 1   // the host lights the explosion LED whenever this changes
  if (rd.hp > 0) { rd.hit = true; emit(s, "clang", "", "ARMORED - HIT IT AGAIN"); return }
  rd.gone = true
  var pts = (rd.fast ? 20 : rd.armored ? 30 : 10) * s.wave
  s.score += pts
  blast(s, rd.x, rd.lane)
  emit(s, "boom")
}

function launcherHit(s, idx) {
  var rd = s.raiders[idx]
  if (rd) rd.gone = true
  blast(s, LAUNCHER_X, s.launcher)
  s.stun = STUN_TICKS
  s.shells = []
  emit(s, "hurt", "", "LAUNCHER HIT")
}

function checkWaveOver(s) {
  if (s.phase !== "live" || s.toSpawn > 0 || s.raiders.some(function(r) { return !r.gone })) return
  var bonus = citiesLeft(s) * CITY_BONUS * s.wave
  s.score += bonus
  s.phase = "dead"
  s.shells = []
  s.high = Math.max(s.high, s.score)
  emit(s, "clear", "CLr ", "WAVE " + s.wave + " CLEARED - CITY BONUS " + bonus)
}

function gameOver(s) {
  s.phase = "gameover"
  s.shells = []
  s.high = Math.max(s.high, s.score)
  emit(s, "gameover", "End ", "THE LIGHTS ARE OUT - GAME OVER")
}

// Called when the player presses STATUS between waves.
function nextWave(s) {
  if (s.phase !== "dead") return false
  setupWave(s, s.wave + 1)
  emit(s, "blip", "", "WAVE " + s.wave + " - MOVE OR FIRE TO START")
  return true
}

// ---------------------------------------------------------------- display

// LED levels for the 3x10 display, row-major:
// 0 off, 1 raider, 2 armored raider, 3 launcher, 4 shell, 5 blast, 6 city.
function leds(s, blink) {
  var out = []
  for (var i = 0; i < COLS * LANES; i++) out.push(0)
  function put(x, lane, level) {
    if (x < 0 || x >= COLS || lane < 0 || lane >= LANES) return
    out[lane * COLS + x] = Math.max(out[lane * COLS + x], level)
  }
  for (var c = 0; c < LANES; c++) if (s.cities[c]) put(CITY_X, c, 6)
  for (var k = 0; k < s.raiders.length; k++) {
    var r = s.raiders[k]
    // Fast raiders and wounded armor flicker.
    if ((r.fast || r.hit) && blink % 2 === 1) continue
    put(r.x, r.lane, r.armored ? 2 : 1)
  }
  if (s.phase !== "gameover" && !(s.stun > 0 && blink % 2 === 1)) {
    var waiting = s.phase === "ready" || s.phase === "dead"
    if (!(waiting && blink % 4 === 3)) put(LAUNCHER_X, s.launcher, 3)
  }
  for (var j = 0; j < s.shells.length; j++) put(s.shells[j].x, s.shells[j].lane, 4)
  for (var b = 0; b < s.blasts.length; b++) put(s.blasts[b].x, s.blasts[b].lane, 5)
  return out
}
