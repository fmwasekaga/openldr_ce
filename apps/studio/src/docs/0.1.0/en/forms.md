# Forms

Forms create structured web capture screens for operational or clinical data. They move through Draft, Published, and Archived states so teams can design safely before users submit data.

## Outcome

You can create a form, configure metadata, add fields, preview, save a draft, publish, compare versions, submit a response, and manage the form lifecycle.

![Forms list with state and actions](forms-list.png)

## Before you begin

- Know whether the form should be a custom form or aligned to a FHIR resource type.
- Decide which pages users should see when opening, submitting, or reviewing the form.
- Prepare terminology bindings if coded answers are required.

## Steps

1. Open **Forms**.
2. Review the list and state badges: Draft, Published, or Archived.
3. Open **Form actions** and choose **New**.
4. Enter the form name and optional version label.
5. Choose the FHIR version and resource type if this form maps to a FHIR resource.
6. Configure target pages so users land in the correct capture and review flow.
7. Open the builder.
8. Add fields from the palette.
9. Select a field to configure label, help text, required state, validation, terminology binding, repeatability, and conditional visibility.
10. Reorder fields by dragging them in the canvas.
11. Remove fields only after confirming no published workflow or report depends on them.
12. Use **Preview** to test the form before publishing.
13. Select **Save draft**.
14. Select **Publish** when the form is ready for users.
15. Use **Compare** to review changes between versions.

![Form builder with field palette, preview, editor, and actions](form-builder.png)

16. From the form list, choose **View/Run**.
17. Fill required fields and submit the response.

![Published form capture screen](form-capture.png)

18. Use form actions to duplicate, archive, export, export a marketplace bundle, or delete when appropriate.

## Expected result

The form is saved as a draft during design, published when ready, and available from **View/Run** for structured submissions.

## Troubleshooting

- **Publish is unavailable:** finish required form metadata or fix invalid field configuration.
- **A required field blocks submission:** confirm the field type, validation rule, and conditional visibility.
- **A terminology field has no options:** check the terminology binding and the selected ValueSet.
- **Users see the wrong page after submit:** review the configured target pages.

## Advanced web usage

- Use validation rules for format, range, and required-value checks close to the point of capture.
- Use conditional visibility to keep forms shorter while still collecting detail when it matters.
- Bind coded fields to terminology so downstream reports and workflows receive consistent values.
- Use repeatable fields for repeated observations instead of creating many near-duplicate fields.
- Treat published versions as user-facing contracts; create a new version when changing meaning, not just wording.

## Related guides

- [Terminology](/docs/terminology)
- [Marketplace](/docs/marketplace)
