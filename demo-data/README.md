# Grafikonator Demo Data

Generated from source-shaped convention data with public-safe anonymized names, titles, descriptions, notes, references, and rooms.

## Files

- `demo.csv` - import this as the questionnaire CSV (80 atrakcji, tiery, zróżnicowana dyspozycyjność).
- `enrich-demo-csv.mjs` - skrypt do ponownego nadania tierów i poprawek dyspozycyjności (`node demo-data/enrich-demo-csv.mjs`).
- `demo-human-schedule-anonymized.csv` - anonymized completed schedule reference (if present).
- `synthetic-anime-convention-submissions.csv` - larger fake anime convention submission pool (unscheduled free list, 207 atrakcji, ~266.5 event-hours, realistic mix of fully-flexible and time-restricted hosts).
- `synthetic-anime-convention-rooms.csv` - matching room metadata with capacities and tags.
- `generate-synthetic-anime-convention.mjs` - deterministic Faker-backed generator for the synthetic pool (`node demo-data/generate-synthetic-anime-convention.mjs`).

## Recommended Import Settings

- Name: `Demo Convention 2026`
- Start date: `2026-09-30`
- End date: `2026-10-01`
- Slot size: `30` (lub `60` dla szerszych kart godzinowych)
- **Godziny per dzień** (przykład):
  - Środa 30.09: `10`–`24`
  - Czwartek 01.10: `9`–`18`
- **Popularność godzin (hype slotów)**: kreator ustawia domyślnie `16:00`–`19:00` jako T1 hype, godziny przed `10:00` i od `21:00` jako T3 spokojny, resztę jako T2 neutralny.

## What the demo CSV showcases

| Feature                        | Przykłady w CSV                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Tier atrakcji (T1/T2/T3)**   | Kolumna `Priorytet atrakcji (Tier 1–3)` — m.in. Demo 001/026 = T1, Demo 017 = T2, Demo 003/008 = T3 |
| **Dyspozycyjność zielona**     | `Pasuje mi przez cały konwent` (np. Demo 017)                                                       |
| **Dyspozycyjność żółta**       | `Wolę nie` (Demo 025)                                                                               |
| **Wąskie okna czasowe**        | Demo 002 (sobota wieczór), Demo 004 (weekend wybranych godzin)                                      |
| **Długie atrakcje**            | Demo 012/028/049/052/066 = 90 min; Demo 017 = 2 h                                                   |
| **Popularność godzin**         | Prime time 16:00–19:00 startuje jako T1, wczesne/nocne sloty od 21:00 jako T3, reszta jako T2       |
| **Niezaplanowane + sort tier** | Po imporcie uruchom auto-grafik — w sidebarze widać kolorowe obramowania T1/T2/T3                   |

Po imporcie możesz nadal zmienić **popularność godzin (tier slotów)** w zakładce Konwent albo jeszcze w kroku ustawień importu.

## Rooms

Paste these room names into setup:

```
Main Stage
Auditorium
Workshop Room A
Workshop Room B
Panel Room A
Panel Room B
Panel Room C
Game Room
Console Room
Rhythm Room
Community Room
Activity Hall
Open Area
```

Availability dates were normalized to `30/09` and `01/10`, matching the recommended dates above.

## Synthetic Anime Convention Pool

The `synthetic-anime-convention-submissions.csv` file is intentionally **not scheduled**. It is a free list for sorting together in the app, with enough total duration to fill the suggested 10-room setup for two days:

- Convention window for a **full fill**: set both days to `08:00`-`22:00` (10 rooms x 14 hours x 2 days = **280 room-hours**). Narrower windows (e.g. the `10–24` / `9–18` shown above) leave the pool oversubscribed, so some events stay unscheduled on purpose.
- Event supply: 207 submissions, ~266.5 event-hours (≈95% of 280 room-hours).
- Attendance scale: `20`, `50`, `100`, `200`.
- Room metadata: capacity plus required/preferred tags. The only **hard** room tag in the exported pool is `main_stage`, which now lives on the **Main Stage** room (the headline room, listed first).
- **Availability realism**: most hosts are fully flexible, but a sizeable minority declare specific windows and are treated as unavailable outside them. The plan still fills completely because the flexible majority absorbs the slack.
- **Hype slots & T1 events**: the pool's T1 (headline) events declare availability mainly on Saturday `16:00`-`22:00` and Sunday `12:00`-`15:00`. Marking those slots as T1 hype makes the planner pack T1 events into T1 slots almost perfectly; T2/T3 events stay flexible.

Use `synthetic-anime-convention-rooms.csv` as the room reference when deciding where events can go. The generator validates that every event has at least one compatible room and that every room has enough eligible event-hours to fill the two-day window.
