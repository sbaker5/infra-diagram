# Changelog

All notable changes to the Infrastructure Diagram App are documented here.

## [Unreleased]

## [2026-01-12] - Bug Fixes & Enhancements

### Added
- **Partner Call Type**: New classification for vendor/partner discussions
  - Generates mind map style diagrams instead of infrastructure flowcharts
  - Pink badges (`badge-partner`) to distinguish from technical (green) and non-technical (blue)
  - Partner owner type for action items with pink styling
  - Mind map view link in processing result modal

- **Processing Progress Indicator**: Visual feedback during bulk processing
  - Progress bar shows `X/Y` completed with animated fill
  - Bulk queue buttons show "Queueing N..." during action
  - Session cards update dynamically without page reload
  - Unprocessed count updates in real-time

### Fixed
- **Date Extraction**: Dates now correctly extracted from Wave session titles
  - Previously all sessions showed same date due to incorrect DOM scraping
  - Now parses embedded date from title format: `Title12/19/2025, 7:07:43 PM·46:10`
  - Also extracts duration from title suffix

- **Name Normalization**: "Steven" and "Steve" now normalize to "Stephen"
  - Applied automatically to action item owners after LLM response
  - Handles case-insensitive variations

- **Mermaid Syntax**: Invalid triple-colon (`:::`) syntax now cleaned
  - LLM prompt updated to avoid generating `:::` class syntax
  - Post-processing removes any `:::` patterns from generated code
  - Prevents Mermaid rendering errors

### Changed
- Queue status panel redesigned with progress bar
- Bulk queue no longer reloads page - updates UI dynamically
- Action items edit modal now includes Partner as owner option

## [2026-01-11] - Background Processing Queue

### Added
- **Background Processing Queue**: Process sessions without blocking UI
  - Queue worker runs in background (3-second polling)
  - Queue/Cancel buttons on session cards
  - Bulk queue actions: "Queue Next 10", "Queue All Unprocessed"
  - Toast notifications for completed/failed jobs
  - Nav badge shows active queue count

- **Action Item Management**: Edit and move action items
  - Edit modal with owner, text, date fields
  - Move action items between customers
  - Create new customer when moving

- **Discard Diagram**: Delete diagram while preserving action items and notes

### Changed
- Session processing moved to async queue system
- Added `processing_queue` table to database

## [2026-01-07] - Initial Release

### Added
- Wave session scraping with Puppeteer
- Perplexity AI transcript analysis
- Mermaid diagram generation and PNG export
- Customer management with versioned diagrams
- Session notes with summaries and action items
- Skip/unskip sessions functionality
- Authentication with session-based login
