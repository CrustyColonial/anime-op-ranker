# Anime Opening Tier Ranker

A rebuild of an old middle-school project: press Start, get a random anime
opening, and rank it into a slot from 1–N before the next one loads.
Repeat until every slot is filled.

## What changed from the original

The original used YouTube embeds pointed at a personal playlist as a
"repository" — which breaks the moment videos get taken down or
re-uploaded elsewhere (exactly what happened with Crunchyroll re-uploads).

This version pulls directly from **[AnimeThemes.moe](https://animethemes.moe)**,
a free, public database that hosts direct WebM files of anime OPs/EDs
specifically for use in projects like this one. No API key, no server,
no playlist maintenance — `app.js` just asks their API for N random
themes and plays the video URLs it gets back straight in a `<video>` tag.

Because there's no backend, this is 100% static — it can be hosted for
free on GitHub Pages.

## Project structure

```
anime-op-ranker/
├── index.html   # markup for the 3 screens (start / game / results)
├── style.css    # dark theme styling
├── app.js       # API fetching + game state machine
└── README.md
```

## Running it locally

No build step. Just open `index.html` in a browser, or serve the folder:

```bash
# from inside anime-op-ranker/
python3 -m http.server 8000
# then visit http://localhost:8000
```

(Opening `index.html` directly with `file://` also works for this
project since it only makes `fetch()` calls to a CORS-friendly public
API — no local file access needed.)

## Deploying to GitHub Pages

1. Create a new repo on GitHub (e.g. `anime-op-ranker`), **without**
   initializing it with a README (this folder already has one).
2. From inside this folder:
   ```bash
   git remote add origin https://github.com/<your-username>/anime-op-ranker.git
   git branch -M main
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source → Deploy from branch →
   `main` / `root`**. Save.
4. Your site will be live at
   `https://<your-username>.github.io/anime-op-ranker/` after a minute
   or two.

## How the ranking works

- On Start, the app requests `count` random anime themes (OP, ED, or
  both — your choice) from AnimeThemes, filtered to only themes that
  have a working video, and deduplicated by anime so you don't get two
  openings from the same show back to back.
- Each theme plays automatically. Click one of the numbered slots on
  the left to lock the currently-playing theme into that rank — the
  next theme loads immediately.
- **Skip** sends the current theme to the back of the queue instead of
  ranking it, so you can revisit it later without losing your place.
- Once every slot is filled, you get a results screen with a copyable
  text list of your final ranking.

## Ideas for later (not implemented, to keep v1 shippable in a day)

- **Swap-to-reorder**: clicking an already-filled slot could bump that
  theme back into the queue instead of being a no-op, so you can
  freely re-rank instead of committing permanently.
- **Filters**: by decade, genre, or "only shows I've watched" (would
  need pairing with a MyAnimeList/AniList username lookup).
- **Persisting results**: save past rounds to `localStorage` so you can
  build a running all-time ranking across sessions.
- **Share card**: render the final ranking as an image (canvas) instead
  of just text, for easier sharing.

## API reference

Docs: https://api-docs.animethemes.moe/ — the JSON:API used here
(`GET /animetheme`) is marked deprecated in favor of a newer GraphQL
endpoint, but is still live and simpler for a small static project.
If AnimeThemes eventually removes it, `fetchThemeBatch()` in `app.js`
is the only place that needs to change — swap it for a GraphQL query
against `https://graphql.animethemes.moe/graphiql`.
