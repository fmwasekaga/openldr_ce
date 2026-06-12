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
      from: { path: '(^|/)packages/(fhir|forms|ingest|plugins|reporting|audit|users)/' },
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
