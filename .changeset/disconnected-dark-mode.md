---
"@briancray/belte": patch
---

Default bundle connect screen now follows the OS dark-mode setting. Added
Tailwind `dark:` variants (driven by `prefers-color-scheme`) across the
background, card, input, buttons, divider, and footer — all grayscale except the
red error message. A project that ships its own `src/bundle/disconnected.svelte`
is unaffected.
