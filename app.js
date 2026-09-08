/* =========================================================================
   Anime Opening Tier Ranker
   Pulls anime OP/ED clips from the AnimeThemes.moe public API
   (https://api-docs.animethemes.moe/) and lets you either tier-rank them
   or run them through a single-elimination bracket tournament.

   No server, no API key, no YouTube -- AnimeThemes hosts direct WebM
   files, so this just plays them straight in a <video> tag.
   ========================================================================= */

const API_BASE = "https://api.animethemes.moe";

const FETCH_MULTIPLIER = 3;
const MAX_FETCH_ATTEMPTS = 4;
const LOW_RES_TARGET = 480;

const POPULAR_ANIME = [
  "Fullmetal Alchemist: Brotherhood",
  "Attack on Titan",
  "Death Note",
  "Naruto",
  "One Piece",
  "Demon Slayer: Kimetsu no Yaiba",
  "My Hero Academia",
  "Jujutsu Kaisen",
  "Cowboy Bebop",
  "Steins;Gate",
  "Hunter x Hunter (2011)",
  "Code Geass: Lelouch of the Rebellion",
  "One Punch Man",
  "Tokyo Ghoul",
  "Bleach",
  "Dragon Ball Z",
  "Neon Genesis Evangelion",
  "Mob Psycho 100",
  "Vinland Saga",
  "Chainsaw Man",
  "Spy x Family",
  "Violet Evergarden",
  "Re:ZERO -Starting Life in Another World-",
  "Made in Abyss",
  "The Promised Neverland",
  "Haikyu!!",
  "Fruits Basket",
  "Your Lie in April",
  "Sword Art Online",
  "Toradora!",
  "Fate/Zero",
  "Black Clover",
  "Assassination Classroom",
];

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const state = {
  total: 10,
  queue: [],
  slots: [],
  current: null,

  bracket: {
    matches: [],
    index: 0,
    nextWinners: [],
    history: [],
    champion: null,
  },
};

// ---------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------
const els = {
  startScreen: document.getElementById("start-screen"),
  gameScreen: document.getElementById("game-screen"),
  resultsScreen: document.getElementById("results-screen"),
  bracketScreen: document.getElementById("bracket-screen"),
  bracketResultsScreen: document.getElementById("bracket-results-screen"),

  modeSelect: document.getElementById("mode-select"),
  countRow: document.getElementById("count-row"),
  countSelect: document.getElementById("count-select"),
  typeSelect: document.getElementById("type-select"),
  sourceSelect: document.getElementById("source-select"),
  qualitySelect: document.getElementById("quality-select"),
  startBtn: document.getElementById("start-btn"),
  startStatus: document.getElementById("start-status"),

  rankList: document.getElementById("rank-list"),
  player: document.getElementById("player"),
  videoOverlay: document.getElementById("video-overlay"),
  videoOverlayText: document.getElementById("video-overlay-text"),
  progressLine: document.getElementById("progress-line"),
  skipBtn: document.getElementById("skip-btn"),

  resultsList: document.getElementById("results-list"),
  copyBtn: document.getElementById("copy-btn"),
  restartBtn: document.getElementById("restart-btn"),

  bracketRoundLine: document.getElementById("bracket-round-line"),
  videoA: document.getElementById("bracket-video-a"),
  videoB: document.getElementById("bracket-video-b"),
  nameA: document.getElementById("bracket-name-a"),
  nameB: document.getElementById("bracket-name-b"),
  unmuteA: document.getElementById("bracket-unmute-a"),
  unmuteB: document.getElementById("bracket-unmute-b"),
  chooseA: document.getElementById("bracket-choose-a"),
  chooseB: document.getElementById("bracket-choose-b"),

  championName: document.getElementById("bracket-champion-name"),
  bracketHistory: document.getElementById("bracket-history"),
  bracketCopyBtn: document.getElementById("bracket-copy-btn"),
  bracketRestartBtn: document.getElementById("bracket-restart-btn"),
};

// ---------------------------------------------------------------------
// Mode toggle (hide theme-count when running a fixed-size bracket)
// ---------------------------------------------------------------------
els.modeSelect.addEventListener("change", () => {
  const isBracket = els.modeSelect.value === "bracket";
  els.countRow.classList.toggle("hidden", isBracket);
});

// ---------------------------------------------------------------------
// Video quality helper
// ---------------------------------------------------------------------
function pickVideoLink(entries, preferLowRes) {
  const all = [];
  for (const entry of entries || []) {
    for (const v of entry.videos || []) {
      if (v.link) all.push(v);
    }
  }
  if (all.length === 0) return null;

  const withRes = all.map((v) => ({
    link: v.link,
    res: typeof v.resolution === "number" ? v.resolution : Infinity,
  }));
  withRes.sort((a, b) => a.res - b.res);

  if (preferLowRes) {
    const underTarget = withRes.filter((v) => v.res <= LOW_RES_TARGET);
    if (underTarget.length > 0) {
      return underTarget[underTarget.length - 1].link;
    }
    return withRes[0].link;
  }

  return withRes[withRes.length - 1].link;
}

// ---------------------------------------------------------------------
// API -- random selection
// ---------------------------------------------------------------------
function buildThemeUrl({ typeFilter, pageSize }) {
  const params = [
    "include=anime,song,animethemeentries.videos",
    "filter[has]=animethemeentries.videos",
    `sort=random`,
    `page[size]=${pageSize}`,
  ];
  if (typeFilter) {
    params.push(`filter[type]=${encodeURIComponent(typeFilter)}`);
  }
  return `${API_BASE}/animetheme?${params.join("&")}`;
}

async function fetchThemeBatch(typeFilter, pageSize, preferLowRes) {
  const url = buildThemeUrl({ typeFilter, pageSize });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`AnimeThemes API returned ${res.status}`);
  }
  const data = await res.json();
  const raw = data.animethemes || [];

  const normalized = [];
  for (const theme of raw) {
    if (!theme.anime || !theme.anime.name) continue;
    const videoUrl = pickVideoLink(theme.animethemeentries, preferLowRes);
    if (!videoUrl) continue;

    normalized.push({
      id: theme.id,
      animeId: theme.anime.id,
      animeName: theme.anime.name,
      songTitle: (theme.song && theme.song.title) || theme.slug,
      type: theme.type,
      videoUrl,
    });
  }
  return normalized;
}

async function fetchRandomThemes(count, typeFilter, preferLowRes) {
  const collected = new Map();
  let attempts = 0;

  while (collected.size < count && attempts < MAX_FETCH_ATTEMPTS) {
    attempts++;
    const pageSize = Math.min((count - collected.size) * FETCH_MULTIPLIER + 5, 100);
    let batch;
    try {
      batch = await fetchThemeBatch(typeFilter, pageSize, preferLowRes);
    } catch (err) {
      console.error("Fetch attempt failed:", err);
      continue;
    }
    for (const theme of batch) {
      if (!collected.has(theme.animeId)) {
        collected.set(theme.animeId, theme);
      }
      if (collected.size >= count) break;
    }
  }

  const themes = Array.from(collected.values());
  shuffle(themes);
  return themes.slice(0, count);
}

// ---------------------------------------------------------------------
// API -- "top of the charts" selection (curated pool, looked up by name)
// ---------------------------------------------------------------------
async function fetchThemesForAnimeName(name, typeFilter, preferLowRes) {
  const params = [
    `filter[name]=${encodeURIComponent(name)}`,
    "include=animethemes.song,animethemes.animethemeentries.videos",
    "page[size]=1",
  ];
  const url = `${API_BASE}/anime?${params.join("&")}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const anime = (data.anime || [])[0];
  if (!anime) return null;

  const wantedTypes = typeFilter ? typeFilter.split(",") : null;
  let themes = anime.animethemes || [];
  if (wantedTypes) {
    themes = themes.filter((t) => wantedTypes.includes(t.type));
  }
  if (themes.length === 0) return null;

  shuffle(themes);
  for (const theme of themes) {
    const videoUrl = pickVideoLink(theme.animethemeentries, preferLowRes);
    if (videoUrl) {
      return {
        id: theme.id,
        animeId: anime.id,
        animeName: anime.name,
        songTitle: (theme.song && theme.song.title) || theme.slug,
        type: theme.type,
        videoUrl,
      };
    }
  }
  return null;
}

async function fetchTopChartsThemes(count, typeFilter, preferLowRes) {
  const pool = [...POPULAR_ANIME];
  shuffle(pool);

  const collected = [];
  for (const name of pool) {
    if (collected.length >= count) break;
    try {
      const theme = await fetchThemesForAnimeName(name, typeFilter, preferLowRes);
      if (theme) collected.push(theme);
    } catch (err) {
      console.error(`Lookup failed for "${name}":`, err);
    }
  }
  return collected;
}

function fetchRoundThemes(count, typeFilter, source, preferLowRes) {
  return source === "top"
    ? fetchTopChartsThemes(count, typeFilter, preferLowRes)
    : fetchRandomThemes(count, typeFilter, preferLowRes);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------------------------------------------------------------------
// Screen helpers
// ---------------------------------------------------------------------
function showScreen(name) {
  els.startScreen.classList.toggle("hidden", name !== "start");
  els.gameScreen.classList.toggle("hidden", name !== "game");
  els.resultsScreen.classList.toggle("hidden", name !== "results");
  els.bracketScreen.classList.toggle("hidden", name !== "bracket");
  els.bracketResultsScreen.classList.toggle("hidden", name !== "bracket-results");
}

// ---------------------------------------------------------------------
// Start flow
// ---------------------------------------------------------------------
els.startBtn.addEventListener("click", async () => {
  const mode = els.modeSelect.value;
  const typeFilter = els.typeSelect.value;
  const source = els.sourceSelect.value;
  const preferLowRes = els.qualitySelect.value === "low";
  const count = mode === "bracket" ? 8 : parseInt(els.countSelect.value, 10);

  els.startBtn.disabled = true;
  els.startStatus.textContent =
    source === "top" ? "Looking up popular openings..." : "Fetching random openings...";

  try {
    const themes = await fetchRoundThemes(count, typeFilter, source, preferLowRes);

    if (mode === "bracket") {
      if (themes.length < 8) {
        els.startStatus.textContent =
          `Only found ${themes.length}/8 usable themes for a bracket -- try Random selection, or a broader theme type.`;
        els.startBtn.disabled = false;
        return;
      }
      beginBracket(themes.slice(0, 8));
      return;
    }

    if (themes.length === 0) {
      els.startStatus.textContent = "Couldn't find any usable themes. Try again?";
      els.startBtn.disabled = false;
      return;
    }
    if (themes.length < count) {
      els.startStatus.textContent =
        `Could only find ${themes.length} usable themes -- starting with those.`;
    }
    beginRound(themes);
  } catch (err) {
    console.error(err);
    els.startStatus.textContent = "Something went wrong fetching themes. Try again?";
    els.startBtn.disabled = false;
  }
});

// =======================================================================
// TIER RANKING MODE
// =======================================================================
function beginRound(themes) {
  state.total = themes.length;
  state.queue = themes;
  state.slots = new Array(state.total).fill(null);
  state.current = null;

  buildRankRail();
  showScreen("game");
  loadNextTheme();

  els.startBtn.disabled = false;
  els.startStatus.textContent = "";
}

function buildRankRail() {
  els.rankList.innerHTML = "";
  for (let i = 0; i < state.total; i++) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "rank-slot";
    btn.dataset.index = String(i);
    btn.innerHTML = `<span class="rank-num">${i + 1}</span><span class="rank-title">-</span>`;
    btn.addEventListener("click", () => placeCurrentInSlot(i));
    li.appendChild(btn);
    els.rankList.appendChild(li);
  }
}

function refreshRankRail() {
  const buttons = els.rankList.querySelectorAll(".rank-slot");
  buttons.forEach((btn, i) => {
    const theme = state.slots[i];
    const titleEl = btn.querySelector(".rank-title");
    if (theme) {
      titleEl.textContent = `${theme.animeName} -- ${theme.songTitle}`;
      btn.classList.add("filled");
      btn.disabled = true;
    } else {
      titleEl.textContent = "-";
      btn.classList.remove("filled");
      btn.disabled = false;
    }
  });
}

function placeCurrentInSlot(index) {
  if (!state.current || state.slots[index]) return;
  state.slots[index] = state.current;
  refreshRankRail();

  if (state.queue.length === 0) {
    finishRound();
  } else {
    loadNextTheme();
  }
}

function loadNextTheme() {
  if (state.queue.length === 0) {
    finishRound();
    return;
  }
  const theme = state.queue.shift();
  state.current = theme;

  const placedCount = state.slots.filter(Boolean).length;
  els.progressLine.textContent = `Theme ${placedCount + 1} of ${state.total}`;

  hideOverlay();
  els.player.src = theme.videoUrl;
  els.player.loop = true;
  els.player.muted = false;
  const playPromise = els.player.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(() => {
      els.player.muted = true;
      els.player.play().catch(() => {});
    });
  }
}

els.player.addEventListener("error", () => {
  showOverlay("This clip failed to load -- skipping to the next one.");
  setTimeout(() => {
    if (state.queue.length > 0) {
      loadNextTheme();
    }
  }, 800);
});

els.skipBtn.addEventListener("click", () => {
  if (!state.current) return;
  state.queue.push(state.current);
  loadNextTheme();
});

function showOverlay(text) {
  els.videoOverlayText.textContent = text;
  els.videoOverlay.classList.remove("hidden");
}
function hideOverlay() {
  els.videoOverlay.classList.add("hidden");
}

function finishRound() {
  els.player.pause();
  els.player.src = "";
  showScreen("results");

  els.resultsList.innerHTML = "";
  state.slots.forEach((theme) => {
    const li = document.createElement("li");
    li.textContent = theme ? `${theme.animeName} -- ${theme.songTitle}` : "-";
    els.resultsList.appendChild(li);
  });
}

els.copyBtn.addEventListener("click", async () => {
  const lines = state.slots.map(
    (theme, i) => `${i + 1}. ${theme ? `${theme.animeName} -- ${theme.songTitle}` : "-"}`
  );
  const text = lines.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    els.copyBtn.textContent = "Copied!";
    setTimeout(() => (els.copyBtn.textContent = "Copy as text"), 1500);
  } catch (err) {
    console.error("Clipboard write failed:", err);
  }
});

els.restartBtn.addEventListener("click", () => {
  showScreen("start");
});

// =======================================================================
// BRACKET TOURNAMENT MODE
// =======================================================================
function pairUp(arr) {
  const pairs = [];
  for (let i = 0; i < arr.length; i += 2) {
    pairs.push([arr[i], arr[i + 1]]);
  }
  return pairs;
}

function roundNameFor(participantCount) {
  if (participantCount === 8) return "Quarterfinal";
  if (participantCount === 4) return "Semifinal";
  if (participantCount === 2) return "Final";
  return "Round";
}

function beginBracket(themes) {
  shuffle(themes);
  state.bracket = {
    participantCount: themes.length,
    matches: pairUp(themes),
    index: 0,
    nextWinners: [],
    history: [],
    champion: null,
  };
  showScreen("bracket");
  renderBracketMatch();

  els.startBtn.disabled = false;
  els.startStatus.textContent = "";
}

function renderBracketMatch() {
  const b = state.bracket;
  const [themeA, themeB] = b.matches[b.index];
  const roundName = roundNameFor(b.participantCount);
  const matchNum = b.index + 1;
  const matchTotal = b.matches.length;
  els.bracketRoundLine.textContent = `${roundName} -- Match ${matchNum} of ${matchTotal}`;

  setBracketSide(els.videoA, els.nameA, themeA);
  setBracketSide(els.videoB, els.nameB, themeB);

  els.videoA.muted = true;
  els.videoB.muted = true;
}

function setBracketSide(videoEl, nameEl, theme) {
  nameEl.textContent = `${theme.animeName} -- ${theme.songTitle}`;
  videoEl.src = theme.videoUrl;
  videoEl.loop = true;
  videoEl.play().catch(() => {});
}

function makeUnmuteHandler(activeVideo, otherVideo) {
  return () => {
    otherVideo.muted = true;
    activeVideo.muted = false;
  };
}
els.unmuteA.addEventListener("click", makeUnmuteHandler(els.videoA, els.videoB));
els.unmuteB.addEventListener("click", makeUnmuteHandler(els.videoB, els.videoA));

[els.videoA, els.videoB].forEach((video, i) => {
  video.addEventListener("error", () => {
    const nameEl = i === 0 ? els.nameA : els.nameB;
    nameEl.textContent += " (failed to load -- you can still pick the other side)";
  });
});

function chooseBracketWinner(side) {
  const b = state.bracket;
  const [themeA, themeB] = b.matches[b.index];
  const winner = side === "a" ? themeA : themeB;
  const loser = side === "a" ? themeB : themeA;

  b.nextWinners.push(winner);
  recordBracketResult(winner, loser);

  b.index++;
  if (b.index < b.matches.length) {
    renderBracketMatch();
    return;
  }

  if (b.nextWinners.length === 1) {
    b.champion = b.nextWinners[0];
    finishBracket();
    return;
  }

  b.participantCount = b.nextWinners.length;
  b.matches = pairUp(b.nextWinners);
  b.index = 0;
  b.nextWinners = [];
  renderBracketMatch();
}

function recordBracketResult(winner, loser) {
  const b = state.bracket;
  const roundName = roundNameFor(b.participantCount);
  let block = b.history.find((h) => h.roundName === roundName);
  if (!block) {
    block = { roundName, results: [] };
    b.history.push(block);
  }
  block.results.push({ winner, loser });
}

els.chooseA.addEventListener("click", () => chooseBracketWinner("a"));
els.chooseB.addEventListener("click", () => chooseBracketWinner("b"));

function finishBracket() {
  els.videoA.pause();
  els.videoB.pause();
  showScreen("bracket-results");

  const b = state.bracket;
  els.championName.textContent = `${b.champion.animeName} -- ${b.champion.songTitle}`;

  els.bracketHistory.innerHTML = "";
  b.history.forEach((block) => {
    const wrap = document.createElement("div");
    wrap.className = "bracket-round-block";
    const h3 = document.createElement("h3");
    h3.textContent = block.roundName;
    wrap.appendChild(h3);
    const ul = document.createElement("ul");
    block.results.forEach(({ winner, loser }) => {
      const li = document.createElement("li");
      li.textContent = `${winner.animeName} beat ${loser.animeName}`;
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    els.bracketHistory.appendChild(wrap);
  });
}

els.bracketCopyBtn.addEventListener("click", async () => {
  const b = state.bracket;
  const lines = [`Champion: ${b.champion.animeName} -- ${b.champion.songTitle}`, ""];
  b.history.forEach((block) => {
    lines.push(block.roundName + ":");
    block.results.forEach(({ winner, loser }) => {
      lines.push(`  ${winner.animeName} beat ${loser.animeName}`);
    });
  });
  const text = lines.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    els.bracketCopyBtn.textContent = "Copied!";
    setTimeout(() => (els.bracketCopyBtn.textContent = "Copy as text"), 1500);
  } catch (err) {
    console.error("Clipboard write failed:", err);
  }
});

els.bracketRestartBtn.addEventListener("click", () => {
  showScreen("start");
});
