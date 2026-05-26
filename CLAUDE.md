you are making a ssr + spa framwork for bun and svelte.

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface very small and simple
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all modes (dev and build)
* isomorphism by default — same callable, same name, same behavior on both sides; the bundler swaps the runtime (defineVerb/remoteProxy, defineSocket/socketProxy). user code never branches on `typeof window`.
* framework owns the network — no parallel "raw" escape hatches that fragment the model. one way to call rpc, one way to consume streams, one ws connection. if a primitive feels too low-level for users, hide it.
* group exports by lifecycle phase, not by implementation — declare (`belte/route`) → reply (`belte/respond`) → consume (`belte/consume`). new helpers go in the phase they belong to; if a new phase emerges, that's a new module.
* value performance when all other conditions are met

# coding guidelines

* write library files into src/lib/<logical grouping> with separate folders for types, server (functions), client (functions), shared (functions) and components
* use bun apis not node apis when possible
* only one export per file named after the export
* write pure functions and use functional style programming
* use the minimal amount of code to achieve a goal
* use descriptive variable names instead of abbrevations
* write short descriptive comments above each function and above code blocks that need explanation
* use /* and */ for multiline comments and // for single line comments
* write svelte 5 components
* always use full known types where possible instead of creating adhoc one-use types
* if a function is shared, add it to the proper  folder and check library folders for existing functionality before writing one
* run bun format on a file after all changes complete
* use tailwindcss classes for styling, and prefer tailwind classes over style properties when possible.
* always use openining and closing brackets for if statements, no single line ifsn on
* if you're transforming data, prefer functional instance and static methods like map, filter, reduce etc over for loops when applicable
* do not start long living bun servers with `bun run dev`. When i type that it's a mistake
* use undefined instead of null for nullish values unless a type needs null
* reactive consumers (cache, subscribe, future ones) use `createSubscriber` from `svelte/reactivity` so the surrounding $derived/$effect drives the underlying resource lifecycle — open on first read, close on last reader. don't invent parallel reactivity machinery.
* do not start long living bun servers with `bun run dev`. When i type that it's a mistake
