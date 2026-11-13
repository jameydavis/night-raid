// Run: node test/logic.test.js
// Loads Logic.js (a QML `.pragma library` file) into node and exercises the rules.
const fs = require("fs")
const path = require("path")
const assert = require("assert")

function load() {
  const src = fs.readFileSync(path.join(__dirname, "..", "Logic.js"), "utf8").replace(/^\.pragma library/m, "")
  const names = ["newGame", "move", "fire", "shellTick", "raiderTick", "nextWave", "leds", "citiesLeft",
    "canFire", "RELOAD_MS", "SHELL_TICK_MS", "jinkChance", "megaBomb", "MEGA_BOMBS", "LAUNCHER_LIVES", "waveSize", "raiderInterval", "MAX_SHELLS", "STUN_TICKS", "CITY_BONUS"]
  return new Function(src + "\nreturn {" + names.join(",") + ", setRandom: function(f) { random = f } }")()
}

let passed = 0
function test(name, fn) {
  const L = load()
  try { fn(L); passed++; console.log("ok   " + name) }
  catch (e) { console.log("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); process.exitCode = 1 }
}

function rows(L, s) {
  const m = L.leds(s, 0)
  return [0, 1, 2].map(r => m.slice(r * 10, r * 10 + 10).map(v => ".rRL*#C"[v]).join(""))
}

// A live game with no more raiders coming unless the test adds them.
function live(L, raiders) {
  L.setRandom(() => 0.99) // no lane changes unless a test asks for them
  const s = L.newGame(1)
  s.phase = "live"
  s.toSpawn = 0
  s.raiders = raiders || []
  s.events = []
  return s
}

test("start: three cities on the left, the launcher in the middle lane, nothing in the sky", L => {
  const s = L.newGame(1)
  assert.strictEqual(s.phase, "ready")
  assert.deepStrictEqual(rows(L, s), ["C.........", "CL........", "C........."])
  assert.strictEqual(s.toSpawn, L.waveSize(1))
})

test("moving or firing starts the wave; the launcher slides between lanes only", L => {
  const s = L.newGame(1)
  L.move(s, -1)
  assert.strictEqual(s.phase, "live")
  assert.strictEqual(s.launcher, 0)
  L.move(s, -1)
  assert.strictEqual(s.launcher, 0, "top edge")
  L.move(s, 1); L.move(s, 1); L.move(s, 1)
  assert.strictEqual(s.launcher, 2)
})

test("a shell flies down the lane and destroys the first raider it meets", L => {
  const s = live(L, [{ x: 6, lane: 1, hp: 1 }, { x: 8, lane: 1, hp: 1 }])
  L.fire(s)
  for (let i = 0; i < 6; i++) L.shellTick(s)
  assert.strictEqual(s.raiders.length, 1)
  assert.strictEqual(s.raiders[0].x, 8)
  assert.strictEqual(s.score, 10)
  assert.ok(s.events.some(e => e.sound === "boom"))
})

test("armored raiders take two hits and are worth more", L => {
  const s = live(L, [{ x: 5, lane: 1, hp: 2, armored: true }, { x: 9, lane: 0, hp: 1 }])
  L.fire(s)
  for (let i = 0; i < Math.round(L.RELOAD_MS / L.SHELL_TICK_MS); i++) L.shellTick(s) // hit, then reload
  assert.strictEqual(s.raiders.length, 2, "first hit only dents it")
  assert.ok(s.events.some(e => e.sound === "clang"))
  L.fire(s)
  for (let i = 0; i < 5; i++) L.shellTick(s)
  assert.strictEqual(s.raiders.length, 1)
  assert.strictEqual(s.score, 30)
})

test("the launcher reloads between shots", L => {
  const s = live(L, [{ x: 9, lane: 0, hp: 1 }])
  assert.ok(L.fire(s))
  assert.ok(!L.fire(s), "can't fire again right away")
  assert.ok(!L.canFire(s))
  const ticks = Math.round(L.RELOAD_MS / L.SHELL_TICK_MS)
  for (let i = 0; i < ticks - 1; i++) L.shellTick(s)
  assert.ok(!L.canFire(s), "still reloading just before the reload time")
  L.shellTick(s)
  assert.ok(L.canFire(s), "ready after about " + L.RELOAD_MS + " ms (" + ticks * L.SHELL_TICK_MS + " ms)")
  assert.ok(L.fire(s))
  for (let i = 0; i < 12; i++) L.shellTick(s)
  assert.strictEqual(s.shells.length, 0, "missed shells fly off the right edge")
})

test("a raider reaching the left edge blacks out that lane's city", L => {
  const s = live(L, [{ x: 2, lane: 0, hp: 1 }, { x: 9, lane: 2, hp: 1 }])
  L.raiderTick(s) // to column 1 (the launcher is in lane 1, so it passes)
  L.raiderTick(s) // into the city
  assert.deepStrictEqual(s.cities, [false, true, true])
  assert.strictEqual(L.citiesLeft(s), 2)
  assert.ok(s.events.some(e => e.sound === "city"))
})

test("flying into the launcher knocks it out for a moment", L => {
  const s = live(L, [{ x: 2, lane: 1, hp: 1 }, { x: 9, lane: 2, hp: 1 }])
  L.raiderTick(s)
  assert.strictEqual(s.stun, L.STUN_TICKS)
  assert.deepStrictEqual(s.cities, [true, true, true], "the launcher took the hit, not the city")
  assert.ok(!L.canFire(s))
  L.move(s, -1)
  assert.strictEqual(s.launcher, 1, "can't move while knocked out")
  for (let i = 0; i < L.STUN_TICKS; i++) L.raiderTick(s)
  assert.ok(L.canFire(s))
})

test("the launcher has three lives for the whole game; the third ram ends it", L => {
  const s = live(L, [])
  s.toSpawn = 9
  assert.strictEqual(s.lives, L.LAUNCHER_LIVES)
  for (let n = 1; n <= 3; n++) {
    s.stun = 0
    s.raiders = [{ x: 2, lane: s.launcher, hp: 1 }]
    L.raiderTick(s)
    assert.strictEqual(s.lives, 3 - n)
    if (n < 3) {
      assert.strictEqual(s.phase, "live")
      assert.ok(s.events.some(e => e.label === "LAUNCHER HIT - " + (3 - n) + (3 - n === 1 ? " LIFE" : " LIVES") + " LEFT"))
    }
  }
  assert.strictEqual(s.phase, "gameover")
  assert.ok(s.events.some(e => e.label === "LAUNCHER DESTROYED - GAME OVER"))
  assert.deepStrictEqual(s.cities, [true, true, true], "the cities were fine")
})

test("lives carry over between waves", L => {
  const s = live(L, [{ x: 2, lane: 1, hp: 1 }])
  L.raiderTick(s) // rammed: 2 lives left, and the wave is over (no more raiders)
  assert.strictEqual(s.lives, 2)
  assert.strictEqual(s.phase, "dead")
  L.nextWave(s)
  assert.strictEqual(s.lives, 2)
  assert.strictEqual(L.newGame(1).lives, 3)
})

test("a raider flying into a shell is hit, even between ticks", L => {
  const s = live(L, [{ x: 4, lane: 1, hp: 1 }])
  s.shells = [{ x: 3, lane: 1 }]
  L.raiderTick(s)
  assert.strictEqual(s.raiders.length, 0)
  assert.strictEqual(s.shells.length, 0)
})

test("raiders sometimes veer into a neighboring lane, more often in later waves", L => {
  const s = live(L, [{ x: 6, lane: 1, hp: 1 }, { x: 9, lane: 2, hp: 1 }])
  L.setRandom(() => 0.0) // always jink, always pick the first free choice (up)
  L.raiderTick(s)
  const r = s.raiders.find(x => x.x === 5)
  assert.ok(r, "it still advanced")
  assert.strictEqual(r.lane, 0, "and moved up a lane")
  assert.ok(L.jinkChance({ wave: 6 }) > L.jinkChance({ wave: 1 }))
  assert.ok(L.jinkChance({ wave: 50 }) <= 0.25)
})

test("veering into a shell's lane still gets you shot", L => {
  const s = live(L, [{ x: 5, lane: 1, hp: 1 }, { x: 9, lane: 2, hp: 1 }])
  s.shells = [{ x: 4, lane: 0 }]
  L.setRandom(() => 0.0) // jink up into lane 0, right where the shell is
  L.raiderTick(s)
  assert.strictEqual(s.raiders.length, 1)
  assert.strictEqual(s.shells.length, 0)
  assert.strictEqual(s.hits, 1)
})

test("every hit counts toward the explosion LED, including dents in armor", L => {
  const s = live(L, [{ x: 3, lane: 1, hp: 2, armored: true }, { x: 9, lane: 0, hp: 1 }])
  L.fire(s); L.shellTick(s)
  assert.strictEqual(s.hits, 1)
  for (let i = 0; i < Math.round(L.RELOAD_MS / L.SHELL_TICK_MS); i++) L.shellTick(s) // reload
  L.fire(s); L.shellTick(s)
  assert.strictEqual(s.hits, 2)
})

test("a mega bomb destroys every raider on screen, armor and all, and scores them", L => {
  const s = live(L, [{ x: 3, lane: 0, hp: 1 }, { x: 6, lane: 1, hp: 2, armored: true }, { x: 9, lane: 2, hp: 1, fast: true }])
  s.toSpawn = 5 // more on the way, so the wave isn't over
  assert.strictEqual(s.bombs, L.MEGA_BOMBS)
  assert.ok(L.megaBomb(s))
  assert.strictEqual(s.raiders.length, 0)
  assert.strictEqual(s.score, 10 + 30 + 20)
  assert.strictEqual(s.bombs, L.MEGA_BOMBS - 1)
  assert.strictEqual(s.blasts.length, 3)
  assert.ok(s.events.some(e => e.sound === "megabomb"))
  assert.strictEqual(s.phase, "live")
})

test("only three mega bombs per game, and they carry over between waves", L => {
  const s = live(L, [{ x: 5, lane: 0, hp: 1 }])
  s.toSpawn = 9
  L.megaBomb(s); L.megaBomb(s); L.megaBomb(s)
  assert.strictEqual(s.bombs, 0)
  assert.ok(!L.megaBomb(s))
  assert.ok(s.events.some(e => e.label === "NO MEGA BOMBS LEFT"))
  const t = live(L, [{ x: 3, lane: 1, hp: 1 }])
  L.megaBomb(t)                // clears the last raider: wave over
  assert.strictEqual(t.phase, "dead")
  L.nextWave(t)
  assert.strictEqual(t.bombs, L.MEGA_BOMBS - 1, "no refill between waves")
  // Several more waves later, still no refill.
  for (let w = 0; w < 5; w++) {
    t.phase = "live"; t.toSpawn = 0; t.raiders = [{ x: 4, lane: t.launcher, hp: 1 }]
    L.fire(t); for (let i = 0; i < 6; i++) L.shellTick(t)
    assert.strictEqual(t.phase, "dead")
    L.nextWave(t)
  }
  assert.strictEqual(t.wave, 7)
  assert.strictEqual(t.bombs, L.MEGA_BOMBS - 1, "bombs are per game, not per wave")
  assert.strictEqual(L.newGame(1).bombs, L.MEGA_BOMBS, "a new game starts with three")
})

test("between waves, moving the launcher starts the next wave", L => {
  const s = live(L, [{ x: 3, lane: 1, hp: 1 }])
  L.fire(s); L.shellTick(s)
  assert.strictEqual(s.phase, "dead")
  L.move(s, -1)
  assert.strictEqual(s.wave, 2)
  assert.strictEqual(s.phase, "live")
  assert.strictEqual(s.launcher, 0, "and the launcher moved")
  assert.ok(s.events.some(e => e.sound === "siren"))
})

test("clearing a wave pays a bonus for every city still lit, then STATUS starts the next", L => {
  const s = live(L, [{ x: 3, lane: 1, hp: 1 }])
  s.cities = [true, false, true]
  L.fire(s)
  L.shellTick(s)
  assert.strictEqual(s.phase, "dead")
  assert.strictEqual(s.score, 10 + 2 * L.CITY_BONUS)
  assert.ok(L.nextWave(s))
  assert.strictEqual(s.wave, 2)
  assert.strictEqual(s.phase, "ready")
  assert.deepStrictEqual(s.cities, [true, false, true], "lost cities stay dark")
  assert.strictEqual(s.toSpawn, L.waveSize(2))
})

test("losing the last city ends the game and keeps the high score", L => {
  const s = live(L, [{ x: 1, lane: 0, hp: 1 }])
  s.cities = [true, false, false]
  s.score = 420
  L.raiderTick(s)
  assert.strictEqual(s.phase, "gameover")
  assert.strictEqual(s.high, 420)
  const next = L.newGame(1, s.high)
  assert.strictEqual(next.high, 420)
})

test("raiders arrive from the right edge and later waves get faster", L => {
  const s = L.newGame(1)
  L.move(s, 0) // nothing happens, but the wave hasn't started either
  L.fire(s)    // start
  for (let i = 0; i < 3; i++) L.raiderTick(s)
  assert.ok(s.raiders.some(r => r.x >= 7), "a raider came in from the right")
  const w1 = L.raiderInterval(s)
  s.wave = 5
  assert.ok(L.raiderInterval(s) < w1)
  s.pro = 2
  assert.ok(L.raiderInterval(s) < L.raiderInterval({ pro: 1, wave: 5 }))
})

test("fuzz: random games never break invariants and always end", L => {
  for (let g = 0; g < 300; g++) {
    const s = L.newGame(g % 2 ? 2 : 1)
    let guard = 0
    while (s.phase !== "gameover" && guard++ < 200000) {
      const r = Math.random()
      if (s.phase === "dead") L.nextWave(s)
      else if (r < 0.002) L.megaBomb(s)
      else if (r < 0.1) L.fire(s)
      else if (r < 0.2) L.move(s, Math.random() < 0.5 ? -1 : 1)
      else if (r < 0.7) L.shellTick(s)
      else L.raiderTick(s)
      s.events.length = 0
      const cells = s.raiders.map(x => x.x + ":" + x.lane)
      assert.strictEqual(new Set(cells).size, cells.length, "two raiders share a cell")
      for (const x of s.raiders) assert.ok(x.x >= 1 && x.x <= 9 && !x.gone, JSON.stringify(x))
      assert.ok(s.shells.length <= L.MAX_SHELLS)
      assert.ok(s.launcher >= 0 && s.launcher <= 2)
    }
    assert.strictEqual(s.phase, "gameover", "game " + g + " never ended")
  }
})

console.log(passed + " passed")
