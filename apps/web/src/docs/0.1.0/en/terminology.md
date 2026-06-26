# Terminology

Terminology pages help users browse code systems, inspect terms, manage ValueSets, and use ontology indexes from the web interface.

## Outcome

You can browse publishers and code systems, search terms, inspect term details, import terms, manage ValueSets, and understand when to use terms, ValueSets, or ontology indexes.

![Terminology overview with code systems and terms](terminology-overview.png)

## Before you begin

- Confirm that your organization is allowed to use the terminology source you want to import.
- Prepare files in the shape supported by the import dialog.
- Know whether you need individual terms, a curated ValueSet, or an ontology index.

## Steps

1. Open **Terminology**.
2. Browse publishers and code systems in the left or top-level navigation.
3. Select a code system to view available terms.
4. Use search to find a code, display name, or description.
5. Open a term to inspect identifiers, display names, status, and additional properties.
6. Open **Actions** and choose the term import action.
7. Select the import file and confirm the expected format.
8. Start the import and wait for completion.

![Terminology import dialog with format guidance](terminology-import.png)

9. Open ValueSet management when you need curated answer lists for forms or workflows.
10. Import or edit a ValueSet, then confirm its members.
11. Open ontology browsing when you need hierarchy or relationship exploration.
12. Use the ontology index view to inspect concepts and relationships.

## Expected result

Terms are searchable, ValueSets are available for coded fields, and ontology indexes can be browsed when the source includes hierarchy data.

## Troubleshooting

- **Unsupported file shape:** reopen the import dialog and compare your file to the required columns and format guidance.
- **Missing code or display name:** fix the source file before importing; both are needed for usable coded fields.
- **A source is unavailable:** confirm licensing and source availability before expecting the web app to show that terminology.
- **An ontology index is empty:** the code system may not include hierarchy data, or the ontology index has not been built for that source.

## Advanced web usage

- Use terms for individual coded observations.
- Use ValueSets when a form field needs a controlled list of allowed answers.
- Use ontology indexes when users need hierarchy, relationships, or concept exploration.
- Bind forms to terminology early so submitted data is consistent enough for reports and workflows.

## Related guides

- [Forms](/docs/forms)
- [Audit](/docs/audit)
