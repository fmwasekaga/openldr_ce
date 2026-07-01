import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@/i18n"; // side-effect: initialise i18next so useTranslation() resolves
import { DataTableToolbar } from "./DataTableToolbar";
import type { ColumnDef } from "./types";

const columns: ColumnDef<{ name: string }>[] = [
  { id: "name", labelKey: "users.name", type: "text", accessor: (r) => r.name, defaultVisible: true },
];

const noop = () => {};

describe("DataTableToolbar", () => {
  it("renders Filter, Sort, Columns buttons and a search box", () => {
    render(
      <DataTableToolbar
        columns={columns}
        filters={[]}
        onFiltersChange={noop}
        sorts={[]}
        onSortsChange={noop}
        visibleIds={["name"]}
        onVisibleIdsChange={noop}
        onResetColumns={noop}
        onResetAll={noop}
        searchValue=""
        onSearchChange={noop}
        searchPlaceholder="Search"
      />,
    );

    expect(screen.getByPlaceholderText("Search")).toBeTruthy();
    expect(screen.getByText(/filter/i)).toBeTruthy();
    expect(screen.getByText(/sort/i)).toBeTruthy();
    expect(screen.getByText(/columns/i)).toBeTruthy();
  });

  it("fires onSearchChange when the user types in the search box", () => {
    const onSearchChange = vi.fn();
    render(
      <DataTableToolbar
        columns={columns}
        filters={[]}
        onFiltersChange={noop}
        sorts={[]}
        onSortsChange={noop}
        visibleIds={["name"]}
        onVisibleIdsChange={noop}
        onResetColumns={noop}
        onResetAll={noop}
        searchValue=""
        onSearchChange={onSearchChange}
        searchPlaceholder="Search"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "alice" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("alice");
  });
});
