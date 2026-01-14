# Infrastructure Diagram App

## Project Overview

A meeting intelligence application that:
1. Fetches Wave meeting transcripts via Puppeteer scraping
2. Analyzes transcripts with Perplexity AI (Sonar model)
3. Generates infrastructure diagrams (Mermaid) and mind maps
4. Tracks action items and meeting summaries per customer

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: SQLite with better-sqlite3
- **Templating**: EJS
- **Diagram Rendering**: Mermaid CLI
- **Web Scraping**: Puppeteer with Stealth Plugin
- **AI Analysis**: Perplexity API (Sonar model)
- **Deployment**: Docker with Chromium

## Directory Structure

```
src/
├── config/
│   └── infra-template.js     # Infrastructure categories for LLM prompt
├── middleware/
│   └── auth.js               # Session-based authentication
├── routes/
│   ├── api.js                # API endpoints (queue, action items, etc.)
│   └── web.js                # Page routes and form handlers
├── services/
│   ├── database.js           # SQLite operations, queue management
│   ├── mermaid.js            # Diagram validation and PNG rendering
│   ├── perplexity.js         # LLM analysis, name normalization
│   ├── queue-worker.js       # Background job processor
│   └── wave.js               # Wave session scraping
└── index.js                  # Express app entry point

views/
├── layout.ejs                # Base layout with nav, toasts, polling
├── dashboard.ejs             # Customer grid with badges
├── wave.ejs                  # Wave sessions with queue UI
├── customer.ejs              # Customer detail with diagrams, action items
├── editor.ejs                # Mermaid code editor
└── ...

public/
├── css/style.css             # All styles including badges, toasts
└── js/                       # Client-side scripts
```

## Key Features

### Call Types
- **Technical**: Infrastructure discussions → Mermaid flowchart diagrams
- **Partner**: Vendor/partner calls → Mind map diagrams
- **Non-Technical**: Sales/admin calls → Summary + action items only

### Background Queue
- Jobs stored in `processing_queue` table
- Worker polls every 3 seconds
- Status: pending → processing → completed/failed
- Toast notifications on completion

### Action Items
- Owners: Stephen, Customer, Vendor, Partner, Unknown
- Can be moved between customers
- Completed items hidden by default

## Environment Variables

```
APP_PASSWORD=xxx           # Login password
PERPLEXITY_API_KEY=xxx     # Perplexity API key
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium  # In Docker
```

## Common Tasks

### Rebuild Container
```bash
cd /root/projects/infra-diagram-app
docker compose up -d --build
```

### View Logs
```bash
docker compose logs -f
```

### Database Location
```
data/diagrams.db           # SQLite database
data/wave-auth.json        # Wave authentication token
data/wave-sessions.json    # Cached session list
data/exports/              # Generated PNG diagrams
```

## Recent Changes (Jan 2026)

1. **Date extraction** fixed - parses from Wave title
2. **Name normalization** - Steven/Steve → Stephen
3. **Mermaid cleanup** - removes invalid `:::` syntax
4. **Progress indicator** - shows X/Y during bulk processing
5. **Partner calls** - new type with mind map diagrams

## Important Code Patterns

### LLM Response Processing (perplexity.js)
```javascript
// After JSON parse:
result.mermaidCode = this.cleanMermaidCode(result.mermaidCode);
result.actionItems = result.actionItems.map(item => ({
  ...item,
  owner: this.normalizeOwner(item.owner)
}));
```

### Wave Date Extraction (wave.js)
```javascript
// Extract from title: "Meeting12/19/2025, 7:07 PM·46:10"
const titleDateMatch = rawTitle.match(/(\d{1,2}\/\d{1,2}\/\d{4}),?\s*\d{1,2}:\d{2}/i);
```

### Queue Status Polling (wave.ejs)
```javascript
setInterval(updateQueueStatus, 3000);
// Updates progress bar, session cards, nav badge
```
