# Static Documentation Site Improvements PRD

## Overview

Comprehensive UX and feature improvements for the CommishBot documentation site, focusing on mobile-first design, discoverability, and user engagement.

**Current Stack**: SvelteKit 2 + Svelte 5 (runes) + Tailwind CSS + Fuse.js
**Target**: Mobile-first, PWA-capable documentation site

---

## Phase 1: Quick Wins

### 1.1 Copy-to-Clipboard Buttons

**Problem**: Users can't easily copy commands like `/train view` to paste in Discord. This is the primary use case for the docs site.

**Solution**: Add copy button to all command usages and code blocks.

**Implementation**:

```svelte
<!-- docs/src/lib/components/atoms/CodeBlock.svelte -->
<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    code: string;
    language?: string;
    showCopy?: boolean;
  }

  let { code, language = 'text', showCopy = true }: Props = $props();
  let copied = $state(false);

  async function copyToClipboard(): Promise<void> {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }
</script>

<div class="relative group">
  <pre class="code-block"><code>{code}</code></pre>
  {#if showCopy}
    <button
      onclick={copyToClipboard}
      class="absolute top-2 right-2 p-2 rounded-lg bg-dark-hover/80 text-dark-300
             hover:text-dark-100 opacity-0 group-hover:opacity-100 transition-opacity
             min-h-[44px] min-w-[44px] flex items-center justify-center"
      aria-label="Copy to clipboard"
    >
      {#if copied}
        <Icon name="check" size="sm" class="text-accent-success" />
      {:else}
        <Icon name="copy" size="sm" />
      {/if}
    </button>
  {/if}
</div>
```

**UX Details**:
- Button appears on hover (desktop) or always visible (mobile)
- Shows checkmark for 2 seconds after copy
- 44px minimum touch target
- Works with `navigator.clipboard` API

**Files Modified**:
- `docs/src/lib/components/atoms/CodeBlock.svelte`
- `docs/src/lib/components/atoms/Icon.svelte` (add copy, check icons)

---

### 1.2 Back-to-Top Button

**Problem**: Long guide pages (economy guide is 240+ lines) require excessive scrolling to return to navigation.

**Solution**: Floating button that appears after scrolling 300px.

**Implementation**:

```svelte
<!-- docs/src/lib/components/molecules/BackToTop.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/atoms/Icon.svelte';

  let visible = $state(false);

  onMount(() => {
    const handleScroll = () => {
      visible = window.scrollY > 300;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  });

  function scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

{#if visible}
  <button
    onclick={scrollToTop}
    class="fixed bottom-20 right-4 lg:bottom-8 p-3 rounded-full
           bg-dark-card border border-dark-border shadow-lg
           text-dark-300 hover:text-dark-100 hover:bg-dark-hover
           transition-all duration-200 z-30
           min-h-[48px] min-w-[48px]"
    aria-label="Back to top"
    transition:fly={{ y: 20, duration: 200 }}
  >
    <Icon name="arrowUp" size="md" />
  </button>
{/if}
```

**UX Details**:
- Positioned bottom-right, above bottom nav on mobile
- Smooth scroll animation
- Fly-in transition when appearing
- 48px touch target

**Files**:
- NEW: `docs/src/lib/components/molecules/BackToTop.svelte`
- `docs/src/routes/+layout.svelte` (add component)

---

### 1.3 Prev/Next Command Navigation

**Problem**: No way to browse through commands in a category sequentially. Users must go back to category page.

**Solution**: Navigation footer on command pages with previous/next links.

**Implementation**:

```svelte
<!-- Add to docs/src/routes/commands/[category]/[command]/+page.svelte -->
<script lang="ts">
  // ... existing code ...

  let categoryCommands = $derived(category?.commands || []);
  let currentIndex = $derived(categoryCommands.findIndex(c => c.name === command.name));
  let prevCommand = $derived(currentIndex > 0 ? categoryCommands[currentIndex - 1] : null);
  let nextCommand = $derived(currentIndex < categoryCommands.length - 1 ? categoryCommands[currentIndex + 1] : null);
</script>

<!-- Add at bottom of page -->
<nav class="flex justify-between items-center mt-12 pt-8 border-t border-dark-border">
  {#if prevCommand}
    <a
      href="/commands/{command.categorySlug}/{prevCommand.name}"
      class="flex items-center gap-2 text-dark-400 hover:text-accent-primary transition-colors group"
    >
      <Icon name="arrowLeft" size="sm" class="group-hover:-translate-x-1 transition-transform" />
      <div class="text-left">
        <div class="text-xs uppercase tracking-wide">Previous</div>
        <div class="font-mono text-dark-200 group-hover:text-accent-primary">/{prevCommand.name}</div>
      </div>
    </a>
  {:else}
    <div></div>
  {/if}

  {#if nextCommand}
    <a
      href="/commands/{command.categorySlug}/{nextCommand.name}"
      class="flex items-center gap-2 text-dark-400 hover:text-accent-primary transition-colors group text-right"
    >
      <div>
        <div class="text-xs uppercase tracking-wide">Next</div>
        <div class="font-mono text-dark-200 group-hover:text-accent-primary">/{nextCommand.name}</div>
      </div>
      <Icon name="arrowRight" size="sm" class="group-hover:translate-x-1 transition-transform" />
    </a>
  {/if}
</nav>
```

**UX Details**:
- Shows command name with category context
- Hover animation on arrows
- Full-width tappable area on mobile
- Empty placeholder maintains layout when at first/last command

**Files Modified**:
- `docs/src/routes/commands/[category]/[command]/+page.svelte`

---

### 1.4 Wider Mobile Search Bar

**Problem**: Search input constrained to 200px on mobile, feels cramped and hard to tap.

**Solution**: Expand search bar width on mobile.

**Implementation**:

```svelte
<!-- docs/src/lib/components/organisms/Header.svelte -->
<!-- Change from: -->
<div class="flex-1 max-w-[200px] sm:max-w-md ml-auto lg:ml-8">

<!-- To: -->
<div class="flex-1 max-w-[280px] sm:max-w-md ml-auto lg:ml-8">
```

**Files Modified**:
- `docs/src/lib/components/organisms/Header.svelte`

---

## Phase 2: Mobile Navigation Core

### 2.1 Bottom Navigation Bar

**Problem**: Primary actions (Home, Commands, Guides, Search) are in the header, outside the thumb zone on mobile. Users must reach to top of screen.

**Solution**: Fixed bottom navigation bar for mobile (< lg breakpoint).

**Implementation**:

```svelte
<!-- docs/src/lib/components/organisms/BottomNav.svelte -->
<script lang="ts">
  import { page } from '$app/stores';
  import Icon from '$lib/components/atoms/Icon.svelte';
  import { searchOpen } from '$lib/stores/search';

  const navItems = [
    { href: '/', icon: 'home', label: 'Home' },
    { href: '/commands', icon: 'book', label: 'Commands' },
    { href: '/guides', icon: 'guide', label: 'Guides' },
    { action: 'search', icon: 'search', label: 'Search' }
  ];

  function isActive(href: string): boolean {
    if (href === '/') return $page.url.pathname === '/';
    return $page.url.pathname.startsWith(href);
  }

  function handleClick(item: typeof navItems[0]): void {
    if (item.action === 'search') {
      searchOpen.set(true);
    }
  }
</script>

<nav class="fixed bottom-0 left-0 right-0 z-50 lg:hidden
            bg-dark-sidebar/95 backdrop-blur-lg border-t border-dark-border
            pb-[env(safe-area-inset-bottom)]">
  <div class="flex justify-around items-center h-16">
    {#each navItems as item}
      {#if item.href}
        <a
          href={item.href}
          class="flex flex-col items-center justify-center gap-1 px-4 py-2 min-w-[64px]
                 {isActive(item.href) ? 'text-accent-primary' : 'text-dark-400'}"
        >
          <Icon name={item.icon} size="md" />
          <span class="text-xs font-medium">{item.label}</span>
        </a>
      {:else}
        <button
          onclick={() => handleClick(item)}
          class="flex flex-col items-center justify-center gap-1 px-4 py-2 min-w-[64px] text-dark-400"
        >
          <Icon name={item.icon} size="md" />
          <span class="text-xs font-medium">{item.label}</span>
        </button>
      {/if}
    {/each}
  </div>
</nav>
```

**CSS Addition** (app.css):
```css
@layer base {
  /* Safe area support for notched devices */
  :root {
    --sab: env(safe-area-inset-bottom);
  }

  /* Add bottom padding to main content on mobile to account for bottom nav */
  @media (max-width: 1023px) {
    main {
      padding-bottom: calc(4rem + env(safe-area-inset-bottom));
    }
  }
}
```

**UX Details**:
- 64px height + safe-area-inset for notched phones
- Active state with accent color
- Backdrop blur for layered feel
- Hidden on desktop (lg:hidden)
- Search button opens modal instead of navigating

**Files**:
- NEW: `docs/src/lib/components/organisms/BottomNav.svelte`
- `docs/src/routes/+layout.svelte` (add component)
- `docs/src/app.css` (safe area, padding)

---

### 2.2 Sidebar Swipe Gestures

**Problem**: Only way to open sidebar on mobile is hamburger menu button.

**Solution**: Swipe from left edge to open, swipe left on sidebar to close.

**Implementation**:

```svelte
<!-- docs/src/lib/components/organisms/Sidebar.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  // ... existing imports ...

  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 50;
  const EDGE_ZONE = 30; // pixels from left edge

  onMount(() => {
    function handleTouchStart(e: TouchEvent): void {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }

    function handleTouchEnd(e: TouchEvent): void {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = Math.abs(touchEndY - touchStartY);

      // Only handle horizontal swipes
      if (deltaY > Math.abs(deltaX)) return;

      // Swipe right from edge to open
      if (!open && touchStartX < EDGE_ZONE && deltaX > SWIPE_THRESHOLD) {
        onOpen?.();
      }

      // Swipe left anywhere to close
      if (open && deltaX < -SWIPE_THRESHOLD) {
        onClose?.();
      }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  });
</script>
```

**Props Update**:
```typescript
interface Props {
  open?: boolean;
  onClose?: () => void;
  onOpen?: () => void; // NEW
}
```

**UX Details**:
- 30px edge zone for swipe-to-open
- 50px swipe threshold to prevent accidental triggers
- Only responds to horizontal swipes (ignores vertical scrolling)
- Passive event listeners for performance

**Files Modified**:
- `docs/src/lib/components/organisms/Sidebar.svelte`
- `docs/src/routes/+layout.svelte` (pass onOpen prop)

---

### 2.3 Scroll Progress Indicator

**Problem**: On long guide pages, users don't know how far they've scrolled or how much content remains.

**Solution**: Thin progress bar under the header.

**Implementation**:

```svelte
<!-- docs/src/lib/components/atoms/ScrollProgress.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';

  let progress = $state(0);

  onMount(() => {
    function handleScroll(): void {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial calculation

    return () => window.removeEventListener('scroll', handleScroll);
  });
</script>

<div class="fixed top-14 left-0 right-0 h-0.5 bg-dark-border z-50 lg:left-64">
  <div
    class="h-full bg-accent-primary transition-[width] duration-100"
    style="width: {progress}%"
  ></div>
</div>
```

**UX Details**:
- 2px height (h-0.5)
- Positioned directly under sticky header
- Accounts for sidebar width on desktop (lg:left-64)
- Smooth width transition
- Accent color for visibility

**Files**:
- NEW: `docs/src/lib/components/atoms/ScrollProgress.svelte`
- `docs/src/routes/guides/[slug]/+layout.svelte` OR individual guide pages

---

### 2.4 Jump-to-Section Pills

**Problem**: Long command pages require scrolling to find specific sections (Usage, Options, Examples, Tips).

**Solution**: Horizontal scrolling pill buttons that jump to sections.

**Implementation**:

```svelte
<!-- Add to docs/src/routes/commands/[category]/[command]/+page.svelte -->
<script lang="ts">
  // Determine which sections exist
  let sections = $derived([
    { id: 'usage', label: 'Usage', exists: true },
    { id: 'subcommands', label: 'Subcommands', exists: command.subcommands?.length > 0 },
    { id: 'options', label: 'Options', exists: command.options?.length > 0 },
    { id: 'examples', label: 'Examples', exists: command.examples?.length > 0 },
    { id: 'tips', label: 'Tips', exists: command.tips?.length > 0 },
    { id: 'config', label: 'Config', exists: !!command.gameConfig }
  ].filter(s => s.exists));

  function scrollToSection(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<!-- Add after header, before content -->
<div class="sticky top-14 z-20 -mx-4 px-4 py-3 bg-dark-bg/95 backdrop-blur border-b border-dark-border overflow-x-auto lg:hidden">
  <div class="flex gap-2 min-w-max">
    {#each sections as section}
      <button
        onclick={() => scrollToSection(section.id)}
        class="px-3 py-1.5 rounded-full text-sm font-medium
               bg-dark-card text-dark-300 hover:bg-dark-hover hover:text-dark-100
               transition-colors whitespace-nowrap"
      >
        {section.label}
      </button>
    {/each}
  </div>
</div>
```

**UX Details**:
- Sticky below header
- Horizontal scroll for overflow
- Only shows on mobile (lg:hidden)
- Dynamically shows only existing sections
- Smooth scroll to section

**Files Modified**:
- `docs/src/routes/commands/[category]/[command]/+page.svelte`
- Add `id` attributes to each section

---

## Phase 3: Enhanced Search

### 3.1 Recent Searches

**Problem**: Users often search for the same commands repeatedly.

**Solution**: Store and display recent searches when opening the search modal.

**Implementation**:

```typescript
// docs/src/lib/stores/recentSearches.ts
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'commishbot-recent-searches';
const MAX_RECENT = 5;

function createRecentSearches() {
  const initial = browser
    ? JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    : [];

  const { subscribe, set, update } = writable<string[]>(initial);

  return {
    subscribe,
    add: (query: string) => {
      update(searches => {
        const filtered = searches.filter(s => s !== query);
        const updated = [query, ...filtered].slice(0, MAX_RECENT);
        if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    clear: () => {
      set([]);
      if (browser) localStorage.removeItem(STORAGE_KEY);
    }
  };
}

export const recentSearches = createRecentSearches();
```

**SearchModal Update**:
```svelte
<!-- docs/src/lib/components/organisms/SearchModal.svelte -->
<script lang="ts">
  import { recentSearches } from '$lib/stores/recentSearches';
  // ... existing code ...

  function handleSelect(result: SearchResult): void {
    recentSearches.add(result.item.name);
    navigateToResult(result);
  }
</script>

<!-- Show recent searches when query is empty -->
{#if !query && $recentSearches.length > 0}
  <div class="p-4 border-b border-dark-border">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-dark-400 uppercase tracking-wide">Recent</span>
      <button onclick={() => recentSearches.clear()} class="text-xs text-dark-400 hover:text-dark-200">
        Clear
      </button>
    </div>
    <div class="flex flex-wrap gap-2">
      {#each $recentSearches as search}
        <button
          onclick={() => { query = search; }}
          class="px-3 py-1 rounded-full bg-dark-hover text-dark-200 text-sm hover:bg-dark-600"
        >
          /{search}
        </button>
      {/each}
    </div>
  </div>
{/if}
```

**Files**:
- NEW: `docs/src/lib/stores/recentSearches.ts`
- `docs/src/lib/components/organisms/SearchModal.svelte`

---

### 3.2 Category Filter Chips

**Problem**: Search results mix all categories. Users often want commands from a specific category.

**Solution**: Clickable category chips to filter results.

**Implementation**:

```svelte
<!-- Add to SearchModal.svelte -->
<script lang="ts">
  import { categories } from '$lib/data/commands';

  let selectedCategory = $state<string | null>(null);

  let filteredResults = $derived(
    selectedCategory
      ? results.filter(r => r.item.categorySlug === selectedCategory)
      : results
  );
</script>

<!-- Category filter chips -->
<div class="px-4 py-2 border-b border-dark-border overflow-x-auto">
  <div class="flex gap-2 min-w-max">
    <button
      onclick={() => selectedCategory = null}
      class="px-3 py-1 rounded-full text-xs font-medium transition-colors
             {!selectedCategory ? 'bg-accent-primary text-white' : 'bg-dark-hover text-dark-300 hover:bg-dark-600'}"
    >
      All
    </button>
    {#each categories as category}
      <button
        onclick={() => selectedCategory = category.slug}
        class="px-3 py-1 rounded-full text-xs font-medium transition-colors
               {selectedCategory === category.slug ? 'bg-accent-primary text-white' : 'bg-dark-hover text-dark-300 hover:bg-dark-600'}"
      >
        {category.name}
      </button>
    {/each}
  </div>
</div>
```

**Files Modified**:
- `docs/src/lib/components/organisms/SearchModal.svelte`

---

### 3.3 Popular Commands (Empty State)

**Problem**: Empty search modal is wasted space. Users don't know what to search for.

**Solution**: Show popular/suggested commands when no query.

**Implementation**:

```svelte
<!-- Add to SearchModal.svelte -->
<script lang="ts">
  // Define popular commands (could be dynamic based on analytics later)
  const popularCommands = ['daily', 'balance', 'slots', 'train', 'rob'];

  let popular = $derived(
    allCommands.filter(c => popularCommands.includes(c.name))
  );
</script>

<!-- Empty state with popular commands -->
{#if !query}
  <div class="p-4">
    <h3 class="text-xs text-dark-400 uppercase tracking-wide mb-3">Popular Commands</h3>
    <div class="space-y-1">
      {#each popular as cmd}
        <button
          onclick={() => navigateToCommand(cmd)}
          class="w-full flex items-center gap-3 p-3 rounded-lg text-left
                 text-dark-200 hover:bg-dark-hover transition-colors"
        >
          <code class="font-mono text-accent-primary">/{cmd.name}</code>
          <span class="text-sm text-dark-400 truncate">{cmd.description}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}
```

**Files Modified**:
- `docs/src/lib/components/organisms/SearchModal.svelte`

---

## Phase 4: Engagement Features

### 4.1 Favorites System

**Problem**: Users can't quickly access their most-used commands.

**Solution**: Star button on commands, favorites section on home page.

**Implementation**:

```typescript
// docs/src/lib/stores/favorites.ts
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'commishbot-favorites';

function createFavorites() {
  const initial = browser
    ? JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    : [];

  const { subscribe, set, update } = writable<string[]>(initial);

  function save(favorites: string[]): void {
    if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  }

  return {
    subscribe,
    toggle: (commandName: string) => {
      update(favorites => {
        const updated = favorites.includes(commandName)
          ? favorites.filter(f => f !== commandName)
          : [...favorites, commandName];
        save(updated);
        return updated;
      });
    },
    isFavorite: (commandName: string, favorites: string[]) => favorites.includes(commandName)
  };
}

export const favorites = createFavorites();
```

**Command Page Update**:
```svelte
<!-- Add to command page header -->
<script lang="ts">
  import { favorites } from '$lib/stores/favorites';

  let isFavorite = $derived($favorites.includes(command.name));
</script>

<button
  onclick={() => favorites.toggle(command.name)}
  class="p-2 rounded-lg hover:bg-dark-hover transition-colors"
  aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
>
  <Icon
    name={isFavorite ? 'starFilled' : 'star'}
    class={isFavorite ? 'text-accent-warning' : 'text-dark-400'}
  />
</button>
```

**Home Page Section**:
```svelte
<!-- Add to +page.svelte -->
{#if $favorites.length > 0}
  <section class="mb-12">
    <h2 class="text-xl font-bold text-dark-100 mb-4">Your Favorites</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {#each favoriteCommands as cmd}
        <CommandCard command={cmd} compact />
      {/each}
    </div>
  </section>
{/if}
```

**Files**:
- NEW: `docs/src/lib/stores/favorites.ts`
- `docs/src/routes/commands/[category]/[command]/+page.svelte`
- `docs/src/routes/+page.svelte`

---

### 4.2 "NEW" Badges

**Problem**: Users don't know which commands were recently added.

**Solution**: Badge on commands added in the last 30 days.

**Implementation**:

**Data Update** (add to each command in JSON files):
```json
{
  "name": "train",
  "dateAdded": "2024-12-15",
  // ... rest of command
}
```

**Badge Component**:
```svelte
<!-- docs/src/lib/components/atoms/NewBadge.svelte -->
<script lang="ts">
  interface Props {
    dateAdded?: string;
  }

  let { dateAdded }: Props = $props();

  let isNew = $derived(() => {
    if (!dateAdded) return false;
    const added = new Date(dateAdded);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return added > thirtyDaysAgo;
  });
</script>

{#if isNew}
  <span class="px-2 py-0.5 text-xs font-bold rounded bg-accent-success/20 text-accent-success uppercase">
    New
  </span>
{/if}
```

**Files**:
- NEW: `docs/src/lib/components/atoms/NewBadge.svelte`
- `docs/src/lib/data/commands/*.json` (add dateAdded fields)
- `docs/src/lib/components/organisms/CommandCard.svelte`
- `docs/src/routes/commands/[category]/[command]/+page.svelte`

---

### 4.3 What's New / Changelog Page

**Problem**: No way to see what's been added or changed in the bot.

**Solution**: Dedicated changelog page.

**Implementation**:

```json
// docs/src/lib/data/changelog.json
[
  {
    "date": "2024-12-19",
    "version": "3.2.0",
    "changes": [
      {
        "type": "feature",
        "title": "Training Ground System",
        "description": "New idle game for developing rookie players",
        "commands": ["train", "shop", "inventory"]
      },
      {
        "type": "improvement",
        "title": "Football-themed Economy",
        "description": "Daily, work, and rob commands now have football flavor text"
      }
    ]
  }
]
```

```svelte
<!-- docs/src/routes/changelog/+page.svelte -->
<script lang="ts">
  import changelog from '$lib/data/changelog.json';
  import DocsLayout from '$lib/components/templates/DocsLayout.svelte';
  import Badge from '$lib/components/atoms/Badge.svelte';
</script>

<svelte:head>
  <title>What's New - CommishBot Docs</title>
</svelte:head>

<DocsLayout title="What's New" description="Recent updates and new features">
  <div class="space-y-8">
    {#each changelog as release}
      <article class="card">
        <div class="flex items-center gap-3 mb-4">
          <span class="text-lg font-bold text-dark-100">{release.version}</span>
          <span class="text-sm text-dark-400">{release.date}</span>
        </div>
        <ul class="space-y-4">
          {#each release.changes as change}
            <li class="flex gap-3">
              <Badge
                variant={change.type === 'feature' ? 'category' : 'optional'}
                text={change.type}
              />
              <div>
                <h3 class="font-semibold text-dark-100">{change.title}</h3>
                <p class="text-dark-300 text-sm">{change.description}</p>
                {#if change.commands}
                  <div class="flex gap-2 mt-2">
                    {#each change.commands as cmd}
                      <a href="/commands/{cmd}" class="text-accent-primary text-sm font-mono hover:underline">
                        /{cmd}
                      </a>
                    {/each}
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </article>
    {/each}
  </div>
</DocsLayout>
```

**Files**:
- NEW: `docs/src/lib/data/changelog.json`
- NEW: `docs/src/routes/changelog/+page.svelte`
- `docs/src/lib/components/organisms/Sidebar.svelte` (add nav link)

---

## Phase 5: Advanced Features

### 5.1 PWA Support

**Problem**: Site can't be installed or used offline.

**Solution**: Add manifest and service worker.

**Implementation**:

```json
// docs/static/manifest.json
{
  "name": "CommishBot Docs",
  "short_name": "CommishBot",
  "description": "Documentation for CommishBot Discord bot",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1e1f22",
  "theme_color": "#5865f2",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

**App.html Update**:
```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#5865f2" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

**Service Worker** (using SvelteKit's built-in support or @vite-pwa/sveltekit):
```typescript
// docs/src/service-worker.ts
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

const CACHE = `cache-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request);
    })
  );
});
```

**Files**:
- NEW: `docs/static/manifest.json`
- NEW: `docs/static/icon-192.png`
- NEW: `docs/static/icon-512.png`
- NEW: `docs/src/service-worker.ts`
- `docs/src/app.html`
- `docs/svelte.config.js` (enable service worker)

---

### 5.2 Light Theme Toggle

**Problem**: Some users prefer light mode for readability.

**Solution**: Theme toggle in header with system preference detection.

**Implementation**:

```typescript
// docs/src/lib/stores/theme.ts (update existing)
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'dark' | 'light' | 'system';

function createTheme() {
  const stored = browser ? localStorage.getItem('theme') as Theme : 'system';
  const { subscribe, set } = writable<Theme>(stored || 'system');

  function applyTheme(theme: Theme): void {
    if (!browser) return;

    const isDark = theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }

  return {
    subscribe,
    set: (theme: Theme) => {
      set(theme);
      if (browser) localStorage.setItem('theme', theme);
      applyTheme(theme);
    },
    init: () => {
      if (browser) {
        applyTheme(stored || 'system');
        window.matchMedia('(prefers-color-scheme: dark)')
          .addEventListener('change', () => applyTheme(stored || 'system'));
      }
    }
  };
}

export const theme = createTheme();
```

**Tailwind Config Update**:
```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Add light theme colors
        light: {
          bg: '#ffffff',
          card: '#f5f5f6',
          // ... etc
        }
      }
    }
  }
};
```

**Files Modified**:
- `docs/src/lib/stores/theme.ts`
- `docs/tailwind.config.js`
- `docs/src/lib/components/organisms/Header.svelte` (add toggle)
- `docs/src/app.css` (light theme styles)

---

## Implementation Checklist

### Phase 1 (Quick Wins) - ~2 hours
- [ ] Copy-to-clipboard on CodeBlock
- [ ] Add copy/check icons to Icon component
- [ ] Back-to-top button component
- [ ] Prev/Next navigation on command pages
- [ ] Widen mobile search bar

### Phase 2 (Mobile Nav) - ~6 hours
- [ ] Bottom navigation bar component
- [ ] Safe area CSS for notched devices
- [ ] Swipe gestures for sidebar
- [ ] Scroll progress indicator
- [ ] Jump-to-section pills

### Phase 3 (Search) - ~3 hours
- [ ] Recent searches store
- [ ] Recent searches UI in modal
- [ ] Category filter chips
- [ ] Popular commands empty state

### Phase 4 (Engagement) - ~5 hours
- [ ] Favorites store
- [ ] Favorite button on commands
- [ ] Favorites section on home
- [ ] dateAdded to command JSONs
- [ ] NewBadge component
- [ ] Changelog data file
- [ ] Changelog page

### Phase 5 (Advanced) - ~6 hours
- [ ] PWA manifest
- [ ] App icons (192, 512)
- [ ] Service worker
- [ ] Theme store update
- [ ] Light theme colors
- [ ] Theme toggle UI

---

## Success Metrics

1. **Mobile Usability**: Bottom nav should reduce scroll-to-top actions by 80%
2. **Copy Actions**: Track clipboard copy events (if analytics added)
3. **Search Efficiency**: Recent searches should reduce repeat searches
4. **Engagement**: Favorites usage indicates value
5. **PWA Installs**: Track Add to Home Screen events

---

## Notes

- All touch targets maintain 44px minimum size
- All animations respect `prefers-reduced-motion`
- All new components follow existing atomic design pattern
- Light theme is optional and can be deferred
- PWA can be implemented incrementally (manifest first, then service worker)
