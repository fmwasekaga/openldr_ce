# Connectors

Connectors define approved destinations and integration settings that workflows can use from the web interface.

## Outcome

You can list connectors, create one, select a plugin, enter name and configuration, save, test, edit, enable or disable, remove, and rotate credentials safely.

![Connectors list with configured destinations](connectors-list.png)

## Before you begin

- You need administrator access.
- Know which installed plugin should power the connector.
- Prepare non-secret configuration and any credential values.

## Steps

1. Open **Settings** and then **Connectors**.
2. Review existing connector names, plugin types, and enabled state.
3. Choose the add connector action.
4. Select the `test-sink` plugin when following the training example.
5. Enter the name `Training destination`.
6. Complete required configuration fields.
7. Confirm masked secret fields are filled only with the intended credential values.
8. Choose whether the connector starts enabled.
9. Save the connector.
10. Use the test action if the UI provides one for the selected plugin.
11. Edit, enable, disable, or remove the connector from the list when needed.

![Connector form with plugin, name, configuration, enabled state, and save](connector-form.png)

## Expected result

The connector appears in the list and becomes available to workflows that can use its plugin type.

## Troubleshooting

- **The plugin is missing:** confirm the package is installed from Marketplace or by an administrator.
- **Save fails:** check required fields and configuration shape.
- **Test fails:** confirm destination availability and credential correctness.
- **A workflow cannot use the connector:** verify the connector is enabled and compatible with the workflow node.

## Advanced web usage

Rotate credentials by editing the connector, replacing secret values, saving, and testing before dependent workflows run again. Keep secrets masked and avoid copying them into notes, screenshots, or form labels.

## Related guides

- [Settings](/docs/settings)
- [Workflows](/docs/workflows)
- [Marketplace](/docs/marketplace)
