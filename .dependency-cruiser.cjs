/** Enforces hexagonal boundaries (DP-1). Only `bootstrap` may import a concrete adapter. */
module.exports = {
  forbidden: [
    {
      name: 'no-adapter-imports-outside-bootstrap',
      comment: 'Only @openldr/bootstrap may import a concrete adapter-* package.',
      severity: 'error',
      from: { pathNot: '(^|/)packages/(bootstrap|adapter-[^/]+)/' },
      to: { path: '(^|/)packages/adapter-[^/]+/' },
    },
    {
      name: 'no-inter-adapter-imports',
      comment: 'An adapter may not import another adapter; only bootstrap composes them.',
      severity: 'error',
      from: { path: 'packages/(adapter-[^/]+)/' },
      to: { path: 'packages/(adapter-[^/]+)/', pathNot: 'packages/$1/' },
    },
    {
      name: 'ports-stays-pure',
      comment: 'ports must not depend on any other workspace package.',
      severity: 'error',
      from: { path: '(^|/)packages/ports/' },
      to: { path: '(^|/)packages/(?!ports/)[^/]+/' },
    },
    {
      name: 'domain-modules-no-apps',
      comment: 'Domain modules must not reach into apps.',
      severity: 'error',
      from: { path: '(^|/)packages/(fhir|forms|ingest|plugins|reporting|audit|users|marketplace)/' },
      to: { path: '(^|/)apps/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Never analyze build output — minified vendor bundles (e.g. jspdf/docx) contain
    // internal circular chunks that are not source-level boundary concerns.
    exclude: { path: '(^|/)dist/' },
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default'],
      extensions: ['.ts', '.js', '.json'],
      mainFields: ['module', 'main'],
    },
  },
};
