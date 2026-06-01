# Grafikonator 6000 - Convention Scheduling

A convention scheduling app built with SvelteKit. Import Google Forms CSV submissions, auto-schedule panels/workshops by host availability, and drag events on a room grid.

## Features

- **CSV import wizard** — upload Google Forms exports, map columns (e.g. "Pseudonim" → display name)
- **3-tier availability** — Can (100%) / Rather not / Can't (100%)
- **Events & hosts** — each submission becomes an event assigned to its host
- **30 or 60-minute slots** — configurable per convention
- **Auto-scheduling** — places events in rooms respecting host availability
- **Schedule grid** — drag to move or swap events; hours-per-person sidebar
- **Local SQLite** — no external services required

## Setup

```bash
pnpm install
pnpm dev
```

Visit `http://localhost:5173`, sign up, then go to **Setup** to import your CSV.

Optional: copy `.env.example` to `.env` to customize the database path:

```env
DATABASE_PATH=./data/grafikonator.db
```

## Usage

1. **Setup** (`/setup`) — upload CSV, map fields, set convention dates & rooms, import
2. **Schedule** (`/schedule`) — auto-schedule all, drag events, view hours per person

### CSV field mapping

The wizard auto-detects common Polish Google Forms headers:

| CSV column | App field |
|---|---|
| Pseudonim | Display name |
| Tytuł atrakcji | Event title |
| Dyspozycyjność… | Availability |
| Czas trwania… | Duration |

Availability strings like `sobota (30/09) 18:00 - 22:00` are parsed into time ranges and matched to generated slots.

## Tech stack

- SvelteKit 5, Tailwind CSS, shadcn-svelte
- SQLite (better-sqlite3), papaparse for CSV
- @neodrag/svelte for drag-and-drop

## Production

```bash
pnpm build
pnpm start
```

Back up the `data/` directory regularly.
