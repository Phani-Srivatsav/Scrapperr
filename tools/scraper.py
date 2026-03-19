"""
Glaido — Newsletter Scraper
Follows: architecture/scraper_sop.md
Output:  .tmp/articles.json (gemini.md Scraper Output Payload schema)

Sources:
  1. Ben's Bites     — Beehiiv RSS feed
  2. The AI Rundown  — Beehiiv RSS feed / HTML fallback
"""

import json
import os
import sys
import uuid
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
import feedparser
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────
BASE_DIR    = Path(__file__).resolve().parent.parent
TMP_DIR     = BASE_DIR / ".tmp"
OUTPUT_FILE = TMP_DIR / "articles.json"

REQUEST_TIMEOUT   = 10       # seconds (per SOP)
LOOKBACK_HOURS    = 72       # filter window (per SOP)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    )
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("glaido")

# ── Sources ───────────────────────────────────────────────
SOURCES = [
    {
        "name": "Ben's Bites",
        "rss": "https://www.bensbites.com/feed",
        "web": "https://www.bensbites.com",
    },
    {
        "name": "The AI Rundown",
        "json": "https://www.therundown.ai/posts",
        "web": "https://www.therundown.ai",
    },
    {
        "name": "AI News",
        "rss": "https://www.artificialintelligence-news.com/feed/",
        "web": "https://www.artificialintelligence-news.com",
    },
    {
        "name": "TLDR Tech",
        "rss": "https://tldr.tech/rss",
        "web": "https://tldr.tech",
    },
    {
        "name": "The Neuron",
        "rss": "https://www.theneuron.ai/feed",
        "web": "https://www.theneuron.ai",
    },
]

# ── Helpers ───────────────────────────────────────────────

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def parse_dt(entry) -> datetime | None:
    """Extract a timezone-aware datetime from a feedparser entry."""
    for attr in ("published_parsed", "updated_parsed"):
        t = getattr(entry, attr, None)
        if t:
            try:
                import time as _time
                ts = _time.mktime(t)
                return datetime.fromtimestamp(ts, tz=timezone.utc)
            except Exception:
                pass
    # Try raw string
    for attr in ("published", "updated"):
        s = getattr(entry, attr, None)
        if s:
            try:
                from email.utils import parsedate_to_datetime
                return parsedate_to_datetime(s).astimezone(timezone.utc)
            except Exception:
                pass
    return None

def is_recent(dt: datetime | None) -> bool:
    if dt is None:
        return False
    cutoff = now_utc() - timedelta(hours=LOOKBACK_HOURS)
    return dt >= cutoff

def make_article(source: str, title: str, url: str, published_at: datetime, summary: str, image_url: str | None = None) -> dict:
    """Build a normalized article object matching the gemini.md schema."""
    return {
        "id":           str(uuid.uuid4()),
        "source":       source,
        "title":        title.strip(),
        "url":          url.strip(),
        "image_url":    image_url.strip() if image_url else None,
        "published_at": published_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "summary":      (summary or "").strip(),
    }

def clean_html(raw: str) -> str:
    """Strip HTML tags and collapse whitespace."""
    if not raw:
        return ""
    soup = BeautifulSoup(raw, "html.parser")
    return " ".join(soup.get_text(separator=" ").split())

# ── Scrapers ──────────────────────────────────────────────

def fetch_rss(source_cfg: dict) -> list[dict]:
    """Parse an RSS/Atom feed and return recent articles."""
    source_name = source_cfg["name"]
    feed_url    = source_cfg["rss"]
    articles    = []

    log.info(f"[{source_name}] Fetching RSS → {feed_url}")
    try:
        resp = requests.get(feed_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        log.warning(f"[{source_name}] RSS fetch failed: {e}")
        return []

    feed = feedparser.parse(resp.text)

    if not feed.entries:
        log.warning(f"[{source_name}] RSS feed returned 0 entries.")
        return []

    for entry in feed.entries:
        dt = parse_dt(entry)
        if not is_recent(dt):
            continue

        title   = getattr(entry, "title",   "") or ""
        url     = getattr(entry, "link",    "") or ""

        # Try to get a readable summary & image
        summary_raw = ""
        image_url = None

        if hasattr(entry, "summary"):
            summary_raw = entry.summary
        elif hasattr(entry, "content") and entry.content:
            summary_raw = entry.content[0].get("value", "")

        # Look for image in media_content
        if hasattr(entry, "media_content") and entry.media_content:
            for media in entry.media_content:
                if media.get("medium") == "image" or "image" in media.get("type", ""):
                    image_url = media.get("url")
                    break

        # Look for image in summary_raw if not found
        if not image_url and summary_raw:
            try:
                soup = BeautifulSoup(summary_raw, "html.parser")
                img = soup.find("img")
                if img and img.get("src"):
                    image_url = img["src"]
            except:
                pass

        summary = clean_html(summary_raw)
        # Trim to ~500 chars cleanly
        if len(summary) > 500:
            summary = summary[:497] + "..."

        if not title or not url:
            continue

        articles.append(make_article(source_name, title, url, dt, summary, image_url))

    log.info(f"[{source_name}] Found {len(articles)} article(s) in the last {LOOKBACK_HOURS}h.")
    return articles


def fetch_rundown_json(source_cfg: dict) -> list[dict]:
    """
    Specialized scraper for The AI Rundown leveraging their /posts JSON endpoint.
    """
    source_name = source_cfg["name"]
    url = source_cfg["json"]
    articles = []

    log.info(f"[{source_name}] Fetching JSON → {url}")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        
        posts = data.get("posts", [])
        for p in posts:
            # Check if recent
            updated_at = p.get("updated_at")
            if not updated_at:
                continue
            
            dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
            if not is_recent(dt):
                continue

            slug = p.get("slug")
            title = p.get("web_title") or p.get("title") or "Untitled"
            summary = p.get("web_subtitle") or p.get("description") or ""
            image_url = p.get("image_url")

            if not slug:
                continue

            # Critical: Use the /p/ prefix for Rundown articles
            full_url = f"https://www.therundown.ai/p/{slug}"

            articles.append(make_article(
                source_name, title, full_url, dt, summary, image_url
            ))

    except Exception as e:
        log.warning(f"[{source_name}] JSON fetch failed: {e}")
        return []

    log.info(f"[{source_name}] Found {len(articles)} article(s) via JSON.")
    return articles


def fetch_web_fallback(source_cfg: dict) -> list[dict]:
    """
    HTML scraping fallback when RSS returns nothing.
    Looks for <article>, common newsletter-archive card patterns.
    Per SOP Edge Case: log and skip on parse failure, do not crash.
    """
    source_name = source_cfg["name"]
    web_url     = source_cfg["web"]
    articles    = []

    log.info(f"[{source_name}] Attempting HTML fallback → {web_url}")
    try:
        resp = requests.get(web_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        log.warning(f"[{source_name}] HTML fallback fetch failed: {e}")
        return []

    try:
        soup = BeautifulSoup(resp.text, "html.parser")

        # Generic selectors — look for article/post link cards
        candidates = soup.select("article a[href], .post-card a[href], .feed-item a[href]")
        seen_urls = set()

        for card in candidates[:20]:
            link = card if card.name == "a" else card.find("a", href=True)
            if not link:
                continue
                
            href  = link.get("href", "")
            title = link.get_text(strip=True)
            if not href or not title or href in seen_urls:
                continue
            if not href.startswith("http"):
                href = web_url.rstrip("/") + "/" + href.lstrip("/")
            seen_urls.add(href)

            # Try to grab an image from the card context
            img_tag = card.find("img") if card.name != "a" else card.find_parent().find("img")
            image_url = img_tag.get("src") if img_tag else None

            # Treat as "now" since we can't reliably get the date from the card
            articles.append(make_article(
                source_name, title, href,
                now_utc(),
                "Full article available at source link.",
                image_url
            ))

        log.info(f"[{source_name}] HTML fallback found {len(articles)} candidate(s).")
    except Exception as e:
        log.error(f"[{source_name}] HTML parsing error (skipping source): {e}")

    return articles

# ── Main ──────────────────────────────────────────────────

def main():
    log.info("Glaido scraper starting.")

    # Step 1: Ensure .tmp/ exists (SOP § 1)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    log.info(f"Output directory: {TMP_DIR}")

    all_articles: list[dict] = []

    for source_cfg in SOURCES:
        articles = []
        if "json" in source_cfg and source_cfg["name"] == "The AI Rundown":
            articles = fetch_rundown_json(source_cfg)
        elif "rss" in source_cfg:
            articles = fetch_rss(source_cfg)

        # Fallback to HTML if others return nothing
        if not articles:
            articles = fetch_web_fallback(source_cfg)

        all_articles.extend(articles)

    # Sort newest-first
    all_articles.sort(
        key=lambda a: a["published_at"],
        reverse=True
    )

    log.info(f"Total articles scraped: {len(all_articles)}")

    # Step 6: Write output (SOP § 6)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_articles, f, indent=2, ensure_ascii=False)

    log.info(f"Written → {OUTPUT_FILE}")

    if not all_articles:
        log.warning("No articles found within the last 24 hours.")
        sys.exit(0)

    log.info("Done.")


if __name__ == "__main__":
    main()
