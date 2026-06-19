import { describe, it, expect } from "vitest";
import { applyTableState } from "./applyTableState";
import type { ColumnDef } from "./types";

interface Row {
  id: string;
  name: string;
  age: number;
  sex: "m" | "f";
  dob: string; // ISO date
  email: string | null;
}

const cols: ColumnDef<Row>[] = [
  { id: "name", labelKey: "name", accessor: (r) => r.name, type: "text", defaultVisible: true },
  { id: "age",  labelKey: "age",  accessor: (r) => r.age,  type: "number", defaultVisible: true },
  { id: "sex",  labelKey: "sex",  accessor: (r) => r.sex,  type: "enum", defaultVisible: true,
    enumOptions: [{ value: "m", label: "m" }, { value: "f", label: "f" }] },
  { id: "dob",  labelKey: "dob",  accessor: (r) => r.dob,  type: "date", defaultVisible: true },
  { id: "email", labelKey: "email", accessor: (r) => r.email ?? "", type: "text", defaultVisible: false },
];

const rows: Row[] = [
  { id: "1", name: "Achieng",  age: 36, sex: "f", dob: "1990-05-12", email: "a@x.com" },
  { id: "2", name: "Kimaro",   age: 41, sex: "m", dob: "1985-07-22", email: null },
  { id: "3", name: "Mwangi",   age: 48, sex: "f", dob: "1978-03-10", email: "m@x.com" },
  { id: "4", name: "Noor",     age: 25, sex: "m", dob: "2001-11-05", email: null },
  { id: "5", name: "Santos",   age: 31, sex: "f", dob: "1995-06-30", email: "s@x.com" },
];

describe("applyTableState", () => {
  it("returns all rows + correct total when no filters/sorts apply", () => {
    const res = applyTableState(rows, { filters: [], sorts: [], page: 0, pageSize: 10 }, cols);
    expect(res.total).toBe(5);
    expect(res.rows.map((r) => r.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("filters by eq on enum", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "sex", operator: "eq", value: "f", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.total).toBe(3);
    expect(res.rows.every((r) => r.sex === "f")).toBe(true);
  });

  it("filters by like (case-insensitive substring)", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "name", operator: "like", value: "wa", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    // Mwangi matches "wa"
    expect(res.rows.map((r) => r.name)).toEqual(["Mwangi"]);
  });

  it("between on numeric column", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "age", operator: "between", value: ["30", "45"], combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Achieng", "Kimaro", "Santos"]);
  });

  it("between on date column (ISO strings)", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "dob", operator: "between", value: ["1990-01-01", "2000-12-31"], combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Achieng", "Santos"]);
  });

  it("is_null matches null and empty string", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "email", operator: "is_null", value: "", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Kimaro", "Noor"]);
  });

  it("combines AND + OR in the order given", () => {
    const res = applyTableState(rows, {
      filters: [
        { id: "a", column: "sex", operator: "eq", value: "f", combine: "and" },
        { id: "b", column: "age", operator: "gt", value: "40", combine: "and" },  // sex=f AND age>40 -> Mwangi
        { id: "c", column: "name", operator: "eq", value: "Noor", combine: "or" }, // OR name=Noor
      ],
      sorts: [], page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Mwangi", "Noor"]);
  });

  it("sorts ascending by numeric age", () => {
    const res = applyTableState(rows, {
      filters: [],
      sorts: [{ id: "s", column: "age", ascending: true }],
      page: 0, pageSize: 10,
    }, cols);
    expect(res.rows.map((r) => r.name)).toEqual(["Noor", "Santos", "Achieng", "Kimaro", "Mwangi"]);
  });

  it("sorts descending by ISO date (dob)", () => {
    const res = applyTableState(rows, {
      filters: [],
      sorts: [{ id: "s", column: "dob", ascending: false }],
      page: 0, pageSize: 10,
    }, cols);
    expect(res.rows[0]!.name).toBe("Noor"); // 2001 — most recent
  });

  it("paginates: respects page + pageSize and reports full total", () => {
    const p1 = applyTableState(rows, { filters: [], sorts: [{ id: "s", column: "name", ascending: true }], page: 0, pageSize: 2 }, cols);
    const p2 = applyTableState(rows, { filters: [], sorts: [{ id: "s", column: "name", ascending: true }], page: 1, pageSize: 2 }, cols);
    expect(p1.total).toBe(5);
    expect(p1.rows.map((r) => r.name)).toEqual(["Achieng", "Kimaro"]);
    expect(p2.rows.map((r) => r.name)).toEqual(["Mwangi", "Noor"]);
  });

  it("accepts a valueGetter override (e.g. for computed columns)", () => {
    const res = applyTableState(rows, {
      filters: [{ id: "x", column: "initial", operator: "eq", value: "K", combine: "and" }],
      sorts: [], page: 0, pageSize: 10,
    }, [
      ...cols,
      { id: "initial", labelKey: "initial", accessor: (r: Row) => r.name[0], type: "text", defaultVisible: false },
    ], {
      initial: (r) => r.name.charAt(0),
    });
    expect(res.rows.map((r) => r.name)).toEqual(["Kimaro"]);
  });
});
