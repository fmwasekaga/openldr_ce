# Marketplace

Marketplace is where administrators browse available artifacts, inspect details, install approved packages, and manage registries.

## Outcome

You can use the Browse, Installed, and Registries views; inspect artifact details; compare versions and capabilities; approve an install; enable, disable, or remove installed artifacts; and create or edit a registry.

![Marketplace browse view with available artifacts](marketplace-browse.png)

## Before you begin

- You need administrator access.
- Know whether you are installing a form, workflow, connector plugin, or another supported artifact type.
- Confirm the artifact source is trusted before installing it.

## Steps

1. Open **Settings** and then **Marketplace**.
2. Use **Installed** to review what is already available.
3. Use **Browse** to see artifacts from configured registries.
4. Select an artifact card to open details.
5. Review version, compatibility, capabilities, documentation, and install action.
6. Choose the version that matches your app and operational need.
7. Approve installation when you are ready.
8. Return to **Installed** to enable, disable, or remove artifacts when supported.

![Marketplace artifact detail with version, permissions, documentation, and requirements](marketplace-detail.png)

9. Open **Registries**.
10. Select **Add registry**.
11. Enter registry name, kind, location, and enabled state.
12. Save the registry and refresh available packages if needed.

![Marketplace registries tab with add-registry form](marketplace-registries.png)

## Expected result

The selected artifact is installed or updated, and registries control which available artifacts appear for administrators.

## Troubleshooting

- **Install fails:** inspect compatibility, capabilities, and registry availability.
- **A package is missing:** check that the registry is enabled and reachable.
- **The wrong version is installed:** open details and select the intended version if available.
- **An installed artifact does not appear elsewhere:** confirm it is enabled and supported by that feature area.

## Advanced web usage

Compatibility tells you whether the artifact can run in this app version. Capabilities tell you what it can do. Registry source determines trust and update availability. When diagnosing install failures, compare registry state, artifact type, version, and capability requirements before retrying.

## Related guides

- [Settings](/docs/settings)
- [Connectors](/docs/connectors)
- [Forms](/docs/forms)
