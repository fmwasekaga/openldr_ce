/**
 * Placeholder for the Roles workspace. Task 11 replaces this with the real
 * role/capability management UI; this stub exists only so `/settings/roles`
 * compiles and renders something sane in the meantime. Rendered inside
 * SettingsShell's <Outlet/>, which already provides the AppShell chrome —
 * mirrors General.tsx and the other settings sub-pages.
 */
export function Roles() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="roles-page">
      <h1 className="text-lg font-semibold">Roles</h1>
    </div>
  );
}

export default Roles;
