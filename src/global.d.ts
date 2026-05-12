/// <reference types="@sveltejs/kit" />

// Svelte's own `*.svelte` module declaration comes from the package's
// `svelte/elements` / `svelte` types and supports both default and named
// (module-script) exports. Don't redeclare it here — a narrower default-only
// declaration would suppress named exports like `buttonVariants`.
