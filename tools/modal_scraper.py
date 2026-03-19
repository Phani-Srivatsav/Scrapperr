import json
import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
import feedparser
from bs4 import BeautifulSoup
import modal

# ── Modal Config ──────────────────────────────────────────
app = modal.App("glaido-scraper")
volume = modal.Volume.from_name("glaido-data", create_if_missing=True)

image = (
    modal.Image.debian_slim()
    .pip_install("requests", "feedparser", "beautifulsoup4", "fastapi")
)

# ── Scraper Config ────────────────────────────────────────
REQUEST_TIMEOUT = 10
LOOKBACK_HOURS = 72
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
}

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

# ── Logging ───────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("glaido")

# ── Helpers ───────────────────────────────────────────────
def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def parse_dt(entry) -> datetime | None:
    for attr in ("published_parsed", "updated_parsed"):
        t = getattr(entry, attr, None)
        if t:
            try:
                import time as _time
                ts = _time.mktime(t)
                return datetime.fromtimestamp(ts, tz=timezone.utc)
            except: pass
    return None

def is_recent(dt: datetime | None) -> bool:
    if dt is None: return False
    return dt >= (now_utc() - timedelta(hours=LOOKBACK_HOURS))

def make_article(source, title, url, published_at, summary, image_url=None):
    return {
        "id": str(uuid.uuid4()),
        "source": source,
        "title": title.strip(),
        "url": url.strip(),
        "image_url": image_url.strip() if image_url else None,
        "published_at": published_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "summary": (summary or "").strip(),
    }

def clean_html(raw):
    if not raw: return ""
    soup = BeautifulSoup(raw, "html.parser")
    return " ".join(soup.get_text(separator=" ").split())

# ── Scrapers ──────────────────────────────────────────────
def fetch_rss(source_cfg):
    source_name = source_cfg["name"]
    feed_url = source_cfg["rss"]
    articles = []
    log.info(f"[{source_name}] Fetching RSS → {feed_url}")
    try:
        resp = requests.get(feed_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        feed = feedparser.parse(resp.text)
        for entry in feed.entries:
            dt = parse_dt(entry)
            if not is_recent(dt): continue
            title = getattr(entry, "title", "")
            url = getattr(entry, "link", "")
            summary_raw = getattr(entry, "summary", "")
            image_url = None
            if hasattr(entry, "media_content"):
                image_url = entry.media_content[0].get("url")
            summary = clean_html(summary_raw)[:500]
            if title and url:
                articles.append(make_article(source_name, title, url, dt, summary, image_url))
    except Exception as e:
        log.warning(f"[{source_name}] RSS failed: {e}")
    return articles

def fetch_rundown_json(source_cfg):
    source_name = source_cfg["name"]
    url = source_cfg["json"]
    articles = []
    log.info(f"[{source_name}] Fetching JSON → {url}")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        posts = resp.json().get("posts", [])
        for p in posts:
            dt = datetime.fromisoformat(p["updated_at"].replace("Z", "+00:00"))
            if not is_recent(dt): continue
            full_url = f"https://www.therundown.ai/p/{p['slug']}"
            articles.append(make_article(
                source_name, p.get("web_title") or p.get("title"), 
                full_url, dt, p.get("web_subtitle") or "", p.get("image_url")
            ))
    except Exception as e:
        log.warning(f"[{source_name}] JSON failed: {e}")
    return articles

# ── Modal Functions ───────────────────────────────────────
@app.function(image=image, volumes={"/data": volume}, schedule=modal.Period(days=1))
def scrape_daily():
    log.info("Modal: Starting daily scrape.")
    all_articles = []
    for source_cfg in SOURCES:
        if "json" in source_cfg:
            all_articles.extend(fetch_rundown_json(source_cfg))
        else:
            all_articles.extend(fetch_rss(source_cfg))

    all_articles.sort(key=lambda a: a["published_at"], reverse=True)
    
    output_path = Path("/data/articles.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_articles, f, indent=2, ensure_ascii=False)
    
    # Commit changes to Volume
    volume.commit()
    log.info(f"Modal: Scrape complete. {len(all_articles)} articles saved to Volume.")

@app.function(image=image, volumes={"/data": volume})
@modal.web_endpoint(method="GET")
def get_articles():
    """Serves the latest articles.json via HTTP."""
    import fastapi
    from fastapi.responses import JSONResponse
    
    path = Path("/data/articles.json")
    if not path.exists():
        return JSONResponse(content={"error": "Not scraped yet"}, status_code=404)
    
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    return data

@app.local_entrypoint()
def run():
    scrape_daily.remote()
