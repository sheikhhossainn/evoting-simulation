# Design Guide — SecureVote BD

> Quick reference for building consistent UI. Read this before creating any page.

## Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `bd-green-600` | `#006A4E` | Primary buttons, success states, voter accent |
| `bd-navy-900` | `#0A2540` | Headings, card headers, navbar background |
| `bd-gold-500` | `#C8920A` | Tags, badges, demo credential boxes, admin accent |
| `bd-red-500` | `#F42A41` | Error states, destructive actions only |
| `#627d98` | — | Secondary text, descriptions |
| `#9fb3c8` | — | Placeholder text, disabled text |
| `#F2F5FA` | — | Page background (all pages) |
| `#ffffff` | — | Card background |

## Typography

- **Font**: Inter (sans), JetBrains Mono (code/IDs)
- **Headings**: `font-bold`, color `#0A2540`
- **Body text**: `text-sm`, color `#627d98`
- **Tags/labels**: `text-[11px] font-bold uppercase tracking-[0.15em]`

## CSS Classes

```
.glass-card    — White card with border + shadow (auto hover effect)
.btn-primary   — Green CTA button (#006A4E)
.btn-navy      — Dark navy button (#0A2540)
.btn-ghost     — Outlined secondary button
.input-field   — Light-theme text input (use on white/light pages)
.input-field-dark — Dark-theme input (only if page has dark bg)
```

## Page Layout Rules

1. **Public pages** (Home, How to Vote, About) — wrap in `<Layout>` via App.tsx. Gets navbar automatically.
2. **Portal pages** (voter, keyholder, admin) — standalone, **no navbar**. Add a `← Back to Home` link at the bottom.
3. Background: always `style={{ background: "#F2F5FA" }}` on the root div.
4. Max content width: `max-w-md` for login forms, `max-w-3xl` for content pages, `max-w-5xl` for grids.

## Card Header Pattern

Login/portal cards use a dark navy header strip:

```tsx
<div className="glass-card overflow-hidden">
  <div className="flex items-center gap-2 px-6 py-3.5" style={{ background: "#0A2540" }}>
    {/* icon */}
    <span className="text-sm font-semibold text-white">Card Title</span>
  </div>
  <div className="p-6">
    {/* card content */}
  </div>
</div>
```

## Demo Credentials Box

```tsx
<div className="mt-4 rounded-lg border p-4"
  style={{ borderColor: "rgba(200,146,10,0.25)", background: "rgba(200,146,10,0.04)" }}>
  {/* gold-themed info box */}
</div>
```

## Do / Don't

| ✅ Do | ❌ Don't |
|------|---------|
| Use `bd-green-600` for primary actions | Use raw red/blue/indigo |
| Use `glass-card` for all cards | Create custom card styles |
| Use `#0A2540` for headings | Use Tailwind's default `text-gray-900` |
| Keep login pages standalone (no navbar) | Add navbar to portal/functional pages |
| Use inline `style={{ color: "#627d98" }}` for one-off text colors | Invent new gray shades |
| Use `font-mono` for NID, share IDs, hashes | Use monospace for regular text |
