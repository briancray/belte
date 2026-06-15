/* A routable page: mounts into a host (optionally with props) and may return a
   disposer the router calls when navigating away. */
export type Route = (host: Element, props?: unknown) => (() => void) | undefined
