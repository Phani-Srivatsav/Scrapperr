# Project Constitution

## 1. North Star
A beautiful, interactive dashboard displaying aggregated latest articles/newsletters from various sources (e.g., Ben's Bites, AI Rundown) from the last 24 hours, with the ability to save articles.

## 2. Integrations
- Initial: Web scrapers (no external APIs/keys right now).
- Future: Supabase connection for persistent backend.

## 3. Source of Truth
- Initial: Frontend local storage/state and scraped JSON payload (`.tmp/` locally).
- Future: Supabase database.

## 4. Delivery Payload
- Run scrape every 24 hours.
- If new data, append/display.
- Enable article saving; state persists on refresh.

## 5. Behavioral Rules
- UI MUST be gorgeous, interactive, and beautiful. Premium Vanilla CSS.
- Keep it basic initially (MVP with scrapers).
- Fetch only content from the last 24 hours.
- Strict 3-Layer architecture for python logic.

## Architectural Invariants
1. 3-Layer Architecture must be strictly maintained (`architecture/`, `Navigation`, `tools/`).
2. Tools are deterministic python scripts using `.env` and `.tmp/`.
3. Stop execution on missing defined Data Schemas.
