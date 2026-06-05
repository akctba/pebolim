const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const scoreLeftEl = document.getElementById("scoreLeft");
const scoreRightEl = document.getElementById("scoreRight");
const teamLeftNameEl = document.getElementById("teamLeftName");
const teamRightNameEl = document.getElementById("teamRightName");
const statusTextEl = document.getElementById("statusText");
const resetBtn = document.getElementById("resetBtn");

const netModeEl = document.getElementById("netMode");
const rodsPerSideEl = document.getElementById("rodsPerSide");
const leftTeamNameInputEl = document.getElementById("leftTeamNameInput");
const rightTeamNameInputEl = document.getElementById("rightTeamNameInput");
const startGameBtn = document.getElementById("startGameBtn");
const hostRodSelectEl = document.getElementById("hostRodSelect");
const assignRodSelectEl = document.getElementById("assignRodSelect");
const createOfferBtn = document.getElementById("createOfferBtn");
const offerOutEl = document.getElementById("offerOut");
const offerInEl = document.getElementById("offerIn");
const createAnswerBtn = document.getElementById("createAnswerBtn");
const answerOutEl = document.getElementById("answerOut");
const answerInEl = document.getElementById("answerIn");
const applyAnswerBtn = document.getElementById("applyAnswerBtn");
const netStatusEl = document.getElementById("netStatus");
const playerRoleEl = document.getElementById("playerRole");
const openInfoBtn = document.getElementById("openInfoBtn");
const closeInfoBtn = document.getElementById("closeInfoBtn");
const infoModal = document.getElementById("infoModal");

const FIELD_WIDTH = canvas.width;
const FIELD_HEIGHT = canvas.height;
const GOAL_HEIGHT = 220;
const WIN_SCORE = 7;
const DT = 1 / 60;
const SNAPSHOT_INTERVAL_MS = 50;
const SURFACE_BOWL_ACCEL = 30;
const GOAL_BALLOON_MS = 1500;
const GOAL_RELEASE_DELAY_MS = 200;

const leftTeamColor = "#2aa0ff";
const rightTeamColor = "#ff8a3d";
const keyState = Object.create(null);

const MIN_RODS_PER_SIDE = 2;
const MAX_RODS_PER_SIDE = 4;
const DEFAULT_RODS_PER_SIDE = 4;
const DEFAULT_TEAM_NAMES = { left: "Team Blue", right: "Team Orange" };

function normalizeRodsPerSide(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RODS_PER_SIDE;
  }
  return Math.max(MIN_RODS_PER_SIDE, Math.min(MAX_RODS_PER_SIDE, Math.round(parsed)));
}

function normalizeTeamName(value, fallback) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.slice(0, 22);
}

function sanitizeTeamNames(teamNames) {
  return {
    left: normalizeTeamName(teamNames?.left, DEFAULT_TEAM_NAMES.left),
    right: normalizeTeamName(teamNames?.right, DEFAULT_TEAM_NAMES.right),
  };
}

const MASTER_ROD_DEFS = [
  {
    id: "left-goalie",
    label: "Blue Goalie",
    team: "left",
    role: "goalie",
    localKeys: ["Digit1", "Digit2"],
    players: [0],
  },
  {
    id: "left-defense",
    label: "Blue Defense",
    team: "left",
    role: "defense",
    localKeys: ["KeyW", "KeyS"],
    players: [-110, 0, 110],
  },
  {
    id: "left-mid",
    label: "Blue Mid",
    team: "left",
    role: "mid",
    localKeys: ["KeyT", "KeyG"],
    players: [-150, -50, 50, 150],
  },
  {
    id: "left-attack",
    label: "Blue Attack",
    team: "left",
    role: "attack",
    localKeys: ["KeyI", "KeyK"],
    players: [-120, 0, 120],
  },
  {
    id: "right-goalie",
    label: "Orange Goalie",
    team: "right",
    role: "goalie",
    localKeys: ["BracketLeft", "BracketRight"],
    players: [0],
  },
  {
    id: "right-defense",
    label: "Orange Defense",
    team: "right",
    role: "defense",
    localKeys: ["ArrowUp", "ArrowDown"],
    players: [-110, 0, 110],
  },
  {
    id: "right-mid",
    label: "Orange Mid",
    team: "right",
    role: "mid",
    localKeys: ["KeyO", "KeyL"],
    players: [-150, -50, 50, 150],
  },
  {
    id: "right-attack",
    label: "Orange Attack",
    team: "right",
    role: "attack",
    localKeys: ["Comma", "Period"],
    players: [-120, 0, 120],
  },
];

const rodById = new Map(MASTER_ROD_DEFS.map((cfg) => [cfg.id, cfg]));

function rolesForCount(rodsPerSide) {
  if (rodsPerSide <= 2) {
    return ["goalie", "attack"];
  }
  if (rodsPerSide === 3) {
    return ["goalie", "mid", "attack"];
  }
  return ["goalie", "defense", "mid", "attack"];
}

function getActiveRodConfigs(rodsPerSide) {
  const roles = rolesForCount(rodsPerSide);
  const byTeamAndRole = new Map(MASTER_ROD_DEFS.map((cfg) => [`${cfg.team}:${cfg.role}`, cfg]));

  const left = roles.map((role) => byTeamAndRole.get(`left:${role}`)).filter(Boolean);
  const right = roles.map((role) => byTeamAndRole.get(`right:${role}`)).filter(Boolean);
  const ordered = [...left, ...right.reverse()];

  const minX = 0.07;
  const maxX = 0.93;
  const step = ordered.length > 1 ? (maxX - minX) / (ordered.length - 1) : 0;

  return ordered.map((cfg, index) => ({
    ...cfg,
    x: FIELD_WIDTH * (minX + step * index),
  }));
}

const network = {
  mode: "host",
  rodsPerSide: normalizeRodsPerSide(rodsPerSideEl?.value ?? DEFAULT_RODS_PER_SIDE),
  hostAssignedRodId: hostRodSelectEl.value,
  clientAssignedRodId: null,
  peers: new Map(),
  pendingOffers: new Map(),
  clientConnection: null,
  lastSnapshotSentAt: 0,
};

function makeRods(rodsPerSide = network.rodsPerSide) {
  const activeConfigs = getActiveRodConfigs(rodsPerSide);
  const sortedXs = [...activeConfigs.map((cfg) => cfg.x)].sort((a, b) => a - b);

  function forwardGapForRod(cfg) {
    if (cfg.team === "left") {
      const nextX = sortedXs.find((x) => x > cfg.x);
      return nextX ? nextX - cfg.x : FIELD_WIDTH - cfg.x;
    }

    const descending = [...sortedXs].reverse();
    const nextX = descending.find((x) => x < cfg.x);
    return nextX ? cfg.x - nextX : cfg.x;
  }

  return activeConfigs.map((cfg) => ({
    id: cfg.id,
    team: cfg.team,
    x: cfg.x,
    y: FIELD_HEIGHT / 2,
    vy: 0,
    spinAngle: 0,
    spinVelocity: 0,
    footReach: forwardGapForRod(cfg) * 0.45,
    players: cfg.players,
    localKeys: cfg.localKeys,
    ownerPeerId: null,
    remoteInput: { up: false, down: false, spin: false },
  }));
}

function createBall() {
  const launch = Math.random() > 0.5 ? 1 : -1;
  const angle = (Math.random() * 0.6 - 0.3) * Math.PI;
  return {
    x: FIELD_WIDTH / 2,
    y: FIELD_HEIGHT / 2,
    vx: Math.cos(angle) * 360 * launch,
    vy: Math.sin(angle) * 360,
    r: 11,
  };
}

const state = {
  rods: makeRods(),
  ball: createBall(),
  score: { left: 0, right: 0 },
  teamNames: { ...DEFAULT_TEAM_NAMES },
  matchDone: false,
  lastScoredBy: "left",
  goalBalloonText: "",
  goalBalloonTeam: null,
  goalBalloonUntilMs: 0,
  pendingRestartTeam: null,
  ballReleaseAtMs: 0,
  gameStarted: false,
};

function rodLabel(rodId) {
  return rodById.get(rodId)?.label ?? rodId;
}

function refreshRodSelectors() {
  const activeConfigs = getActiveRodConfigs(network.rodsPerSide);
  const previousHostRodId = network.hostAssignedRodId;
  const previousAssignRodId = assignRodSelectEl.value;

  const optionsMarkup = activeConfigs
    .map((cfg) => `<option value="${cfg.id}">${cfg.label}</option>`)
    .join("");

  hostRodSelectEl.innerHTML = optionsMarkup;
  assignRodSelectEl.innerHTML = optionsMarkup;

  const hasHostRod = activeConfigs.some((cfg) => cfg.id === previousHostRodId);
  hostRodSelectEl.value = hasHostRod ? previousHostRodId : activeConfigs[0].id;
  network.hostAssignedRodId = hostRodSelectEl.value;

  const hasAssignRod = activeConfigs.some((cfg) => cfg.id === previousAssignRodId);
  assignRodSelectEl.value = hasAssignRod ? previousAssignRodId : activeConfigs[0].id;
}

function applyRodLayout(rodsPerSide) {
  const previousOwners = new Map(state.rods.map((rod) => [rod.id, rod.ownerPeerId]));
  state.rods = makeRods(rodsPerSide);
  for (const rod of state.rods) {
    rod.ownerPeerId = previousOwners.get(rod.id) ?? null;
  }
  refreshRodSelectors();
}

function setNetStatus(text) {
  netStatusEl.textContent = text;
}

function setRoleText(text) {
  playerRoleEl.textContent = text;
}

function setGameStarted(isStarted) {
  state.gameStarted = !!isStarted;
  document.body.classList.toggle("game-started", state.gameStarted);
}

function renderTeamNames() {
  teamLeftNameEl.textContent = state.teamNames.left;
  teamRightNameEl.textContent = state.teamNames.right;
}

function setTeamNames(nextTeamNames, syncInputs = true) {
  state.teamNames = sanitizeTeamNames(nextTeamNames);
  renderTeamNames();

  if (syncInputs) {
    if (leftTeamNameInputEl) {
      leftTeamNameInputEl.value = state.teamNames.left;
    }
    if (rightTeamNameInputEl) {
      rightTeamNameInputEl.value = state.teamNames.right;
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resetBall(scoredBy) {
  state.ball = createBall();
  state.lastScoredBy = scoredBy;
}

function centerBallStill() {
  state.ball.x = FIELD_WIDTH / 2;
  state.ball.y = FIELD_HEIGHT / 2;
  state.ball.vx = 0;
  state.ball.vy = 0;
}

function clearRodOwners() {
  for (const rod of state.rods) {
    rod.ownerPeerId = null;
    rod.remoteInput.up = false;
    rod.remoteInput.down = false;
    rod.remoteInput.spin = false;
  }
}

function resetMatch() {
  state.score.left = 0;
  state.score.right = 0;
  state.matchDone = false;
  const previousOwners = new Map(state.rods.map((rod) => [rod.id, rod.ownerPeerId]));
  state.rods = makeRods();
  for (const rod of state.rods) {
    rod.ownerPeerId = previousOwners.get(rod.id) ?? null;
  }
  resetBall("left");
  state.goalBalloonText = "";
  state.goalBalloonTeam = null;
  state.goalBalloonUntilMs = 0;
  state.pendingRestartTeam = null;
  state.ballReleaseAtMs = 0;
  updateHud("First team to 7 wins");
}

function configureHostRodsPerSide(nextValue) {
  const nextCount = normalizeRodsPerSide(nextValue);

  if (network.mode !== "host") {
    if (rodsPerSideEl) {
      rodsPerSideEl.value = String(network.rodsPerSide);
    }
    return;
  }

  if (nextCount === network.rodsPerSide) {
    if (rodsPerSideEl) {
      rodsPerSideEl.value = String(network.rodsPerSide);
    }
    return;
  }

  network.rodsPerSide = nextCount;
  if (rodsPerSideEl) {
    rodsPerSideEl.value = String(network.rodsPerSide);
  }

  closeAllNetworkConnections();
  clearRodOwners();
  network.clientAssignedRodId = null;
  offerOutEl.value = "";
  answerOutEl.value = "";
  answerInEl.value = "";

  applyRodLayout(network.rodsPerSide);
  setGameStarted(false);
  resetMatch();
  refreshRoleText();
  setNetStatus(`Host rods per side: ${network.rodsPerSide}. Match reset.`);
}

function effectiveDirectionForRod(rod) {
  const localDirection = (keyState[rod.localKeys[1]] ? 1 : 0) - (keyState[rod.localKeys[0]] ? 1 : 0);

  if (network.mode === "host") {
    if (rod.ownerPeerId) {
      return (rod.remoteInput.down ? 1 : 0) - (rod.remoteInput.up ? 1 : 0);
    }

    if (network.hostAssignedRodId === rod.id) {
      return (keyState.KeyS ? 1 : 0) - (keyState.KeyW ? 1 : 0);
    }

    return 0;
  }

  if (network.mode === "client") {
    if (network.clientAssignedRodId === rod.id) {
      return (keyState.KeyS ? 1 : 0) - (keyState.KeyW ? 1 : 0);
    }
    return 0;
  }

  return 0;
}

function effectiveSpinForRod(rod) {
  if (network.mode === "host") {
    if (rod.ownerPeerId) {
      return !!rod.remoteInput.spin;
    }

    if (network.hostAssignedRodId === rod.id) {
      return !!keyState.Space;
    }

    return false;
  }

  if (network.mode === "client") {
    return network.clientAssignedRodId === rod.id && !!keyState.Space;
  }

  return false;
}

function updateRods() {
  const maxSpeed = 520;
  const acceleration = 1600;
  const damping = 0.88;
  const spinAccel = 95;
  const spinDamping = 0.92;

  for (const rod of state.rods) {
    const direction = effectiveDirectionForRod(rod);
    const spinPressed = effectiveSpinForRod(rod);

    rod.vy += direction * acceleration * DT;
    rod.vy = clamp(rod.vy, -maxSpeed, maxSpeed);
    rod.vy *= damping;
    rod.y += rod.vy * DT;

    if (spinPressed) {
      rod.spinVelocity += spinAccel * DT;
    }
    rod.spinVelocity *= spinDamping;
    rod.spinVelocity = clamp(rod.spinVelocity, -20, 20);
    rod.spinAngle += rod.spinVelocity * DT;

    const topLimit = 90;
    const bottomLimit = FIELD_HEIGHT - 90;
    if (rod.y < topLimit) {
      rod.y = topLimit;
      rod.vy = 0;
    } else if (rod.y > bottomLimit) {
      rod.y = bottomLimit;
      rod.vy = 0;
    }
  }
}

function collideBallWithPlayers() {
  const playerRadius = 22;
  const footRadius = 8;
  const restitution = 0.92;

  for (const rod of state.rods) {
    const teamImpulse = rod.team === "left" ? 120 : -120;
    const facingDir = rod.team === "left" ? 1 : -1;
    const isSpinning = effectiveSpinForRod(rod);
    const footReach = isSpinning ? rod.footReach : 0;

    for (const offsetY of rod.players) {
      const px = rod.x;
      const py = rod.y + offsetY;

      if (py < 25 || py > FIELD_HEIGHT - 25) {
        continue;
      }

      const dx = state.ball.x - px;
      const dy = state.ball.y - py;
      const distance = Math.hypot(dx, dy);
      const minDistance = playerRadius + state.ball.r;

      if (distance < minDistance && distance !== 0) {
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minDistance - distance;

        state.ball.x += nx * overlap;
        state.ball.y += ny * overlap;

        const relativeVelocityX = state.ball.vx;
        const relativeVelocityY = state.ball.vy - rod.vy;
        const normalVelocity = relativeVelocityX * nx + relativeVelocityY * ny;

        if (normalVelocity < 0) {
          const impulse = -(1 + restitution) * normalVelocity;
          state.ball.vx += impulse * nx;
          state.ball.vy += impulse * ny;
        }

        state.ball.vx += teamImpulse;
        state.ball.vy += rod.vy * 0.23;

        const speed = Math.hypot(state.ball.vx, state.ball.vy);
        if (speed > 960) {
          const ratio = 960 / speed;
          state.ball.vx *= ratio;
          state.ball.vy *= ratio;
        }
      }

      if (isSpinning) {
        const footX = px + facingDir * footReach;
        const footY = py;
        const fdx = state.ball.x - footX;
        const fdy = state.ball.y - footY;
        const footDistance = Math.hypot(fdx, fdy);
        const footMinDistance = footRadius + state.ball.r;

        if (footDistance >= footMinDistance || footDistance === 0) {
          continue;
        }

        const fnx = fdx / footDistance;
        const fny = fdy / footDistance;
        const overlapFoot = footMinDistance - footDistance;

        state.ball.x += fnx * overlapFoot;
        state.ball.y += fny * overlapFoot;

        const footRelativeVelocityX = state.ball.vx - facingDir * rod.spinVelocity * footReach * 0.6;
        const footRelativeVelocityY = state.ball.vy - rod.vy;
        const footNormalVelocity = footRelativeVelocityX * fnx + footRelativeVelocityY * fny;

        if (footNormalVelocity < 0) {
          const footImpulse = -(1 + restitution) * footNormalVelocity;
          state.ball.vx += footImpulse * fnx;
          state.ball.vy += footImpulse * fny;
        }

        state.ball.vx += teamImpulse * 0.55;
        state.ball.vy += rod.vy * 0.12;

        const footSpeed = Math.hypot(state.ball.vx, state.ball.vy);
        if (footSpeed > 960) {
          const footRatio = 960 / footSpeed;
          state.ball.vx *= footRatio;
          state.ball.vy *= footRatio;
        }
      }
    }
  }
}

function scoreGoal(team, nowMs) {
  state.score[team] += 1;
  const teamLabel = team === "left" ? state.teamNames.left : state.teamNames.right;
  state.goalBalloonText = "Goooooalll!!!";
  state.goalBalloonTeam = team;
  state.goalBalloonUntilMs = nowMs + GOAL_BALLOON_MS;
  centerBallStill();

  if (state.score[team] >= WIN_SCORE) {
    state.matchDone = true;
    state.pendingRestartTeam = null;
    state.ballReleaseAtMs = 0;
    updateHud(`${teamLabel} wins! Press Reset Match.`);
  } else {
    state.pendingRestartTeam = team;
    state.ballReleaseAtMs = nowMs + GOAL_BALLOON_MS + GOAL_RELEASE_DELAY_MS;
    updateHud(`${teamLabel} scored!`);
  }
}

function updateBall(nowMs) {
  if (state.goalBalloonUntilMs > 0 && nowMs >= state.goalBalloonUntilMs) {
    state.goalBalloonText = "";
    state.goalBalloonTeam = null;
    state.goalBalloonUntilMs = 0;
  }

  if (state.pendingRestartTeam) {
    if (nowMs >= state.ballReleaseAtMs) {
      const scoredBy = state.pendingRestartTeam;
      state.pendingRestartTeam = null;
      state.ballReleaseAtMs = 0;
      resetBall(scoredBy);
    } else {
      centerBallStill();
      return;
    }
  }

  if (state.matchDone) {
    return;
  }

  // Slight bowl effect: gently pulls the ball toward field center over time.
  const centerX = FIELD_WIDTH / 2;
  const centerY = FIELD_HEIGHT / 2;
  const toCenterX = centerX - state.ball.x;
  const toCenterY = centerY - state.ball.y;
  const distanceToCenter = Math.hypot(toCenterX, toCenterY);

  if (distanceToCenter > 0.001) {
    const nx = toCenterX / distanceToCenter;
    const ny = toCenterY / distanceToCenter;
    const distanceRatio = Math.min(1, distanceToCenter / (FIELD_WIDTH * 0.5));
    const bowlAccel = SURFACE_BOWL_ACCEL * distanceRatio;
    state.ball.vx += nx * bowlAccel * DT;
    state.ball.vy += ny * bowlAccel * DT;
  }

  state.ball.x += state.ball.vx * DT;
  state.ball.y += state.ball.vy * DT;

  state.ball.vx *= 0.996;
  state.ball.vy *= 0.996;

  if (state.ball.y - state.ball.r <= 0) {
    state.ball.y = state.ball.r;
    state.ball.vy *= -0.96;
  } else if (state.ball.y + state.ball.r >= FIELD_HEIGHT) {
    state.ball.y = FIELD_HEIGHT - state.ball.r;
    state.ball.vy *= -0.96;
  }

  collideBallWithPlayers();

  const goalTop = FIELD_HEIGHT / 2 - GOAL_HEIGHT / 2;
  const goalBottom = FIELD_HEIGHT / 2 + GOAL_HEIGHT / 2;
  const inGoalBand = state.ball.y > goalTop && state.ball.y < goalBottom;

  if (state.ball.x - state.ball.r <= 0) {
    if (inGoalBand) {
      scoreGoal("right", nowMs);
      return;
    } else {
      state.ball.x = state.ball.r;
      state.ball.vx *= -0.95;
    }
  }

  if (state.ball.x + state.ball.r >= FIELD_WIDTH) {
    if (inGoalBand) {
      scoreGoal("left", nowMs);
      return;
    } else {
      state.ball.x = FIELD_WIDTH - state.ball.r;
      state.ball.vx *= -0.95;
    }
  }
}

function applySnapshot(snapshot) {
  if (snapshot.teamNames) {
    setTeamNames(snapshot.teamNames);
  }

  if (typeof snapshot.gameStarted === "boolean") {
    setGameStarted(snapshot.gameStarted);
  }

  state.goalBalloonText = snapshot.goalBalloonText ?? "";
  state.goalBalloonTeam = snapshot.goalBalloonTeam ?? null;
  state.goalBalloonUntilMs = snapshot.goalBalloonActive ? Number.POSITIVE_INFINITY : 0;

  if (typeof snapshot.rodsPerSide === "number" && snapshot.rodsPerSide !== network.rodsPerSide) {
    network.rodsPerSide = normalizeRodsPerSide(snapshot.rodsPerSide);
    if (rodsPerSideEl) {
      rodsPerSideEl.value = String(network.rodsPerSide);
    }
    applyRodLayout(network.rodsPerSide);
  }

  for (const rodSnap of snapshot.rods) {
    const rod = state.rods.find((item) => item.id === rodSnap.id);
    if (rod) {
      rod.y = rodSnap.y;
      rod.vy = rodSnap.vy;
    }
  }

  state.ball.x = snapshot.ball.x;
  state.ball.y = snapshot.ball.y;
  state.ball.vx = snapshot.ball.vx;
  state.ball.vy = snapshot.ball.vy;
  state.score.left = snapshot.score.left;
  state.score.right = snapshot.score.right;
  state.matchDone = snapshot.matchDone;
  updateHud(snapshot.statusText);
}

function buildSnapshot() {
  return {
    type: "snapshot",
    gameStarted: state.gameStarted,
    teamNames: { ...state.teamNames },
    goalBalloonText: state.goalBalloonText,
    goalBalloonTeam: state.goalBalloonTeam,
    goalBalloonActive: state.goalBalloonUntilMs > 0,
    rodsPerSide: network.rodsPerSide,
    rods: state.rods.map((rod) => ({ id: rod.id, y: rod.y, vy: rod.vy })),
    ball: {
      x: state.ball.x,
      y: state.ball.y,
      vx: state.ball.vx,
      vy: state.ball.vy,
    },
    score: { ...state.score },
    matchDone: state.matchDone,
    statusText: statusTextEl.textContent,
  };
}

function sendToPeer(dataChannel, payload) {
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify(payload));
  }
}

function broadcastSnapshot(nowMs) {
  if (network.mode !== "host") {
    return;
  }

  if (nowMs - network.lastSnapshotSentAt < SNAPSHOT_INTERVAL_MS) {
    return;
  }

  network.lastSnapshotSentAt = nowMs;
  const payload = buildSnapshot();
  for (const peer of network.peers.values()) {
    sendToPeer(peer.dc, payload);
  }
}

function updateHud(statusOverride) {
  scoreLeftEl.textContent = String(state.score.left);
  scoreRightEl.textContent = String(state.score.right);

  if (statusOverride) {
    statusTextEl.textContent = statusOverride;
    return;
  }

  if (!state.matchDone && state.score.left === 0 && state.score.right === 0) {
    statusTextEl.textContent = "First team to 7 wins";
  }
}

function drawField() {
  const lanePadding = 16;
  ctx.clearRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

  const grassBase = ctx.createLinearGradient(0, 0, 0, FIELD_HEIGHT);
  grassBase.addColorStop(0, "#167a54");
  grassBase.addColorStop(0.5, "#17895d");
  grassBase.addColorStop(1, "#116f4d");
  ctx.fillStyle = grassBase;
  ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

  // Bowl tint: brighter in the center and darker toward the boundaries.
  const bowlLight = ctx.createRadialGradient(
    FIELD_WIDTH / 2,
    FIELD_HEIGHT / 2,
    FIELD_WIDTH * 0.08,
    FIELD_WIDTH / 2,
    FIELD_HEIGHT / 2,
    FIELD_WIDTH * 0.62
  );
  bowlLight.addColorStop(0, "rgba(165, 255, 190, 0.22)");
  bowlLight.addColorStop(0.52, "rgba(120, 220, 150, 0.1)");
  bowlLight.addColorStop(1, "rgba(20, 60, 34, 0)");
  ctx.fillStyle = bowlLight;
  ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

  const bowlShadow = ctx.createRadialGradient(
    FIELD_WIDTH / 2,
    FIELD_HEIGHT / 2,
    FIELD_WIDTH * 0.4,
    FIELD_WIDTH / 2,
    FIELD_HEIGHT / 2,
    FIELD_WIDTH * 0.9
  );
  bowlShadow.addColorStop(0, "rgba(0, 0, 0, 0)");
  bowlShadow.addColorStop(1, "rgba(6, 24, 12, 0.32)");
  ctx.fillStyle = bowlShadow;
  ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
  ctx.lineWidth = 4;
  ctx.strokeRect(lanePadding, lanePadding, FIELD_WIDTH - lanePadding * 2, FIELD_HEIGHT - lanePadding * 2);

  ctx.beginPath();
  ctx.moveTo(FIELD_WIDTH / 2, lanePadding);
  ctx.lineTo(FIELD_WIDTH / 2, FIELD_HEIGHT - lanePadding);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(FIELD_WIDTH / 2, FIELD_HEIGHT / 2, 85, 0, Math.PI * 2);
  ctx.stroke();

  const goalTop = FIELD_HEIGHT / 2 - GOAL_HEIGHT / 2;
  const goalBottom = FIELD_HEIGHT / 2 + GOAL_HEIGHT / 2;

  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.fillRect(0, goalTop, 12, GOAL_HEIGHT);
  ctx.fillRect(FIELD_WIDTH - 12, goalTop, 12, GOAL_HEIGHT);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.beginPath();
  ctx.moveTo(0, goalTop);
  ctx.lineTo(64, goalTop);
  ctx.moveTo(0, goalBottom);
  ctx.lineTo(64, goalBottom);
  ctx.moveTo(FIELD_WIDTH, goalTop);
  ctx.lineTo(FIELD_WIDTH - 64, goalTop);
  ctx.moveTo(FIELD_WIDTH, goalBottom);
  ctx.lineTo(FIELD_WIDTH - 64, goalBottom);
  ctx.stroke();
}

function drawRodsAndPlayers() {
  const rodThickness = 8;
  const playerRadius = 22;
  const bodyRadius = 14;
  const footWidth = 12;

  for (const rod of state.rods) {
    const rodColor = rod.team === "left" ? "rgba(42,160,255,0.88)" : "rgba(255,138,61,0.88)";
    const playerColor = rod.team === "left" ? leftTeamColor : rightTeamColor;
    const facingDir = rod.team === "left" ? 1 : -1;
    const isSpinning = effectiveSpinForRod(rod);
    const visibleReach = rod.footReach;

    ctx.strokeStyle = rodColor;
    ctx.lineWidth = rodThickness;
    ctx.beginPath();
    ctx.moveTo(rod.x, 20);
    ctx.lineTo(rod.x, FIELD_HEIGHT - 20);
    ctx.stroke();

    for (const offsetY of rod.players) {
      const py = rod.y + offsetY;
      if (py < 25 || py > FIELD_HEIGHT - 25) {
        continue;
      }

      if (isSpinning) {
        const footX = rod.x + facingDir * visibleReach;

        ctx.fillStyle = playerColor;
        ctx.beginPath();
        ctx.arc(footX, py, bodyRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(14, 22, 32, 0.92)";
        ctx.beginPath();
        ctx.roundRect(rod.x - (facingDir < 0 ? visibleReach : 0), py - footWidth / 2, visibleReach, footWidth, 4);
        ctx.fill();

        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.beginPath();
        ctx.arc(footX - facingDir * 3, py - 5, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = playerColor;
      ctx.beginPath();
      ctx.arc(rod.x, py, playerRadius * 0.66, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.beginPath();
      ctx.arc(rod.x - 5, py - 6, 4.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBall() {
  const glow = ctx.createRadialGradient(
    state.ball.x - 2,
    state.ball.y - 2,
    state.ball.r * 0.35,
    state.ball.x,
    state.ball.y,
    state.ball.r * 1.2
  );
  glow.addColorStop(0, "#ffffff");
  glow.addColorStop(1, "#ffd67f");

  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(state.ball.x, state.ball.y, state.ball.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawGoalBalloon() {
  if (!state.goalBalloonText) {
    return;
  }

  const text = state.goalBalloonText;
  ctx.save();
  ctx.font = "700 52px 'Bebas Neue', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const textWidth = ctx.measureText(text).width;
  const bubbleWidth = textWidth + 70;
  const bubbleHeight = 86;
  const x = FIELD_WIDTH / 2 - bubbleWidth / 2;
  const y = 42;
  const balloonFill =
    state.goalBalloonTeam === "right" ? "rgba(255, 138, 61, 0.94)" : "rgba(42, 160, 255, 0.94)";

  ctx.fillStyle = balloonFill;
  ctx.strokeStyle = "rgba(18, 32, 46, 0.85)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, bubbleWidth, bubbleHeight, 24);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(FIELD_WIDTH / 2 - 24, y + bubbleHeight);
  ctx.lineTo(FIELD_WIDTH / 2, y + bubbleHeight + 24);
  ctx.lineTo(FIELD_WIDTH / 2 + 24, y + bubbleHeight);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#0d2438";
  ctx.fillText(text, FIELD_WIDTH / 2, y + bubbleHeight / 2 + 1);
  ctx.restore();
}

function closePeer(peerInfo) {
  if (!peerInfo) {
    return;
  }
  try {
    peerInfo.dc?.close();
  } catch (_) {
    // noop
  }
  try {
    peerInfo.pc?.close();
  } catch (_) {
    // noop
  }
}

function closeAllNetworkConnections() {
  for (const peer of network.peers.values()) {
    closePeer(peer);
  }
  for (const pending of network.pendingOffers.values()) {
    closePeer(pending);
  }
  network.peers.clear();
  network.pendingOffers.clear();

  closePeer(network.clientConnection);
  network.clientConnection = null;
}

function applyModeVisibility() {
  document.body.dataset.netMode = network.mode;
  if (rodsPerSideEl) {
    rodsPerSideEl.disabled = network.mode !== "host";
  }
  if (leftTeamNameInputEl) {
    leftTeamNameInputEl.disabled = network.mode !== "host";
  }
  if (rightTeamNameInputEl) {
    rightTeamNameInputEl.disabled = network.mode !== "host";
  }
  if (startGameBtn) {
    startGameBtn.disabled = network.mode !== "host" || state.gameStarted;
  }
}

function refreshRoleText() {
  if (network.mode === "host") {
    setRoleText(`Role: Host (W/S on ${rodLabel(network.hostAssignedRodId)})`);
    return;
  }

  if (network.mode === "client") {
    const label = network.clientAssignedRodId ? rodLabel(network.clientAssignedRodId) : "waiting assignment";
    setRoleText(`Role: Joiner (${label})`);
  }
}

function setMode(nextMode) {
  network.mode = nextMode;
  netModeEl.value = nextMode;
  setGameStarted(false);
  closeAllNetworkConnections();
  clearRodOwners();
  network.clientAssignedRodId = null;
  offerOutEl.value = "";
  answerOutEl.value = "";
  applyModeVisibility();

  if (nextMode === "host") {
    setNetStatus("Host mode: create offer, share it, then apply answer");
  } else {
    setNetStatus("Join mode: paste host offer and create answer");
  }

  refreshRoleText();
}

function waitForIceComplete(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const onState = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onState);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onState);
    setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", onState);
      resolve();
    }, 3500);
  });
}

function getRodById(rodId) {
  return state.rods.find((rod) => rod.id === rodId) ?? null;
}

function assignRodToPeer(rodId, peerId) {
  const rod = getRodById(rodId);
  if (!rod) {
    return;
  }

  for (const other of state.rods) {
    if (other.ownerPeerId === peerId) {
      other.ownerPeerId = null;
      other.remoteInput.up = false;
      other.remoteInput.down = false;
      other.remoteInput.spin = false;
    }
  }

  rod.ownerPeerId = peerId;
  rod.remoteInput.up = false;
  rod.remoteInput.down = false;
  rod.remoteInput.spin = false;
}

function unassignPeer(peerId) {
  for (const rod of state.rods) {
    if (rod.ownerPeerId === peerId) {
      rod.ownerPeerId = null;
      rod.remoteInput.up = false;
      rod.remoteInput.down = false;
      rod.remoteInput.spin = false;
    }
  }
}

function handleHostData(peerId, message) {
  if (message.type === "input") {
    const rod = getRodById(message.rodId);
    if (!rod || rod.ownerPeerId !== peerId) {
      return;
    }
    rod.remoteInput.up = !!message.up;
    rod.remoteInput.down = !!message.down;
    rod.remoteInput.spin = !!message.spin;
  }

  if (message.type === "reset") {
    resetMatch();
  }
}

function handleClientData(message) {
  if (message.type === "snapshot") {
    applySnapshot(message);
    return;
  }

  if (message.type === "welcome") {
    if (typeof message.gameStarted === "boolean") {
      setGameStarted(message.gameStarted);
    }

    if (message.teamNames) {
      setTeamNames(message.teamNames);
    }

    if (typeof message.rodsPerSide === "number") {
      network.rodsPerSide = normalizeRodsPerSide(message.rodsPerSide);
      if (rodsPerSideEl) {
        rodsPerSideEl.value = String(network.rodsPerSide);
      }
      applyRodLayout(network.rodsPerSide);
    }
    network.clientAssignedRodId = message.assignedRodId;
    refreshRoleText();
    setNetStatus(`Connected to host. Assigned: ${rodLabel(message.assignedRodId)}`);
  }
}

function setupHostDataChannel(peerId, rodId, dataChannel, pc) {
  const peerInfo = { pc, dc: dataChannel, peerId, rodId };
  network.peers.set(peerId, peerInfo);
  assignRodToPeer(rodId, peerId);

  dataChannel.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      handleHostData(peerId, parsed);
    } catch (_) {
      // noop
    }
  };

  dataChannel.onopen = () => {
    sendToPeer(dataChannel, {
      type: "welcome",
      gameStarted: state.gameStarted,
      assignedRodId: rodId,
      rodsPerSide: network.rodsPerSide,
      teamNames: { ...state.teamNames },
    });
    sendToPeer(dataChannel, buildSnapshot());
    setNetStatus(`Host connected players: ${network.peers.size}`);
  };

  dataChannel.onclose = () => {
    unassignPeer(peerId);
    network.peers.delete(peerId);
    setNetStatus(`Host connected players: ${network.peers.size}`);
  };

  pc.onconnectionstatechange = () => {
    if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
      unassignPeer(peerId);
      network.peers.delete(peerId);
      setNetStatus(`Host connected players: ${network.peers.size}`);
    }
  };
}

async function createOfferForJoiner() {
  if (network.mode !== "host") {
    setNetStatus("Switch mode to Host first");
    return;
  }

  const assignedRodId = assignRodSelectEl.value;
  const peerId = `p-${Math.random().toString(36).slice(2, 8)}`;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  const dc = pc.createDataChannel("pebolim");
  setupHostDataChannel(peerId, assignedRodId, dc, pc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceComplete(pc);

  network.pendingOffers.set(peerId, { pc, dc, rodId: assignedRodId, peerId });

  const payload = {
    type: "offer",
    peerId,
    gameStarted: state.gameStarted,
    assignedRodId,
    rodsPerSide: network.rodsPerSide,
    teamNames: { ...state.teamNames },
    sdp: pc.localDescription,
  };

  offerOutEl.value = JSON.stringify(payload, null, 2);
  setNetStatus(`Offer created for ${rodLabel(assignedRodId)}. Waiting for answer...`);
}

async function applyJoinerAnswer() {
  if (network.mode !== "host") {
    setNetStatus("Switch mode to Host first");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(answerInEl.value);
  } catch (_) {
    setNetStatus("Answer JSON is invalid");
    return;
  }

  if (payload.type !== "answer" || !payload.peerId || !payload.sdp) {
    setNetStatus("Answer JSON missing required fields");
    return;
  }

  const pending = network.pendingOffers.get(payload.peerId);
  if (!pending) {
    setNetStatus("No matching pending offer for this peerId");
    return;
  }

  await pending.pc.setRemoteDescription(payload.sdp);
  network.pendingOffers.delete(payload.peerId);
  answerInEl.value = "";
  setNetStatus(`Joiner connected on ${rodLabel(pending.rodId)}. Connected players: ${network.peers.size}`);
}

async function createAnswerFromOffer() {
  if (network.mode !== "client") {
    setNetStatus("Switch mode to Join first");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(offerInEl.value);
  } catch (_) {
    setNetStatus("Offer JSON is invalid");
    return;
  }

  if (payload.type !== "offer" || !payload.peerId || !payload.assignedRodId || !payload.sdp) {
    setNetStatus("Offer JSON missing required fields");
    return;
  }

  if (typeof payload.gameStarted === "boolean") {
    setGameStarted(payload.gameStarted);
  }

  if (typeof payload.rodsPerSide === "number") {
    network.rodsPerSide = normalizeRodsPerSide(payload.rodsPerSide);
    if (rodsPerSideEl) {
      rodsPerSideEl.value = String(network.rodsPerSide);
    }
    applyRodLayout(network.rodsPerSide);
  }

  if (payload.teamNames) {
    setTeamNames(payload.teamNames);
  }

  closePeer(network.clientConnection);
  network.clientConnection = null;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  network.clientAssignedRodId = payload.assignedRodId;

  pc.ondatachannel = (event) => {
    const dc = event.channel;
    dc.onmessage = (msgEvent) => {
      try {
        const parsed = JSON.parse(msgEvent.data);
        handleClientData(parsed);
      } catch (_) {
        // noop
      }
    };

    dc.onopen = () => {
      setNetStatus(`Connected to host. Assigned: ${rodLabel(network.clientAssignedRodId)}`);
      refreshRoleText();
    };

    dc.onclose = () => {
      setNetStatus("Disconnected from host");
      network.clientAssignedRodId = null;
      refreshRoleText();
    };

    network.clientConnection = {
      pc,
      dc,
      peerId: payload.peerId,
      rodId: payload.assignedRodId,
      lastInput: { up: false, down: false, spin: false },
    };
  };

  await pc.setRemoteDescription(payload.sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceComplete(pc);

  const answerPayload = {
    type: "answer",
    peerId: payload.peerId,
    gameStarted: state.gameStarted,
    assignedRodId: payload.assignedRodId,
    rodsPerSide: network.rodsPerSide,
    teamNames: { ...state.teamNames },
    sdp: pc.localDescription,
  };

  answerOutEl.value = JSON.stringify(answerPayload, null, 2);
  setNetStatus("Answer created. Send it back to host.");
  refreshRoleText();
}

function syncClientInput() {
  if (network.mode !== "client" || !network.clientConnection || !network.clientAssignedRodId) {
    return;
  }

  const dc = network.clientConnection.dc;
  if (!dc || dc.readyState !== "open") {
    return;
  }

  const up = !!keyState.KeyW;
  const down = !!keyState.KeyS;
  const spin = !!keyState.Space;
  const last = network.clientConnection.lastInput;

  if (last.up === up && last.down === down && last.spin === spin) {
    return;
  }

  network.clientConnection.lastInput = { up, down, spin };
  sendToPeer(dc, {
    type: "input",
    rodId: network.clientAssignedRodId,
    up,
    down,
    spin,
  });
}

function stepGame(nowMs) {
  if (network.mode === "host" && state.gameStarted) {
    updateRods();
    updateBall(nowMs);
  }

  if (network.mode === "client") {
    syncClientInput();
  }

  if (network.mode === "host") {
    broadcastSnapshot(nowMs);
  }

  drawField();
  drawGoalBalloon();
  drawRodsAndPlayers();
  drawBall();

  requestAnimationFrame(stepGame);
}

function setInfoModalOpen(isOpen) {
  if (!infoModal) {
    return;
  }
  infoModal.classList.toggle("is-open", isOpen);
  infoModal.setAttribute("aria-hidden", isOpen ? "false" : "true");
  document.body.classList.toggle("modal-open", isOpen);
}

window.addEventListener("keydown", (event) => {
  keyState[event.code] = true;

  if (["ArrowUp", "ArrowDown", "Space"].includes(event.code)) {
    event.preventDefault();
  }

  if (network.mode === "client") {
    syncClientInput();
  }
});

window.addEventListener("keyup", (event) => {
  keyState[event.code] = false;

  if (network.mode === "client") {
    syncClientInput();
  }
});

resetBtn.addEventListener("click", () => {
  if (network.mode === "client") {
    sendToPeer(network.clientConnection?.dc, { type: "reset" });
    return;
  }
  resetMatch();
});

netModeEl.addEventListener("change", () => {
  setMode(netModeEl.value);
});

hostRodSelectEl.addEventListener("change", () => {
  network.hostAssignedRodId = hostRodSelectEl.value;
  if (network.mode === "host") {
    refreshRoleText();
  }
});

leftTeamNameInputEl?.addEventListener("input", () => {
  if (network.mode !== "host") {
    leftTeamNameInputEl.value = state.teamNames.left;
    return;
  }
  setTeamNames({ left: leftTeamNameInputEl.value, right: state.teamNames.right }, false);
});

rightTeamNameInputEl?.addEventListener("input", () => {
  if (network.mode !== "host") {
    rightTeamNameInputEl.value = state.teamNames.right;
    return;
  }
  setTeamNames({ left: state.teamNames.left, right: rightTeamNameInputEl.value }, false);
});

startGameBtn?.addEventListener("click", () => {
  if (network.mode !== "host") {
    return;
  }

  if (state.gameStarted) {
    return;
  }

  setGameStarted(true);
  setNetStatus("Match started");
  updateHud("First team to 7 wins");
  broadcastSnapshot(performance.now());
});

rodsPerSideEl?.addEventListener("change", () => {
  configureHostRodsPerSide(rodsPerSideEl.value);
});

createOfferBtn?.addEventListener("click", () => {
  createOfferForJoiner().catch(() => {
    setNetStatus("Failed to create offer");
  });
});

applyAnswerBtn?.addEventListener("click", () => {
  applyJoinerAnswer().catch(() => {
    setNetStatus("Failed to apply answer");
  });
});

createAnswerBtn?.addEventListener("click", () => {
  createAnswerFromOffer().catch(() => {
    setNetStatus("Failed to create answer");
  });
});

openInfoBtn?.addEventListener("click", () => {
  setInfoModalOpen(true);
});

closeInfoBtn?.addEventListener("click", () => {
  setInfoModalOpen(false);
});

infoModal?.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset.closeInfo === "true") {
    setInfoModalOpen(false);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && infoModal?.classList.contains("is-open")) {
    setInfoModalOpen(false);
  }
});

if (rodsPerSideEl) {
  rodsPerSideEl.value = String(network.rodsPerSide);
}
setTeamNames(state.teamNames);
setGameStarted(false);
refreshRodSelectors();
updateHud();
setMode("host");
stepGame();
