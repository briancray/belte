/*
Render mode shared by the dom helpers. In the default (create) mode `hydration`
is undefined and helpers build fresh nodes. During `hydrate` it holds, per parent,
the next server-rendered child node to claim — a node pointer (not an index) so it
survives nodes a block inserts (anchors) mid-hydration. Helpers claim in build
order, which matches the SSR order, advancing the pointer to the next sibling.
*/
export const RENDER: { hydration: { next: Map<Node, Node | null> } | undefined } = {
    hydration: undefined,
}
