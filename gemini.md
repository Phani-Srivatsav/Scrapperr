# GEMINI.MD - Data Schema and Law

## JSON Data Schema

### 1. Scraper Output Payload (`.tmp/articles.json`)
The script in `tools/` that scrapes newsletters will output an array of objects in this shape.
```json
[
  {
    "id": "uuid-string",
    "source": "string (e.g., 'Ben\\'s Bites')",
    "title": "string",
    "url": "string (Valid URL)",
    "image_url": "string (Valid URL or null)",
    "published_at": "string (ISO-8601 UTC timestamp)",
    "summary": "string"
  }
]
```

### 2. Frontend Dashboard State (Source of Truth)
The frontend dashboard will consume the scraper payload and maintain this internal state (hydrated by localStorage for MVP).
```json
{
  "articles": [
    {
      "id": "uuid-string",
      "source": "string",
      "title": "string",
      "url": "string",
      "image_url": "string (or null)",
      "published_at": "string",
      "summary": "string",
      "is_saved": "boolean (true/false)"
    }
  ],
  "last_updated": "string (ISO-8601 UTC timestamp)"
}
```

## Maintenance Log
*(To be filled during Trigger phase)*
