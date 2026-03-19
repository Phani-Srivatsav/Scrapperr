# Scraper Architecture SOP

## Goal
Fetch latest newsletters (within 24 hours) from target sources and normalize them to the `gemini.md` schema.

## Sources
1. **Ben's Bites** (e.g. `https://bensbites.co/` or Beehiiv feed)
2. **The AI Rundown** (e.g. `https://www.therundown.ai/`)

## Inputs
- Execution trigger (Manual run of `python tools/scraper.py`)

## Outputs
- `d:/ANTI-GRAVITY/Scrapperr/.tmp/articles.json`
- Follows the exact Array schema defined in `gemini.md`.

## Tool Logic
1. Initialize `.tmp/` directory if missing.
2. Request HTML or RSS content from each source.
3. Parse latest article links, titles, published dates, and summaries.
4. Filter out any articles older than 24 hours from current UTC time.
5. Format into the required JSON array with `id` (uuid4), `source`, `title`, `url`, `published_at`, `summary`.
6. Write payload to `.tmp/articles.json`.

## Edge Cases
- **Missing Elements**: (Self-Healing target) If DOM parsing fails due to UI updates, log error, skip source, do not crash process.
- **Date Parsing**: Standardize to ISO-8601 UTC.
- **Network Errors**: 10-second timeout on requests.
