# Gantt Chart Plugin — Installation Guide

## Steps

1. Download `obsidian-gantt-chart.zip`
2. Unzip it — you'll get 3 files: `main.js`, `manifest.json`, `styles.css`
3. In your Obsidian vault folder, navigate to `.obsidian/plugins/`
4. Create a new folder called `obsidian-gantt-chart`
5. Move the 3 files into that folder
6. Open Obsidian → **Settings** → **Community plugins** → **Enable** "Gantt Chart"
7. Click the bar chart icon in the left ribbon (or `Cmd+P` → "Open Gantt Chart")

## Quick setup for your notes

Add these properties to any note's frontmatter to make it appear as a project:

```yaml
---
start_date: 2026-03-10
end_date: 2026-03-25
---
```

To add tasks inside a project, use the Tasks plugin format:

```markdown
- [ ] Task name 🛫 2026-03-10 📅 2026-03-15
```

## Key interactions

- **Click chevron** — expand/collapse project to see its tasks
- **Drag bar** — move dates
- **Drag bar edges** — resize start/end date
- **Double-click bar** — edit dates in a popup
- **Ctrl/Cmd + scroll** — zoom in/out (days → weeks → months)
- **Right-click bar** — delete dates
- **"+ Add task"** — add new tasks inline when a project is expanded
