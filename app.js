/* =========================================================================
   Anime Opening Tier Ranker
   Pulls random anime OP/ED clips from the AnimeThemes.moe public API
   (https://api-docs.animethemes.moe/) and lets you rank them 1..N.

   No server, no API key, no YouTube — AnimeThemes hosts direct WebM
   files, so this just plays them straight in a <video> tag.
   ========================================================================= */

const API_BASE = "https://api.animethemes.moe";

/** How many extra themes to over-fetch, since some entries lack a
 *  working video link and we also dedupe by anime so you don't get
 *  OP1 and OP2 of the same show back to back. */
const FETCH_MULTIPLIER = 3;
const MAX_FETCH_ATTEMPTS = 4;

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const state = {
  total: 10,           // how many themes this round
  queue: [],            // themes not yet ranked, in play order
  slots: [],            // length === total, null or theme object
  current: null,        // theme currently playing
};

// ---------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------
const els = {
  startScreen: document.getElementById("start-screen"),
  gameScreen: document.getElementById("game-screen"),
  resultsScreen: document.getElementById("results-screen"),

  countSelect: document.getElementById("count-select"),
  typeSelect: document.getElementById("type-select"),
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
};

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

/** Build an /animetheme query string. Brackets are encoded manually
 *  since they're literal characters the AnimeThemes API expects. */
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

/** Pull a batch of themes and normalize them into
 *  { id, animeName, songTitle, videoUrl } — dropping anything without
 *  a usable video link. */
async function fetchThemeBatch(typeFilter, pageSize) {
  const url = buildThemeUrl({ typeFilter, pageSize });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`AnimeThemes API returned ${res.status}`);
  }
  const data = await res.json();
  const raw = data.animethemes || [];

  const normalized = [];
  for (const theme of raw) {
    const entries = theme.animethemeentries || [];
    let videoUrl = null;
    for (const entry of entries) {
      const vid = (entry.videos || []).find((v) => v.link);
      if (vid) {
        videoUrl = vid.link;
        break;
      }
    }
    if (!videoUrl) continue;
    if (!theme.anime || !theme.anime.name) continue;

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

/** Fetch enough distinct-anime themes to fill a round, retrying a few
 *  times since "sort=random" + filters can occasionally hand back
 *  fewer usable entries than requested. */
async function fetchRoundThemes(count, typeFilter) {
  const collected = new Map(); // animeId -> theme
  let attempts = 0;

  while (collected.size < count && attempts < MAX_FETCH_ATTEMPTS) {
    attempts++;
    const pageSize = Math.min((count - collected.size) * FETCH_MULTIPLIER + 5, 100);
    let batch;
    try {
      batch = await fetchThemeBatch(typeFilter, pageSize);
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
}

// ---------------------------------------------------------------------
// Start flow
// ---------------------------------------------------------------------
els.startBtn.addEventListener("click", async () => {
  const count = parseInt(els.countSelect.value, 10);
  const typeFilter = els.typeSelect.value;

  els.startBtn.disabled = true;
  els.startStatus.textContent = "Fetching random openings…";

  try {
    const themes = await fetchRoundThemes(count, typeFilter);
    if (themes.length < count) {
      els.startStatus.textContent =
        `Could only find ${themes.length} usable themes — starting with those.`;
    }
    if (themes.length === 0) {
      els.startStatus.textContent = "Couldn't reach the AnimeThemes API. Try again?";
      els.startBtn.disabled = false;
      return;
    }
    beginRound(themes);
  } catch (err) {
    console.error(err);
    els.startStatus.textContent = "Something went wrong fetching themes. Try again?";
    els.startBtn.disabled = false;
  }
});

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

// ---------------------------------------------------------------------
// Rank rail
// ---------------------------------------------------------------------
function buildRankRail() {
  els.rankList.innerHTML = "";
  for (let i = 0; i < state.total; i++) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "rank-slot";
    btn.dataset.index = String(i);
    btn.innerHTML = `<span class="rank-num">${i + 1}</span><span class="rank-title">—</span>`;
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
      titleEl.textContent = `${theme.animeName} — ${theme.songTitle}`;
      btn.classList.add("filled");
      btn.disabled = true;
    } else {
      titleEl.textContent = "—";
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

// ---------------------------------------------------------------------
// Video playback
// ---------------------------------------------------------------------
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
      // Autoplay with sound blocked — fall back to muted autoplay.
      els.player.muted = true;
      els.player.play().catch(() => {});
    });
  }
}

els.player.addEventListener("error", () => {
  showOverlay("This clip failed to load — skipping to the next one.");
  setTimeout(() => {
    if (state.queue.length > 0) {
      loadNextTheme();
    }
  }, 800);
});

els.skipBtn.addEventListener("click", () => {
  if (!state.current) return;
  state.queue.push(state.current); // send to back of the line, unranked
  loadNextTheme();
});

function showOverlay(text) {
  els.videoOverlayText.textContent = text;
  els.videoOverlay.classList.remove("hidden");
}
function hideOverlay() {
  els.videoOverlay.classList.add("hidden");
}

// ---------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------
function finishRound() {
  els.player.pause();
  els.player.src = "";
  showScreen("results");

  els.resultsList.innerHTML = "";
  state.slots.forEach((theme) => {
    const li = document.createElement("li");
    li.textContent = theme ? `${theme.animeName} — ${theme.songTitle}` : "—";
    els.resultsList.appendChild(li);
  });
}

els.copyBtn.addEventListener("click", async () => {
  const lines = state.slots.map(
    (theme, i) => `${i + 1}. ${theme ? `${theme.animeName} — ${theme.songTitle}` : "—"}`
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
