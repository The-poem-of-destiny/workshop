# Frontend fidelity mapping

**Reference:** read-only `../workshop-legacy` at `15303df5e3b30aa7f3fc924296ae57497a7ad09a`.

**Scope:** `apps/worker/web` restores the legacy visual hierarchy while retaining the current Worker-backed product flows. This is not a restoration of legacy feature behavior or its former multi-page information architecture.

## Evidence-to-implementation map

| Legacy evidence | Faithful current implementation |
| --- | --- |
| `cloudflare/src/pages/home/render/layout.ts`: desktop layout activates at `min-width: 1024px`; `renderDesktopSidebar()` provides browse navigation; `renderHeader()` combines compact search, utilities, and account action. | `App.tsx` renders a desktop-only sidebar at the same breakpoint; the current top navigation remains visible below 1024px, including 821–1023px. The catalogue header contains compact search and current account action. |
| `cloudflare/src/pages/home/shell-styles.ts`: desktop shell is `204px minmax(0,1fr)` with `18px` gap; sidebar is sticky at `16px`; the desktop search/tool bar uses a `40px` control height. | `styles.css` sets the desktop shell to `204px minmax(0, 1fr)`, `18px` gap, sticky `16px` sidebar and a compact 38–40px search treatment. |
| `render/layout.ts` `renderProjectsGrid()` and `shell-styles.ts` use an auto-fill project grid with `minmax(220px, 1fr)` and `12px` gap. | `styles.css` uses a tight catalogue grid with 12px gaps and responsive 4/3/2/1 columns. This keeps the dense legacy scan rhythm while avoiding an interactive whole-card container around nested controls. |
| `render/cards.ts` orders creator, compact title/type, artwork or text preview, tags, and a footer with download/like signals and install action inside a dark card. | `ProjectCard` follows that hierarchy: creator; separate title-open control and compact type/version; separate cover-open control or a text preview from current description/author note; tags; then a footer with current entry/count/date/schema signals and the safe optional Discord link. Cover and title remain separately accessible controls. |
| `styles.ts` effective `.project-detail-modal` override (`1476`), not the generic modal: `max-width:1480px`, height `calc(100dvh - 48px)`; dark blurred overlay and scrollable content. | `Detail` overrides the generic Radix primitive dimensions with those project-detail dimensions; mobile is full-screen. It explicitly sets modal semantics, focuses Close initially and restores the retained opener on close. Radix owns focus trapping, Escape and scroll isolation. |
| `render/detail-modal.ts:514–532` plus final `styles.ts:1858–1893`: media and reading column beside a sticky summary rail, 2:1 columns, collapse at 1050px; mobile places description ahead of operational actions. | `Detail` uses media then reading in the left column and a persistent right operations rail; tablet/mobile orders media → reading → operations. Current DTO summary/metadata and actual install/download/interaction behavior remain; no unavailable full-content payload is synthesized. |
| `styles.ts` `.project-form-modal` establishes a dense dark workspace: dark panel, small borders, two-column editing, compact field groups and gold primary action. | `ProjectEditor`, reviewer queue, and owner tools share compact `.panel`, `.workspace`, `.admin-layout`, `.form-grid`, upload and action treatments. Their existing operation flows and data display remain intact. |
| Legacy primary control is gold `#bea47d` with dark text `#151619`; surfaces use `#18191c`/`#151619` and low-opacity white borders. | `styles.css` and local shadcn `Button` use the same primary, surface, and border hierarchy; neutral controls remain subdued until hover/focus. |

## Intentional functional deviations

These are product decisions and are therefore not visual regressions:

1. **One catalogue, not a legacy discovery page.** The current product retains a single searchable catalogue and a four-card discovery strip only. Legacy shelves, daily random draw, editor-pick shelves, and a standalone discovery navigation mode are intentionally absent.
2. **Current API and authentication flows remain authoritative.** The interface keeps Worker API DTOs, Discord login, browser download, embedded acquisition/install/uninstall, subscriptions, authoring, reviewer queues, and owner tools. Legacy in-page state and obsolete installation controls are not revived.
3. **Cards do not use legacy whole-card button semantics.** Cover and title remain separate accessible opening controls so the card may safely include Discord and other independent controls without nested interactive elements.
4. **The current fields remain visible.** Schema version, worldbook/regex counts, author note, published/updated dates, current installation state, and conditional Discord link reflect current contracts even where legacy sources did not expose those exact fields.
5. **Creator/reviewer/owner work is workspace-based.** The legacy dark modal/panel language is restored, but the current left-list/editor and reviewer queue workflows are retained because they support current multi-step API operations.

## Tailwind and shadcn integration

- Tailwind v4 is enabled through `@tailwindcss/vite` in `apps/worker/web/vite.config.ts`, with `@import "tailwindcss"` in the application stylesheet.
- Local shadcn-compatible primitives live in `src/components/ui`: `Button` uses Radix Slot plus CVA; `Dialog` uses Radix Dialog; `Input` and `Textarea` are active form primitives.
- `src/lib/utils.ts` supplies the standard class merge utility used by those primitives.
- The implementation uses these primitives in live header, login/account actions, project detail modal, and author-editor fields; they are not dependency-only artifacts.

## Responsive behavior

- **Desktop (≥1024px):** sticky 204px sidebar plus compact main toolbar and dense project grid.
- **Mid-width:** sidebar is replaced by current top navigation; grids reduce before workspaces collapse.
- **Mobile (≤640px):** controls wrap without horizontal scrolling; the catalogue uses two columns (one at very narrow widths); project detail becomes a full-height dialog; form and reviewer comparisons collapse to one column.
- The compact search keeps its visible gold focus treatment on the surrounding control via `:focus-within`.
- `prefers-reduced-motion` suppresses nonessential transitions.

## Independent review and runtime evidence

- Round 1: seven material findings (navigation dead zone, focus return/search focus, effective detail dimensions, persistent rail/breakpoint, mobile reading order, saved zoom override); repaired.
- Round 2: dirty published-metadata loss on same-project rowVersion refresh and frozen controls that silently ignored input; repaired.
- Round 3: independent source review confirmed both state/control repairs. Published metadata stays independent of frozen draft editing; cover upload preserves dirty values.
- Browser-backed local E2E has exercised anonymous desktop/mobile catalogue and detail, actual sort order, detail interactions and author workspace. Final complete E2E and image-inspection results are recorded in `state.md`; screenshots are internal evidence, not a user deliverable.
- 续作 E2E 暴露关系状态加载前的交互竞态；like／subscribe 在 `meState` 就绪前禁用，浏览器按 native enabled 状态读取关系再操作。续作完整 E2E 21/21 通过，含订阅页与作者后续流程。
