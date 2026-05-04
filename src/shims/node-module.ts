// Empty shim for `node:module` in client bundles. Mermaid's transitive
// dependency `cytoscape-fcose` imports `node:module` purely for an
// ESM-detection trick that we don't need in the browser. Pointing the
// import at this stub satisfies the bundler without changing runtime
// behaviour.

export function createRequire(): (id: string) => unknown {
  return () => {
    throw new Error("createRequire() is not supported in the browser");
  };
}

export default {};
