# CommishBot Documentation Site - Product Requirements Document

## Overview

A static documentation site for CommishBot, the Discord bot for WPFL fantasy football league management. The site provides comprehensive command documentation, game guides, and strategic information for league members.

## Goals

1. **Discoverability** - Make all 36 commands easily searchable and browsable
2. **Education** - Help users understand game systems (economy, training, gambling)
3. **Accessibility** - Dark mode default, responsive design, keyboard navigation
4. **Performance** - Static site with instant page loads via Cloudflare Pages

## Tech Stack

| Technology | Purpose |
|------------|---------|
| SvelteKit | Static site framework |
| TypeScript | Type safety |
| Tailwind CSS | Styling with dark mode |
| Fuse.js | Client-side search |
| Cloudflare Pages | Hosting & CDN |

## Architecture

### Atomic Component Design

```
atoms/          → Badge, Button, CodeBlock, Icon, Tag
molecules/      → CommandOption, NavLink, SearchInput, ThemeToggle
organisms/      → CommandCard, Header, Sidebar, TableOfContents
templates/      → DocsLayout, GuideLayout
```

### Folder Structure

```
docs/
├── src/
│   ├── lib/
│   │   ├── components/     # Atomic components
│   │   ├── data/           # Command JSON files
│   │   ├── stores/         # Theme, search state
│   │   ├── types/          # TypeScript interfaces
│   │   └── utils/          # Search, helpers
│   └── routes/
│       ├── commands/       # Command documentation
│       └── guides/         # Game guides
├── static/
├── svelte.config.js
├── tailwind.config.js
└── wrangler.toml
```

## Command Categories (36 Commands)

### Fantasy Football (7)
| Command | Description |
|---------|-------------|
| `/activity` | Recent league transactions |
| `/standings` | Standings by week/year |
| `/median` | Ranked scores for week |
| `/closestscores` | Closest game margins |
| `/trophies` | Weekly awards |
| `/ewins` | Expected vs actual wins |
| `/optimal` | Optimal coaching analysis |

### Draft Analysis (2)
| Command | Description |
|---------|-------------|
| `/draft` | Draft countdown timer |
| `/drafttrends` | Draft pattern analysis |

### Performance Analysis (2)
| Command | Description |
|---------|-------------|
| `/clutch` | Clutch performance stats |
| `/cursed` | Statistical nightmares analysis |

### Economy (7)
| Command | Description |
|---------|-------------|
| `/balance` | Check coin balance |
| `/daily` | Collect 100 coins + streak bonus |
| `/work` | Earn 20-80 coins (30min cooldown) |
| `/deposit` | Move coins to bank |
| `/withdraw` | Move coins from bank |
| `/economyhelp` | Economy command list |
| `/eleaderboard` | Top 10 wealthiest |

### Gambling (3)
| Command | Description |
|---------|-------------|
| `/gamble` | Coin flip (50/50, double or nothing) |
| `/slots` | Football-themed slot machine |
| `/blackjack` | Interactive blackjack game |

### Robbery (1)
| Command | Description |
|---------|-------------|
| `/rob` | Steal coins from another player |

### Shop & Inventory (2)
| Command | Description |
|---------|-------------|
| `/shop` | View and purchase items |
| `/inventory` | View and sell owned items |

### Training (1)
| Command | Description |
|---------|-------------|
| `/train` | Manage 3x3 Training Ground grid |

### Trivia (3)
| Command | Description |
|---------|-------------|
| `/trivia` | Trigger trivia question |
| `/trivialeaderboard` | Top 10 trivia scores |
| `/triviastats` | Personal trivia statistics |

### Betting (2)
| Command | Description |
|---------|-------------|
| `/betcreate` | Create bet with another user |
| `/betlist` | List all current bets |

### Utility (4)
| Command | Description |
|---------|-------------|
| `/ping` | Bot health check |
| `/flip` | Flip a coin |
| `/roll` | Roll dice |
| `/image` | Generate DALL-E image |

## Game Systems

### Economy System

**Earning:**
- Daily: 100 coins base + 10/day streak (max +100 bonus)
- Work: 20-80 coins, 70% success rate, 30min cooldown

**Spending:**
- Gambling: 10-10,000 coin bets
- Shop: Padlocks (500), Bank Expansions (2,000), Training items

**Protection:**
- Bank: Safe storage (1,000 starting capacity)
- Padlock: Blocks one robbery attempt

**Risk:**
- Rob: 40% success, steals 10-30% of target wallet
- Fail penalty: 100 coins

### Slots Payouts

| Match | Multiplier |
|-------|------------|
| 🎰🎰🎰 Triple Jackpot | 100x |
| 🏆🏆🏆 Triple Trophy | 25x |
| 🥇🥇🥇 Triple Gold | 10x |
| ⭐⭐⭐ Triple Star | 7x |
| 🏟️🏟️🏟️ Triple Stadium | 5x |
| Any Triple Common | 3x |
| Two Matching | 2x |

### Training Ground

**Positions:**
| Position | Emoji | Train Time | Value | Wilt Window |
|----------|-------|------------|-------|-------------|
| Tight End | 🤲 | 5 min | 75-100 | 15 min |
| Running Back | 🏃 | 10 min | 150-200 | 20 min |
| Wide Receiver | 🎯 | 15 min | 225-300 | 25 min |
| Quarterback | 🏈 | 25 min | 375-500 | 30 min |

**Grid States:**
⬛ Empty → 🟫 Prepared → 💧 Hydrated → [Position] → ⭐ Ready → 💀 Busted

**Starter Kit:** 10 Setup Kits, 10 Water Coolers, 2 TE Contracts

## Design System

### Colors (Discord-Inspired Dark Theme)

```css
--dark-bg: #1e1f22;
--dark-sidebar: #2b2d31;
--dark-card: #313338;
--dark-hover: #404249;
--accent-primary: #5865f2;  /* Discord blurple */
--accent-success: #2ecc71;
--accent-warning: #f1c40f;
--accent-danger: #e74c3c;
```

### Typography

- **Headings:** Inter (system fallback)
- **Code:** JetBrains Mono

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Home with quick links |
| `/commands` | All commands grid |
| `/commands/[category]` | Category listing |
| `/commands/[category]/[command]` | Command detail |
| `/guides` | Guide index |
| `/guides/economy` | Economy system guide |
| `/guides/training` | Training Ground guide |
| `/guides/gambling` | Gambling strategies guide |

## Features

### Search
- Cmd+K keyboard shortcut
- Fuse.js fuzzy matching
- Search by name, description, category

### Navigation
- Persistent sidebar with categories
- Breadcrumb navigation
- Right-side table of contents

### Responsive
- Mobile-friendly sidebar (collapsible)
- Readable on all screen sizes

## Deployment

### Cloudflare Pages

```toml
name = "commishbot-docs"
compatibility_date = "2024-12-01"
pages_build_output_dir = "build"
```

### Build Command
```bash
npm run build
```

## Success Metrics

1. All 36 commands documented with usage examples
2. 3 comprehensive game guides
3. Sub-second page loads
4. Full keyboard navigation support
5. Dark mode default with light mode toggle
