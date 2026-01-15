# Testing Workflow for Claude Code

This document defines how Claude should test changes using Playwright before committing.

## Playwright Capabilities

Claude has access to Playwright MCP tools for browser automation:

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Go to a URL |
| `browser_snapshot` | Get accessibility tree (best for interactions) |
| `browser_take_screenshot` | Capture visual screenshot |
| `browser_click` | Click elements |
| `browser_type` | Type into inputs |
| `browser_fill_form` | Fill multiple form fields |
| `browser_wait_for` | Wait for text/elements |
| `browser_console_messages` | Check for JS errors |
| `browser_network_requests` | Inspect API calls |

## Services & URLs

| Service | URL | Purpose |
|---------|-----|---------|
| infra-diagram-app | https://diagrams.srv1252100.hstgr.cloud | Meeting intelligence & diagrams |
| n8n | https://n8n.srv1252100.hstgr.cloud | Workflow automation |

## Standard Testing Procedure

After making changes, follow this workflow:

### 1. Rebuild if needed
```bash
cd /root/projects/infra-diagram-app
docker compose up -d --build
```

### 2. Navigate to the app
```
browser_navigate → https://diagrams.srv1252100.hstgr.cloud
```

### 3. Take a snapshot
```
browser_snapshot → Get current page state
```

### 4. Test the specific change
- For UI changes: verify elements exist and are interactive
- For forms: fill and submit test data
- For navigation: click through affected pages

### 5. Check for errors
```
browser_console_messages → Look for JS errors
```

### 6. Report results
Summarize what was tested and the outcome before committing.

## Testing Patterns for infra-diagram-app

### Login Page
- Navigate to root URL (redirects to login if not authenticated)
- Fill password field and submit
- Verify redirect to dashboard

### Dashboard
- Check customer list loads
- Verify session counts display
- Test navigation links

### Customer Detail Page
- Navigate to `/customer/:id`
- Verify diagrams display correctly
- Check action items table
- Test diagram zoom/pan functionality

### Processing Queue
- Submit a new session for processing
- Poll status endpoint
- Verify diagram generation completes

### Forms
- Test "Add Customer" form
- Test session submission
- Verify validation errors display

## Commit Workflow

After successful testing:

1. Run `/commit` to create a git commit
2. Include what was tested in the commit context
3. Push when ready: `git push origin main`

## Troubleshooting

### Browser Lock Error
If Playwright shows "Browser is already in use" error:
1. Restart the Claude Code session (this resets the MCP server)
2. Or run: `rm -rf /root/.cache/ms-playwright/mcp-chrome-*`

### Zombie Chrome Processes
If you see many `[chromium] <defunct>` processes:
```bash
# These are zombies and harmless, but to clean up:
# Restart Claude Code session, or reboot the server
```

### Quick Verification Without Playwright
```bash
# Check if app is responding
curl -s -o /dev/null -w "%{http_code}" https://diagrams.srv1252100.hstgr.cloud
# 200 = OK, 302 = Redirect to login (also OK)
```

## Quick Reference

```bash
# Rebuild and restart
cd /root/projects/infra-diagram-app && docker compose up -d --build

# View logs
docker logs -f infra-diagrams

# Check container status
docker ps

# Restart without rebuild
docker compose restart infra-diagrams
```
