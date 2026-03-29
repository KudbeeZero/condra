import { useCallback, useEffect, useRef, useState } from "react";
import { useActor } from "./hooks/useActor";

type GameScreen = "MENU" | "PLAYING" | "UPGRADE" | "GAMEOVER";
interface Vec2 {
  x: number;
  y: number;
}
interface Entity {
  id: number;
  pos: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
}
interface Player extends Entity {
  angle: number;
  fireTimer: number;
  shieldHits: number;
  activeSorcery: SorceryType | null;
  upgrades: UpgradePath[];
  virMode: boolean;
  virTimer: number;
}
interface Enemy extends Entity {
  type: "grunt" | "elite" | "boss";
  fireTimer: number;
}
interface Bullet extends Entity {
  owner: "player" | "enemy";
  damage: number;
}
interface Pickup {
  id: number;
  pos: Vec2;
  type: SorceryType;
  radius: number;
}
type SorceryType = "lightning" | "shield" | "blast";
type UpgradePath = "gunner" | "sorcerer" | "virus";
interface GameState {
  player: Player;
  enemies: Enemy[];
  bullets: Bullet[];
  pickups: Pickup[];
  score: number;
  stage: number;
  wave: number;
  waveEnemiesLeft: number;
  virusMeter: number;
  keys: Set<string>;
  mouseDown: boolean;
  mousePos: Vec2;
  waveAnnounce: number;
  waveAnnounceText: string;
  nextId: number;
  bossSpawned: boolean;
  stageClear: boolean;
  upgradeChoices: UpgradePath[];
  upgradesDone: number[];
  virModeFlash: number;
  groundDots: Array<{ x: number; y: number; r: number }>;
  narrationCache: Map<string, ArrayBuffer>;
  audioCtx: AudioContext | null;
  joystickDelta: Vec2;
}

const WAVE_CONFIG: number[][][] = [
  [[5], [8], [12]],
  [[8], [12], [16]],
  [[10], [15], [20], [25]],
];

const UPGRADES: Record<
  UpgradePath,
  { label: string; desc: string; icon: string }[]
> = {
  gunner: [
    { label: "Rapid Fire", desc: "+50% fire rate", icon: "🔫" },
    {
      label: "Explosive Rounds",
      desc: "Bullets explode on impact",
      icon: "💥",
    },
    { label: "Minigun Mode", desc: "Triple fire rate + spread", icon: "⚡" },
  ],
  sorcerer: [
    { label: "Wide Blast", desc: "+50% sorcery AoE", icon: "✨" },
    { label: "Dual Channel", desc: "Hold 2 sorcery spells", icon: "🔮" },
    { label: "Virus Cast", desc: "Auto-cast on Virus Mode", icon: "💫" },
  ],
  virus: [
    {
      label: "Fast Infection",
      desc: "Virus meter fills 50% faster",
      icon: "🧬",
    },
    { label: "Extended Rage", desc: "Virus Mode lasts 5s longer", icon: "🦠" },
    { label: "Viral Aura", desc: "Always deal 25% bonus damage", icon: "☣️" },
  ],
};

function newPlayer(cx: number, cy: number): Player {
  return {
    id: 0,
    pos: { x: cx, y: cy * 0.8 },
    vel: { x: 0, y: 0 },
    hp: 100,
    maxHp: 100,
    radius: 14,
    angle: 0,
    fireTimer: 0,
    shieldHits: 0,
    activeSorcery: null,
    upgrades: [],
    virMode: false,
    virTimer: 0,
  };
}

function spawnEnemy(
  type: Enemy["type"],
  canvasW: number,
  id: number,
  stage: number,
): Enemy {
  const x = 80 + Math.random() * (canvasW - 160);
  const hpMult = 1 + stage * 0.3;
  const configs = {
    grunt: { hp: 30, radius: 10, fireTimer: 2 },
    elite: { hp: 80, radius: 14, fireTimer: 1.5 },
    boss: { hp: 500 + stage * 100, radius: 30, fireTimer: 1 },
  };
  const c = configs[type];
  return {
    id,
    type,
    pos: { x, y: -40 },
    vel: { x: 0, y: 0 },
    hp: Math.round(c.hp * hpMult),
    maxHp: Math.round(c.hp * hpMult),
    radius: c.radius,
    fireTimer: c.fireTimer + Math.random(),
  };
}

function vdist(a: Vec2, b: Vec2) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export default function App() {
  const [screen, setScreen] = useState<GameScreen>("MENU");
  const [finalScore, setFinalScore] = useState(0);
  const [stageForUpgrade, setStageForUpgrade] = useState(1);
  const [leaderboard, setLeaderboard] = useState<
    { score: bigint; playerName: string }[]
  >([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const { actor } = useActor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef<GameState | null>(null);
  const animRef = useRef<number>(0);
  const screenRef = useRef<GameScreen>("MENU");

  // Virtual joystick refs
  const joystickBaseRef = useRef<Vec2>({ x: 0, y: 0 });
  const joystickDeltaRef = useRef<Vec2>({ x: 0, y: 0 });
  const joystickActiveRef = useRef(false);
  const joystickIdRef = useRef<number | null>(null);
  const aimTouchIdRef = useRef<number | null>(null);
  const audioUnlockedRef = useRef(false);

  const setScreenBoth = (s: GameScreen) => {
    screenRef.current = s;
    setScreen(s);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: uses actor ref
  const playNarration = useCallback(async (text: string, gs: GameState) => {
    try {
      if (gs.narrationCache.has(text)) {
        const buf = gs.narrationCache.get(text)!;
        if (!gs.audioCtx) gs.audioCtx = new AudioContext();
        const decoded = await gs.audioCtx.decodeAudioData(buf.slice(0));
        const src = gs.audioCtx.createBufferSource();
        src.buffer = decoded;
        src.connect(gs.audioCtx.destination);
        src.start();
        return;
      }
      const b64 = await actor?.getNarration(text);
      if (!b64) return;
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const buf = arr.buffer;
      gs.narrationCache.set(text, buf);
      if (!gs.audioCtx) gs.audioCtx = new AudioContext();
      const decoded = await gs.audioCtx.decodeAudioData(buf.slice(0));
      const src = gs.audioCtx.createBufferSource();
      src.buffer = decoded;
      src.connect(gs.audioCtx.destination);
      src.start();
    } catch {
      /* silent */
    }
  }, []);

  function spawnWave(gs: GameState, canvasW: number) {
    const stageIdx = gs.stage - 1;
    const waves = WAVE_CONFIG[Math.min(stageIdx, WAVE_CONFIG.length - 1)];
    if (gs.wave >= waves.length) {
      if (!gs.bossSpawned) {
        gs.bossSpawned = true;
        gs.enemies.push(spawnEnemy("boss", canvasW, gs.nextId++, gs.stage));
        gs.waveAnnounceText = "BOSS INCOMING!";
        gs.waveAnnounce = 3;
        if (gsRef.current)
          playNarration("Something massive approaches", gsRef.current);
      }
      return;
    }
    const count = waves[gs.wave][0];
    gs.waveEnemiesLeft = count;
    gs.waveAnnounceText = `WAVE ${gs.wave + 1}`;
    gs.waveAnnounce = 2;
    for (let i = 0; i < count; i++) {
      const type: Enemy["type"] =
        gs.stage >= 2 && Math.random() < 0.3 ? "elite" : "grunt";
      const capturedI = i;
      setTimeout(() => {
        if (gsRef.current && screenRef.current === "PLAYING") {
          gsRef.current.enemies.push(
            spawnEnemy(type, canvasW, gsRef.current.nextId++, gs.stage),
          );
        }
        void capturedI;
      }, i * 300);
    }
    gs.wave++;
  }

  function getFireRate(gs: GameState): number {
    let base = 5;
    if (gs.player.upgrades.includes("gunner")) {
      const tier = gs.upgradesDone[0];
      if (tier >= 1) base *= 1.5;
      if (tier >= 3) base *= 3;
    }
    if (gs.player.virMode) base *= 2;
    return base;
  }

  function getDamage(gs: GameState): number {
    let d = 15;
    if (gs.player.virMode) d *= 2;
    if (gs.player.upgrades.includes("virus") && gs.upgradesDone[2] >= 3)
      d *= 1.25;
    return d;
  }

  function getVirFillRate(gs: GameState): number {
    if (gs.player.upgrades.includes("virus") && gs.upgradesDone[2] >= 1)
      return 1.5;
    return 1;
  }

  function getVirDuration(gs: GameState): number {
    if (gs.player.upgrades.includes("virus") && gs.upgradesDone[2] >= 2)
      return 13;
    return 8;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: game loop uses refs intentionally
  const startGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const h = window.visualViewport?.height ?? window.innerHeight;
    canvas.width = window.innerWidth;
    canvas.height = h;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const dots = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 2 + 1,
    }));
    const gs: GameState = {
      player: newPlayer(cx, cy),
      enemies: [],
      bullets: [],
      pickups: [],
      score: 0,
      stage: 1,
      wave: 0,
      waveEnemiesLeft: 0,
      virusMeter: 0,
      keys: new Set(),
      mouseDown: false,
      mousePos: { x: cx, y: cy - 100 },
      waveAnnounce: 0,
      waveAnnounceText: "",
      nextId: 1,
      bossSpawned: false,
      stageClear: false,
      upgradeChoices: ["gunner", "sorcerer", "virus"],
      upgradesDone: [0, 0, 0],
      virModeFlash: 0,
      groundDots: dots,
      narrationCache: new Map(),
      audioCtx: null,
      joystickDelta: { x: 0, y: 0 },
    };
    gsRef.current = gs;
    spawnWave(gs, canvas.width);
    setScreenBoth("PLAYING");
    setTimeout(() => {
      if (gsRef.current)
        playNarration(
          `Stage ${gs.stage}, survive the onslaught`,
          gsRef.current,
        );
    }, 500);
  }, [playNarration]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: game loop uses refs intentionally
  const update = useCallback(
    (dt: number, canvas: HTMLCanvasElement) => {
      const gs = gsRef.current;
      if (!gs || screenRef.current !== "PLAYING") return;
      const W = canvas.width;
      const H = canvas.height;
      const p = gs.player;

      // Player movement
      const spd = 200;
      p.vel = { x: 0, y: 0 };
      if (gs.keys.has("w") || gs.keys.has("arrowup")) p.vel.y = -spd;
      if (gs.keys.has("s") || gs.keys.has("arrowdown")) p.vel.y = spd;
      if (gs.keys.has("a") || gs.keys.has("arrowleft")) p.vel.x = -spd;
      if (gs.keys.has("d") || gs.keys.has("arrowright")) p.vel.x = spd;
      if (p.vel.x !== 0 && p.vel.y !== 0) {
        p.vel.x *= Math.SQRT1_2;
        p.vel.y *= Math.SQRT1_2;
      }

      // Mobile joystick movement
      if (
        gs.joystickDelta &&
        (gs.joystickDelta.x !== 0 || gs.joystickDelta.y !== 0)
      ) {
        const mag = Math.sqrt(
          gs.joystickDelta.x ** 2 + gs.joystickDelta.y ** 2,
        );
        const nx = gs.joystickDelta.x / mag;
        const ny = gs.joystickDelta.y / mag;
        p.vel.x += nx * spd;
        p.vel.y += ny * spd;
        if (p.vel.x !== 0 && p.vel.y !== 0) {
          const vmag = Math.sqrt(p.vel.x ** 2 + p.vel.y ** 2);
          if (vmag > spd) {
            p.vel.x = (p.vel.x / vmag) * spd;
            p.vel.y = (p.vel.y / vmag) * spd;
          }
        }
      }

      p.pos.x = Math.max(70, Math.min(W - 70, p.pos.x + p.vel.x * dt));
      p.pos.y = Math.max(20, Math.min(H - 20, p.pos.y + p.vel.y * dt));

      // Player aim
      p.angle = Math.atan2(gs.mousePos.y - p.pos.y, gs.mousePos.x - p.pos.x);

      // Player shooting
      p.fireTimer -= dt;
      const fireInterval = 1 / getFireRate(gs);
      const hasMinigun =
        p.upgrades.includes("gunner") && gs.upgradesDone[0] >= 3;
      if (gs.mouseDown && p.fireTimer <= 0) {
        p.fireTimer = fireInterval;
        const spreads = hasMinigun ? [-0.2, 0, 0.2] : [0];
        for (const spread of spreads) {
          const a = p.angle + spread;
          gs.bullets.push({
            id: gs.nextId++,
            owner: "player",
            pos: { x: p.pos.x, y: p.pos.y },
            vel: { x: Math.cos(a) * 600, y: Math.sin(a) * 600 },
            hp: 1,
            maxHp: 1,
            radius: 3,
            damage: getDamage(gs),
          });
        }
      }

      // Virus mode
      if (p.virMode) {
        p.virTimer -= dt;
        if (p.virTimer <= 0) {
          p.virMode = false;
          gs.virusMeter = 0;
        }
      }
      gs.virModeFlash = Math.max(0, gs.virModeFlash - dt);

      // Sorcery (Q key)
      if (gs.keys.has("q") && p.activeSorcery) {
        const s = p.activeSorcery;
        p.activeSorcery = null;
        gs.keys.delete("q");
        const aoeMult =
          p.upgrades.includes("sorcerer") && gs.upgradesDone[1] >= 1 ? 1.5 : 1;
        if (s === "lightning") {
          const sorted = [...gs.enemies]
            .sort((a, b) => vdist(a.pos, p.pos) - vdist(b.pos, p.pos))
            .slice(0, 3);
          for (const e of sorted) e.hp -= 80;
        } else if (s === "shield") {
          p.shieldHits = 3;
        } else if (s === "blast") {
          const range = 150 * aoeMult;
          for (const e of gs.enemies) {
            if (vdist(e.pos, p.pos) < range) e.hp -= 120;
          }
        }
      }

      // Enemy update
      for (const e of gs.enemies) {
        const spd2 = e.type === "boss" ? 60 : e.type === "elite" ? 120 : 80;
        const dx = p.pos.x - e.pos.x;
        const dy = p.pos.y - e.pos.y;
        const mag = Math.sqrt(dx * dx + dy * dy) || 1;
        const stopDist = e.type === "boss" ? 200 : 150;
        if (mag > stopDist) {
          e.pos.x += (dx / mag) * spd2 * dt;
          e.pos.y += (dy / mag) * spd2 * dt;
        }
        e.pos.x = Math.max(70 + e.radius, Math.min(W - 70 - e.radius, e.pos.x));
        e.pos.y = Math.max(e.radius, Math.min(H - e.radius, e.pos.y));

        e.fireTimer -= dt;
        if (e.fireTimer <= 0) {
          e.fireTimer = e.type === "boss" ? 1 : e.type === "elite" ? 1.5 : 2;
          const ang = Math.atan2(p.pos.y - e.pos.y, p.pos.x - e.pos.x);
          const shots = e.type === "boss" ? 5 : e.type === "elite" ? 3 : 1;
          for (let i = 0; i < shots; i++) {
            const spread = shots > 1 ? (i / (shots - 1) - 0.5) * 0.6 : 0;
            gs.bullets.push({
              id: gs.nextId++,
              owner: "enemy",
              pos: { x: e.pos.x, y: e.pos.y },
              vel: {
                x: Math.cos(ang + spread) * 250,
                y: Math.sin(ang + spread) * 250,
              },
              hp: 1,
              maxHp: 1,
              radius: 4,
              damage: e.type === "boss" ? 15 : 10,
            });
          }
        }
      }

      // Bullet update
      const newBullets: Bullet[] = [];
      for (const b of gs.bullets) {
        b.pos.x += b.vel.x * dt;
        b.pos.y += b.vel.y * dt;
        if (b.pos.x < 0 || b.pos.x > W || b.pos.y < 0 || b.pos.y > H) continue;

        if (b.owner === "player") {
          let hit = false;
          for (const e of gs.enemies) {
            if (!hit && vdist(b.pos, e.pos) < e.radius + b.radius) {
              e.hp -= b.damage;
              hit = true;
              if (p.upgrades.includes("gunner") && gs.upgradesDone[0] >= 2) {
                for (const e2 of gs.enemies) {
                  if (vdist(e2.pos, b.pos) < 50) e2.hp -= b.damage * 0.5;
                }
              }
            }
          }
          if (!hit) newBullets.push(b);
        } else {
          if (vdist(b.pos, p.pos) < p.radius + b.radius) {
            if (p.shieldHits > 0) {
              p.shieldHits--;
              continue;
            }
            p.hp -= b.damage;
            if (p.hp <= 0) {
              setFinalScore(gs.score);
              if (gsRef.current)
                playNarration("You have fallen, soldier", gsRef.current);
              setScreenBoth("GAMEOVER");
            }
          } else {
            newBullets.push(b);
          }
        }
      }
      gs.bullets = newBullets;

      // Pickup collection
      const remainingPickups: Pickup[] = [];
      for (const pk of gs.pickups) {
        if (vdist(pk.pos, p.pos) < p.radius + pk.radius + 10) {
          p.activeSorcery = pk.type;
        } else {
          remainingPickups.push(pk);
        }
      }
      gs.pickups = remainingPickups;

      // Enemy death
      const alive: Enemy[] = [];
      for (const e of gs.enemies) {
        if (e.hp <= 0) {
          if (Math.random() < 0.3) {
            const types: SorceryType[] = ["lightning", "shield", "blast"];
            gs.pickups.push({
              id: gs.nextId++,
              pos: { x: e.pos.x, y: e.pos.y },
              type: types[Math.floor(Math.random() * 3)],
              radius: 8,
            });
          }
          const fillAmt =
            (e.type === "boss" ? 50 : e.type === "elite" ? 25 : 10) *
            getVirFillRate(gs);
          if (!p.virMode)
            gs.virusMeter = Math.min(100, gs.virusMeter + fillAmt);
          gs.score += e.type === "boss" ? 500 : e.type === "elite" ? 100 : 20;
          if (e.type !== "boss")
            gs.waveEnemiesLeft = Math.max(0, gs.waveEnemiesLeft - 1);
        } else {
          alive.push(e);
        }
      }
      gs.enemies = alive;

      // Virus mode trigger
      if (!p.virMode && gs.virusMeter >= 100) {
        p.virMode = true;
        p.virTimer = getVirDuration(gs);
        gs.virModeFlash = 1;
        playNarration("The virus takes hold", gs);
      }

      // Wave progression
      if (
        !gs.bossSpawned &&
        gs.waveEnemiesLeft === 0 &&
        gs.enemies.length === 0
      ) {
        spawnWave(gs, W);
      }

      // Stage clear
      if (gs.bossSpawned && gs.enemies.length === 0 && !gs.stageClear) {
        gs.stageClear = true;
        if (gs.stage >= 3) {
          setFinalScore(gs.score);
          setTimeout(() => setScreenBoth("GAMEOVER"), 1000);
        } else {
          setStageForUpgrade(gs.stage);
          setTimeout(() => {
            setScreenBoth("UPGRADE");
            if (gsRef.current)
              playNarration("Choose your evolution", gsRef.current);
          }, 1000);
        }
      }

      if (gs.waveAnnounce > 0) gs.waveAnnounce -= dt;
    },
    [playNarration],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: draw uses refs
  const draw = useCallback((canvas: HTMLCanvasElement) => {
    const gs = gsRef.current;
    if (!gs) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const p = gs.player;

    ctx.fillStyle = "#0d0d06";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#1a1a0a";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.fillStyle = "#0a0a06";
    ctx.fillRect(0, 0, 65, H);
    ctx.fillRect(W - 65, 0, 65, H);

    for (const d of gs.groundDots) {
      ctx.fillStyle = "rgba(40,50,20,0.4)";
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const pk of gs.pickups) {
      const colors: Record<SorceryType, string> = {
        lightning: "#ffee00",
        shield: "#44aaff",
        blast: "#ff6600",
      };
      ctx.save();
      ctx.shadowColor = colors[pk.type];
      ctx.shadowBlur = 12;
      ctx.fillStyle = colors[pk.type];
      ctx.beginPath();
      ctx.arc(pk.pos.x, pk.pos.y, pk.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const e of gs.enemies) {
      const colors: Record<string, string> = {
        grunt: "#6a7a5a",
        elite: "#8a3040",
        boss: "#5a2080",
      };
      ctx.fillStyle = colors[e.type];
      if (e.type === "boss") {
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#8844cc";
        ctx.lineWidth = 2;
        ctx.stroke();
        const bw = 80;
        const bh = 8;
        const bx = e.pos.x - bw / 2;
        const by = e.pos.y - e.radius - 16;
        ctx.fillStyle = "#330022";
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "#cc22ff";
        ctx.fillRect(bx, by, bw * (e.hp / e.maxHp), bh);
      } else {
        const s = e.radius * 2;
        ctx.fillRect(e.pos.x - s / 2, e.pos.y - s / 2, s, s);
        ctx.strokeStyle = e.type === "elite" ? "#ff4466" : "#888";
        ctx.lineWidth = 1;
        ctx.strokeRect(e.pos.x - s / 2, e.pos.y - s / 2, s, s);
      }
    }

    for (const b of gs.bullets) {
      ctx.fillStyle = b.owner === "player" ? "#ffffff" : "#ff4400";
      if (b.owner === "player") {
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.save();
    ctx.translate(p.pos.x, p.pos.y);
    if (p.virMode) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 100);
      ctx.shadowColor = `rgba(0,${Math.round(200 + 55 * pulse)},0,1)`;
      ctx.shadowBlur = 20 + 10 * pulse;
      ctx.scale(1.2, 1.2);
    }
    ctx.fillStyle = p.virMode
      ? `hsl(${120 + 30 * Math.sin(Date.now() / 200)},80%,45%)`
      : "#8b7355";
    ctx.fillRect(-9, -12, 18, 24);
    ctx.beginPath();
    ctx.arc(0, -16, 8, 0, Math.PI * 2);
    ctx.fillStyle = p.virMode ? "#44ff44" : "#c4a882";
    ctx.fill();
    ctx.strokeStyle = p.virMode ? "#00ff44" : "rgba(255,255,200,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(p.angle) * 28, Math.sin(p.angle) * 28);
    ctx.stroke();
    if (p.shieldHits > 0) {
      ctx.strokeStyle = `rgba(68,170,255,${0.3 + 0.4 * Math.sin(Date.now() / 200)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    if (gs.virModeFlash > 0) {
      ctx.fillStyle = `rgba(0,255,0,${gs.virModeFlash * 0.3})`;
      ctx.fillRect(0, 0, W, H);
    }

    // HUD - scaled for mobile
    const hudFontSize = Math.max(13, W * 0.035);
    ctx.font = `bold ${hudFontSize}px monospace`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.fillText(`SCORE: ${gs.score}`, 75, 28);
    ctx.textAlign = "right";
    const waveTotal =
      WAVE_CONFIG[Math.min(gs.stage - 1, WAVE_CONFIG.length - 1)].length;
    ctx.fillText(
      `STAGE ${gs.stage}  WAVE ${Math.min(gs.wave, waveTotal)}/${waveTotal}`,
      W - 75,
      28,
    );

    const hbw = Math.min(160, W * 0.25);
    const hbh = 12;
    const hudBottomY = H - H * 0.06;
    ctx.fillStyle = "#330000";
    ctx.fillRect(75, hudBottomY, hbw, hbh);
    ctx.fillStyle = "#cc2222";
    ctx.fillRect(75, hudBottomY, hbw * (p.hp / p.maxHp), hbh);
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1;
    ctx.strokeRect(75, hudBottomY, hbw, hbh);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.fillText(`HP ${p.hp}/${p.maxHp}`, 75, hudBottomY - 4);

    if (p.activeSorcery) {
      const icons: Record<SorceryType, string> = {
        lightning: "⚡",
        shield: "🛡",
        blast: "💥",
      };
      ctx.font = "22px serif";
      ctx.textAlign = "left";
      ctx.fillText(icons[p.activeSorcery], 75, hudBottomY - 18);
    }

    const vmw = Math.min(220, W * 0.4);
    const vmh = 14;
    const vmx = (W - vmw) / 2;
    const vmy = H - H * 0.04;
    ctx.fillStyle = "#001400";
    ctx.fillRect(vmx, vmy, vmw, vmh);
    if (gs.virusMeter > 0 || p.virMode) {
      const pct = p.virMode ? 1 : gs.virusMeter / 100;
      const pulse2 = 0.6 + 0.4 * Math.sin(Date.now() / 300);
      ctx.shadowColor = "#00ff00";
      ctx.shadowBlur = p.virMode ? 20 : 8;
      ctx.fillStyle = p.virMode
        ? `rgba(0,255,0,${pulse2})`
        : `rgba(0,${Math.round(180 + 75 * pct)},0,1)`;
      ctx.fillRect(vmx, vmy, vmw * pct, vmh);
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = "#004400";
    ctx.lineWidth = 1;
    ctx.strokeRect(vmx, vmy, vmw, vmh);
    ctx.font = "9px monospace";
    ctx.fillStyle = "#44ff44";
    ctx.textAlign = "center";
    ctx.fillText(
      p.virMode
        ? "VIRUS MODE ACTIVE"
        : `VIRUS ${Math.round(p.virMode ? 100 : gs.virusMeter)}%`,
      W / 2,
      vmy - 3,
    );

    if (p.virMode && Math.sin(Date.now() / 150) > 0) {
      ctx.font = "bold 32px monospace";
      ctx.fillStyle = "#00ff44";
      ctx.textAlign = "center";
      ctx.shadowColor = "#00ff00";
      ctx.shadowBlur = 20;
      ctx.fillText("☣ VIRUS MODE ☣", W / 2, H / 2 - 40);
      ctx.shadowBlur = 0;
    }

    if (gs.waveAnnounce > 0) {
      ctx.font = "bold 36px monospace";
      ctx.fillStyle = `rgba(255,220,0,${Math.min(1, gs.waveAnnounce)})`;
      ctx.textAlign = "center";
      ctx.shadowColor = "#ffcc00";
      ctx.shadowBlur = 15;
      ctx.fillText(gs.waveAnnounceText, W / 2, H / 2);
      ctx.shadowBlur = 0;
    }

    // Draw virtual joystick if active
    if (joystickActiveRef.current) {
      const jb = joystickBaseRef.current;
      const jd = joystickDeltaRef.current;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#44ff44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(jb.x, jb.y, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#22aa22";
      ctx.beginPath();
      ctx.arc(jb.x + jd.x, jb.y + jd.y, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }, []);

  useEffect(() => {
    if (screen !== "PLAYING") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      canvas.width = window.innerWidth;
      canvas.height = h;
    };
    resize();
    window.addEventListener("resize", resize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", resize);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (gsRef.current) gsRef.current.keys.add(e.key.toLowerCase());
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (gsRef.current) gsRef.current.keys.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    const handleMouseMove = (e: MouseEvent) => {
      if (!gsRef.current) return;
      const rect = canvas.getBoundingClientRect();
      gsRef.current.mousePos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };
    const handleMouseDown = () => {
      if (gsRef.current) gsRef.current.mouseDown = true;
    };
    const handleMouseUp = () => {
      if (gsRef.current) gsRef.current.mouseDown = false;
    };
    const handleContextMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("contextmenu", handleContextMenu);

    // iOS audio unlock
    const unlockAudio = () => {
      if (audioUnlockedRef.current) return;
      audioUnlockedRef.current = true;
      const gs = gsRef.current;
      if (!gs) return;
      if (!gs.audioCtx) gs.audioCtx = new AudioContext();
      gs.audioCtx
        .resume()
        .then(() => {
          if (!gs.audioCtx) return;
          const buf = gs.audioCtx.createBuffer(1, 1, 22050);
          const src = gs.audioCtx.createBufferSource();
          src.buffer = buf;
          src.connect(gs.audioCtx.destination);
          src.start(0);
        })
        .catch(() => {
          /* silent */
        });
    };

    // Touch controls
    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      unlockAudio();
      const rect = canvas.getBoundingClientRect();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const tx = touch.clientX - rect.left;
        const ty = touch.clientY - rect.top;
        const gs = gsRef.current;
        if (!gs) continue;

        if (tx < canvas.width * 0.45) {
          // Left side = joystick
          if (joystickIdRef.current === null) {
            joystickIdRef.current = touch.identifier;
            joystickBaseRef.current = { x: tx, y: ty };
            joystickDeltaRef.current = { x: 0, y: 0 };
            joystickActiveRef.current = true;
            gs.joystickDelta = { x: 0, y: 0 };
          }
        } else {
          // Right side = aim + fire
          if (aimTouchIdRef.current === null) {
            aimTouchIdRef.current = touch.identifier;
            gs.mousePos = { x: tx, y: ty };
            gs.mouseDown = true;
          }
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const gs = gsRef.current;
      if (!gs) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const tx = touch.clientX - rect.left;
        const ty = touch.clientY - rect.top;

        if (touch.identifier === joystickIdRef.current) {
          const dx = tx - joystickBaseRef.current.x;
          const dy = ty - joystickBaseRef.current.y;
          const mag = Math.sqrt(dx * dx + dy * dy);
          const maxR = 50;
          const clampedMag = Math.min(mag, maxR);
          const nx = mag > 0 ? (dx / mag) * clampedMag : 0;
          const ny = mag > 0 ? (dy / mag) * clampedMag : 0;
          joystickDeltaRef.current = { x: nx, y: ny };
          gs.joystickDelta = { x: nx, y: ny };
        } else if (touch.identifier === aimTouchIdRef.current) {
          gs.mousePos = { x: tx, y: ty };
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      const gs = gsRef.current;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystickIdRef.current) {
          joystickIdRef.current = null;
          joystickActiveRef.current = false;
          joystickDeltaRef.current = { x: 0, y: 0 };
          if (gs) gs.joystickDelta = { x: 0, y: 0 };
        } else if (touch.identifier === aimTouchIdRef.current) {
          aimTouchIdRef.current = null;
          if (gs) gs.mouseDown = false;
        }
      }
    };

    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (screenRef.current === "PLAYING") {
        update(dt, canvas);
        draw(canvas);
      }
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", resize);
      }
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [screen, update, draw]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: game loop uses refs intentionally
  const handleUpgrade = useCallback(
    (path: UpgradePath) => {
      const gs = gsRef.current;
      if (!gs) return;
      if (!gs.player.upgrades.includes(path)) gs.player.upgrades.push(path);
      const idx = (["gunner", "sorcerer", "virus"] as UpgradePath[]).indexOf(
        path,
      );
      gs.upgradesDone[idx] = Math.min(3, gs.upgradesDone[idx] + 1);
      gs.stage++;
      gs.wave = 0;
      gs.bossSpawned = false;
      gs.stageClear = false;
      gs.waveEnemiesLeft = 0;
      gs.enemies = [];
      gs.bullets = [];
      const canvas = canvasRef.current;
      if (canvas) spawnWave(gs, canvas.width);
      setScreenBoth("PLAYING");
      setTimeout(() => {
        if (gsRef.current)
          playNarration(
            `Stage ${gs.stage}, survive the onslaught`,
            gsRef.current,
          );
      }, 500);
    },
    [playNarration],
  );

  const fetchLeaderboard = async () => {
    try {
      const lb = await actor?.getLeaderboard();
      if (lb) setLeaderboard(lb);
    } catch {
      /* silent */
    }
    setShowLeaderboard(true);
  };

  const handleSubmitScore = async () => {
    if (!playerName.trim()) return;
    try {
      await actor?.submitScore(playerName.trim(), BigInt(finalScore));
    } catch {
      /* silent */
    }
    setScoreSubmitted(true);
  };

  const handleSorceryButton = () => {
    const gs = gsRef.current;
    if (!gs) return;
    gs.keys.add("q");
    setTimeout(() => {
      if (gsRef.current) gsRef.current.keys.delete("q");
    }, 100);
  };

  return (
    <>
      {/* Canvas is always mounted so canvasRef.current is available when startGame is called */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: screen === "PLAYING" ? "block" : "none",
          background: "#000",
          cursor: "crosshair",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%" }}
        />
        {/* Sorcery button overlay */}
        <button
          type="button"
          data-ocid="game.sorcery_button"
          onTouchStart={(e) => {
            e.preventDefault();
            handleSorceryButton();
          }}
          onClick={handleSorceryButton}
          style={{
            position: "fixed",
            bottom: 80,
            right: 20,
            width: 70,
            height: 70,
            borderRadius: "50%",
            background: "rgba(0,20,0,0.75)",
            border: gsRef.current?.player.activeSorcery
              ? "3px solid #44ff44"
              : "2px solid #225522",
            color: "#44ff44",
            fontSize: 28,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            touchAction: "none",
            WebkitTapHighlightColor: "transparent",
            backdropFilter: "blur(4px)",
          }}
        >
          {gsRef.current?.player.activeSorcery
            ? (() => {
                const icons: Record<SorceryType, string> = {
                  lightning: "⚡",
                  shield: "🛡",
                  blast: "💥",
                };
                return icons[gsRef.current.player.activeSorcery];
              })()
            : "🔒"}
        </button>
      </div>

      {/* MENU screen */}
      {screen === "MENU" && (
        <div
          style={{
            width: "100vw",
            height: "100dvh",
            background: "#040804",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "monospace",
            overflow: "hidden",
            touchAction: "none",
            userSelect: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <h1
                style={{
                  fontSize: "clamp(48px,10vw,96px)",
                  fontWeight: 900,
                  color: "#22ff44",
                  textShadow: "0 0 40px #00ff22, 0 0 80px #00aa11",
                  letterSpacing: 12,
                  margin: 0,
                }}
              >
                CONDRA
              </h1>
              <p
                style={{
                  color: "#4a8a4a",
                  fontSize: 16,
                  letterSpacing: 4,
                  marginTop: 8,
                }}
              >
                INFECTED. UNSTOPPABLE. EVOLVING.
              </p>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                width: 220,
              }}
            >
              <button
                type="button"
                onClick={startGame}
                data-ocid="menu.primary_button"
                style={{
                  background: "#1a3a1a",
                  border: "2px solid #22aa22",
                  color: "#44ff44",
                  padding: "14px 0",
                  fontSize: 18,
                  fontFamily: "monospace",
                  cursor: "pointer",
                  letterSpacing: 4,
                }}
              >
                START GAME
              </button>
              <button
                type="button"
                onClick={fetchLeaderboard}
                data-ocid="menu.secondary_button"
                style={{
                  background: "#111",
                  border: "2px solid #444",
                  color: "#888",
                  padding: "12px 0",
                  fontSize: 14,
                  fontFamily: "monospace",
                  cursor: "pointer",
                  letterSpacing: 2,
                }}
              >
                LEADERBOARD
              </button>
            </div>
            <p
              style={{
                color: "#334433",
                fontSize: 12,
                letterSpacing: 2,
                marginTop: 8,
                textAlign: "center",
                padding: "0 16px",
              }}
            >
              JOYSTICK · TAP RIGHT TO SHOOT · SORCERY BUTTON
            </p>
          </div>
          {showLeaderboard && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.85)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10,
              }}
              aria-label="Close leaderboard"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  setShowLeaderboard(false);
              }}
              onClick={() => setShowLeaderboard(false)}
            >
              <div
                style={{
                  background: "#0a1a0a",
                  border: "2px solid #225522",
                  padding: 32,
                  minWidth: 320,
                  fontFamily: "monospace",
                }}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  style={{ color: "#44ff44", marginTop: 0, letterSpacing: 4 }}
                >
                  LEADERBOARD
                </h2>
                {leaderboard.length === 0 ? (
                  <p style={{ color: "#666" }}>No scores yet.</p>
                ) : (
                  leaderboard.map((s, i) => (
                    <div
                      key={`${s.playerName}-${i}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        color: i === 0 ? "#ffcc00" : "#aaa",
                        padding: "4px 0",
                        borderBottom: "1px solid #1a2a1a",
                      }}
                    >
                      <span>
                        #{i + 1} {s.playerName}
                      </span>
                      <span>{s.score.toString()}</span>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setShowLeaderboard(false)}
                  style={{
                    marginTop: 16,
                    background: "transparent",
                    border: "1px solid #444",
                    color: "#888",
                    padding: "8px 24px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  CLOSE
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* UPGRADE screen */}
      {screen === "UPGRADE" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.95)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "monospace",
            gap: 32,
            overflow: "auto",
            padding: "20px 12px",
            touchAction: "pan-y",
            zIndex: 20,
          }}
        >
          <h2
            style={{
              color: "#44ff44",
              fontSize: 28,
              letterSpacing: 6,
              textShadow: "0 0 20px #00ff44",
              margin: 0,
              textAlign: "center",
            }}
          >
            STAGE {stageForUpgrade} COMPLETE
          </h2>
          <p
            style={{
              color: "#4a8a4a",
              letterSpacing: 3,
              margin: 0,
              textAlign: "center",
            }}
          >
            CHOOSE YOUR EVOLUTION
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: window.innerWidth < 500 ? "column" : "row",
              gap: 20,
              flexWrap: "wrap",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {(["gunner", "sorcerer", "virus"] as UpgradePath[]).map(
              (path, pi) => {
                const tierIdx = gsRef.current?.upgradesDone[pi] ?? 0;
                const upgrade =
                  UPGRADES[path][Math.min(tierIdx, UPGRADES[path].length - 1)];
                const colors: Record<UpgradePath, string> = {
                  gunner: "#cc6622",
                  sorcerer: "#4466cc",
                  virus: "#22aa44",
                };
                return (
                  <button
                    type="button"
                    key={path}
                    onClick={() => handleUpgrade(path)}
                    data-ocid={`upgrade.item.${pi + 1}`}
                    style={{
                      background: "#0a0a0a",
                      border: `2px solid ${colors[path]}`,
                      color: "#ddd",
                      padding: "24px 28px",
                      width: window.innerWidth < 500 ? "80vw" : 180,
                      cursor: "pointer",
                      fontFamily: "monospace",
                      textAlign: "center",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 32 }}>{upgrade.icon}</span>
                    <span
                      style={{
                        color: colors[path],
                        fontWeight: "bold",
                        fontSize: 14,
                        letterSpacing: 2,
                      }}
                    >
                      {path.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: "bold" }}>
                      {upgrade.label}
                    </span>
                    <span style={{ fontSize: 11, color: "#888" }}>
                      {upgrade.desc}
                    </span>
                  </button>
                );
              },
            )}
          </div>
        </div>
      )}

      {/* GAMEOVER screen */}
      {screen === "GAMEOVER" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#020402",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "monospace",
            gap: 20,
            padding: "20px",
            touchAction: "none",
            zIndex: 20,
          }}
        >
          <h1
            style={{
              color: "#ff2222",
              fontSize: "clamp(28px,6vw,52px)",
              letterSpacing: 6,
              textShadow: "0 0 30px #ff0000",
              margin: 0,
              textAlign: "center",
            }}
          >
            MISSION FAILED
          </h1>
          <p
            style={{
              color: "#884444",
              letterSpacing: 3,
              margin: 0,
              textAlign: "center",
            }}
          >
            THE VIRUS HAS CLAIMED YOU
          </p>
          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid #332222",
              padding: "24px 40px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                color: "#888",
                margin: "0 0 4px",
                fontSize: 12,
                letterSpacing: 2,
              }}
            >
              FINAL SCORE
            </p>
            <p
              style={{
                color: "#ffcc00",
                fontSize: 36,
                fontWeight: "bold",
                margin: 0,
              }}
            >
              {finalScore.toLocaleString()}
            </p>
          </div>
          {!scoreSubmitted ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <input
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="YOUR NAME"
                maxLength={20}
                data-ocid="gameover.input"
                style={{
                  background: "#111",
                  border: "1px solid #444",
                  color: "#fff",
                  padding: "8px 12px",
                  fontFamily: "monospace",
                  fontSize: 14,
                  outline: "none",
                  letterSpacing: 2,
                }}
              />
              <button
                type="button"
                onClick={handleSubmitScore}
                data-ocid="gameover.submit_button"
                style={{
                  background: "#1a1a00",
                  border: "2px solid #aa8800",
                  color: "#ffcc00",
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontFamily: "monospace",
                  letterSpacing: 2,
                }}
              >
                SUBMIT
              </button>
            </div>
          ) : (
            <p style={{ color: "#44aa44", letterSpacing: 2 }}>
              SCORE SUBMITTED ✓
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setScoreSubmitted(false);
              setPlayerName("");
              startGame();
            }}
            data-ocid="gameover.primary_button"
            style={{
              background: "#0a1a0a",
              border: "2px solid #226622",
              color: "#44cc44",
              padding: "14px 32px",
              fontSize: 16,
              cursor: "pointer",
              fontFamily: "monospace",
              letterSpacing: 4,
              marginTop: 8,
            }}
          >
            PLAY AGAIN
          </button>
          <button
            type="button"
            onClick={() => {
              setScreenBoth("MENU");
              setScoreSubmitted(false);
              setPlayerName("");
            }}
            data-ocid="gameover.secondary_button"
            style={{
              background: "transparent",
              border: "1px solid #333",
              color: "#555",
              padding: "8px 24px",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            MAIN MENU
          </button>
        </div>
      )}
    </>
  );
}
