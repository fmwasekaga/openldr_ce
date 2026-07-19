# Users and Roles

Administrators use **Users and Roles** to control account access, feature visibility, and role-based permissions.

## Outcome

You can search the user list, create a user, edit profile fields, assign roles, enable or disable access, use reset actions, and understand why a user can or cannot see a feature.

![Users list with search and account state](users-list.png)

## Before you begin

- You need the Lab Admin role.
- Know the minimum role set the user needs for their work.
- Confirm whether identity details are managed locally or by an external identity provider.

## Steps

1. Open **Users**.
2. Search by username, display name, or email.
3. Select the create action to add a new user when needed.
4. Enter profile fields such as username, display name, and email.
5. On the row for the account you want to change, open its **Actions** menu (the **⋯** button, labelled *Actions for &lt;username&gt;*) and choose **Edit**.
6. Assign only the roles required for the user’s tasks.
7. Enable or disable the account state.
8. Use reset actions only when the UI shows they are available for the account type.
9. Save the changes.

![User edit dialog with profile, roles, status, and save](user-edit-roles.png)

## Expected result

The user record reflects the updated profile, roles, and status. Navigation and feature visibility update according to the assigned roles.

## Troubleshooting

- **Permission denied:** check whether the user has the role required by the page or action.
- **A page is hidden:** feature visibility follows assigned roles and enabled application areas.
- **Reset actions are missing:** the account may be controlled by an identity provider.
- **A disabled user can still see an old screen:** ask them to sign out and sign back in after the status change.

## Advanced web usage

Use least privilege: grant the smallest role set that lets the user complete their work. Local profile fields can usually be edited in the app, while identity-provider-controlled actions may appear as read-only or unavailable depending on the account source.

## Related guides

- [Audit](/docs/audit)
- [Settings](/docs/settings)
