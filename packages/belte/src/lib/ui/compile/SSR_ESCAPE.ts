/*
Source text for the `$esc` / `$text` / `$snip` helpers injected into every SSR
render body. `$esc` escapes the five HTML-significant characters. `$snip` brands a
snippet's rendered string. `$text` is what `{expr}` interpolations push: a snippet
call's value is emitted raw between `<!--belte:snippet-->` markers (the client runs
its builder there to claim the nodes); a `html\`…\`` value raw between
`<!--belte:html-->` markers; anything else is escaped. The brands are registered
Symbols so they match across bundles. Emitted inline (not imported) so the
generated render module is self-contained.
*/
export const SSR_ESCAPE =
    'const $esc = (v) => String(v).replace(/[&<>"\']/g, (c) => ' +
    "({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c]);\n" +
    "const $RAW = Symbol.for('belte.rawHtml');\n" +
    "const $SNIP = Symbol.for('belte.snippet');\n" +
    'const $snip = (s) => ({ [$SNIP]: s });\n' +
    'const $text = (v) => (v !== null && typeof v === "object" && $SNIP in v) ' +
    "? ('<!--belte:snippet-->' + v[$SNIP] + '<!--/belte:snippet-->') " +
    ': (v !== null && typeof v === "object" && $RAW in v) ' +
    "? ('<!--belte:html-->' + v[$RAW] + '<!--/belte:html-->') : $esc(v);"
