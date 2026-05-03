import { describe, it, expect } from "vitest";
import {
  computeRollover,
  insertRollovers,
  parseListItem,
  buildTree,
  hasUnchecked,
  getRolloverLines,
  getRemovalIndices,
  isCompletelyRemoved,
  parseTasksSection,
} from "./rollover";

// ── parseListItem ───────────────────────────────────────────────────────

describe("parseListItem", () => {
  it("parses unchecked checkbox", () => {
    expect(parseListItem("- [ ] Buy milk")).toEqual({
      indent: 0,
      isCheckbox: true,
      isChecked: false,
      checkState: "unchecked",
    });
  });

  it("parses checked checkbox", () => {
    expect(parseListItem("- [x] Done")).toEqual({
      indent: 0,
      isCheckbox: true,
      isChecked: true,
      checkState: "checked",
    });
  });

  it("parses uppercase X", () => {
    expect(parseListItem("- [X] Done")).toEqual({
      indent: 0,
      isCheckbox: true,
      isChecked: true,
      checkState: "checked",
    });
  });

  it("parses in-progress [/]", () => {
    expect(parseListItem("- [/] In progress")).toEqual({
      indent: 0,
      isCheckbox: true,
      isChecked: false,
      checkState: "in-progress",
    });
  });

  it("parses cancelled [-]", () => {
    expect(parseListItem("- [-] Cancelled")).toEqual({
      indent: 0,
      isCheckbox: true,
      isChecked: false,
      checkState: "cancelled",
    });
  });

  it("parses other extended markers ([?], [!]) as unchecked", () => {
    for (const marker of ["?", "!"]) {
      expect(parseListItem(`- [${marker}] Item`)).toEqual({
        indent: 0,
        isCheckbox: true,
        isChecked: false,
        checkState: "unchecked",
      });
    }
  });

  it("parses indented checkbox", () => {
    expect(parseListItem("  - [ ] Sub-task")).toEqual({
      indent: 2,
      isCheckbox: true,
      isChecked: false,
      checkState: "unchecked",
    });
  });

  it("parses plain list item", () => {
    expect(parseListItem("- Just a note")).toEqual({
      indent: 0,
      isCheckbox: false,
      isChecked: false,
      checkState: null,
    });
  });

  it("returns null for non-list lines", () => {
    expect(parseListItem("Some heading text")).toBeNull();
    expect(parseListItem("## Tasks")).toBeNull();
    expect(parseListItem("")).toBeNull();
  });
});

// ── buildTree ───────────────────────────────────────────────────────────

describe("buildTree", () => {
  it("builds flat list as roots", () => {
    const items = [
      { line: "- [ ] A", indent: 0, isCheckbox: true, isChecked: false, lineIndex: 0 },
      { line: "- [ ] B", indent: 0, isCheckbox: true, isChecked: false, lineIndex: 1 },
    ];
    const tree = buildTree(items);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(0);
    expect(tree[1].children).toHaveLength(0);
  });

  it("nests indented items", () => {
    const items = [
      { line: "- [ ] A", indent: 0, isCheckbox: true, isChecked: false, lineIndex: 0 },
      { line: "  - [ ] A1", indent: 2, isCheckbox: true, isChecked: false, lineIndex: 1 },
      { line: "  - [ ] A2", indent: 2, isCheckbox: true, isChecked: false, lineIndex: 2 },
      { line: "- [ ] B", indent: 0, isCheckbox: true, isChecked: false, lineIndex: 3 },
    ];
    const tree = buildTree(items);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[1].children).toHaveLength(0);
  });

  it("handles deep nesting", () => {
    const items = [
      { line: "- [ ] A", indent: 0, isCheckbox: true, isChecked: false, lineIndex: 0 },
      { line: "  - [ ] A1", indent: 2, isCheckbox: true, isChecked: false, lineIndex: 1 },
      { line: "    - [ ] A1a", indent: 4, isCheckbox: true, isChecked: false, lineIndex: 2 },
    ];
    const tree = buildTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].children).toHaveLength(1);
  });
});

// ── hasUnchecked ────────────────────────────────────────────────────────

describe("hasUnchecked", () => {
  it("returns true for unchecked node", () => {
    const node = { line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "unchecked" as const, children: [], lineIndex: 0 };
    expect(hasUnchecked(node)).toBe(true);
  });

  it("returns false for checked node with no children", () => {
    const node = { line: "", indent: 0, isCheckbox: true, isChecked: true, checkState: "checked" as const, children: [], lineIndex: 0 };
    expect(hasUnchecked(node)).toBe(false);
  });

  it("returns true for checked parent with unchecked child", () => {
    const node = {
      line: "", indent: 0, isCheckbox: true, isChecked: true, checkState: "checked" as const, lineIndex: 0,
      children: [
        { line: "", indent: 2, isCheckbox: true, isChecked: false, checkState: "unchecked" as const, children: [], lineIndex: 1 },
      ],
    };
    expect(hasUnchecked(node)).toBe(true);
  });

  it("returns true for in-progress node", () => {
    const node = { line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "in-progress" as const, children: [], lineIndex: 0 };
    expect(hasUnchecked(node)).toBe(true);
  });

  it("returns false for cancelled node", () => {
    const node = { line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "cancelled" as const, children: [], lineIndex: 0 };
    expect(hasUnchecked(node)).toBe(false);
  });

  it("returns false for cancelled parent even with unchecked children", () => {
    const node = {
      line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "cancelled" as const, lineIndex: 0,
      children: [
        { line: "", indent: 2, isCheckbox: true, isChecked: false, checkState: "unchecked" as const, children: [], lineIndex: 1 },
      ],
    };
    expect(hasUnchecked(node)).toBe(false);
  });
});

// ── isCompletelyRemoved ─────────────────────────────────────────────────

describe("isCompletelyRemoved", () => {
  it("returns true for lone unchecked node", () => {
    const node = { line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "unchecked" as const, children: [], lineIndex: 0 };
    expect(isCompletelyRemoved(node)).toBe(true);
  });

  it("returns false for checked node", () => {
    const node = { line: "", indent: 0, isCheckbox: true, isChecked: true, checkState: "checked" as const, children: [], lineIndex: 0 };
    expect(isCompletelyRemoved(node)).toBe(false);
  });

  it("returns false for cancelled node", () => {
    const node = { line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "cancelled" as const, children: [], lineIndex: 0 };
    expect(isCompletelyRemoved(node)).toBe(false);
  });

  it("returns false for in-progress node", () => {
    const node = { line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "in-progress" as const, children: [], lineIndex: 0 };
    expect(isCompletelyRemoved(node)).toBe(false);
  });

  it("returns false for unchecked node with a checked child", () => {
    const node = {
      line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "unchecked" as const, lineIndex: 0,
      children: [
        { line: "", indent: 2, isCheckbox: true, isChecked: true, checkState: "checked" as const, children: [], lineIndex: 1 },
      ],
    };
    expect(isCompletelyRemoved(node)).toBe(false);
  });

  it("returns false for unchecked node with a cancelled child", () => {
    const node = {
      line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "unchecked" as const, lineIndex: 0,
      children: [
        { line: "", indent: 2, isCheckbox: true, isChecked: false, checkState: "cancelled" as const, children: [], lineIndex: 1 },
      ],
    };
    expect(isCompletelyRemoved(node)).toBe(false);
  });

  it("returns true for unchecked node with all-unchecked children", () => {
    const node = {
      line: "", indent: 0, isCheckbox: true, isChecked: false, checkState: "unchecked" as const, lineIndex: 0,
      children: [
        { line: "", indent: 2, isCheckbox: true, isChecked: false, checkState: "unchecked" as const, children: [], lineIndex: 1 },
        { line: "", indent: 2, isCheckbox: true, isChecked: false, checkState: "unchecked" as const, children: [], lineIndex: 2 },
      ],
    };
    expect(isCompletelyRemoved(node)).toBe(true);
  });
});

// ── computeRollover ─────────────────────────────────────────────────────

describe("computeRollover", () => {
  it("returns null when no Tasks heading exists", () => {
    expect(computeRollover("# Daily\nSome content", "Tasks")).toBeNull();
  });

  it("returns null when no unchecked tasks exist", () => {
    const content = [
      "# Daily",
      "## Tasks",
      "- [x] Done item",
      "- [x] Another done",
    ].join("\n");
    expect(computeRollover(content, "Tasks")).toBeNull();
  });

  it("rolls over simple unchecked items", () => {
    const content = [
      "# Daily",
      "## Tasks",
      "- [ ] Unchecked A",
      "- [x] Checked B",
      "- [ ] Unchecked C",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result).not.toBeNull();
    expect(result.rolloverLines).toEqual([
      "- [ ] Unchecked A",
      "- [ ] Unchecked C",
    ]);
    expect(result.uncheckedCount).toBe(2);

    // Old content should retain only the checked item
    expect(result.newContent).toBe(
      ["# Daily", "## Tasks", "- [x] Checked B"].join("\n")
    );
  });

  it("handles group headings", () => {
    const content = [
      "# Daily",
      "## Tasks",
      "",
      "Crash list",
      "- [ ] Fix bug A",
      "- [x] Fix bug B",
      "",
      "Feature work",
      "- [x] Ship feature",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.rolloverLines).toEqual([
      "",
      "Crash list",
      "- [ ] Fix bug A",
    ]);
    expect(result.uncheckedCount).toBe(1);

    // Crash list heading should remain (it still has a checked item)
    expect(result.newContent).toContain("Crash list");
    expect(result.newContent).toContain("- [x] Fix bug B");
    // Feature work should be untouched
    expect(result.newContent).toContain("Feature work");
    expect(result.newContent).toContain("- [x] Ship feature");
  });

  it("adds blank lines between multiple rolled-over groups", () => {
    const content = [
      "# Daily",
      "## Tasks",
      "",
      "Crash list",
      "- [ ] Fix bug A",
      "",
      "Feature work",
      "- [ ] Ship feature",
      "",
      "- [ ] Standalone task",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.rolloverLines).toEqual([
      "",
      "Crash list",
      "- [ ] Fix bug A",
      "",
      "Feature work",
      "- [ ] Ship feature",
      "",
      "- [ ] Standalone task",
    ]);
  });

  it("removes group heading when all items are rolled over", () => {
    const content = [
      "# Daily",
      "## Tasks",
      "",
      "Crash list",
      "- [ ] Fix bug A",
      "- [ ] Fix bug B",
      "",
      "## Notes",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.newContent).not.toContain("Crash list");
    // The next section should still be there
    expect(result.newContent).toContain("## Notes");
  });

  it("handles nested checkboxes — unchecked parent duplicated when some children are checked", () => {
    const content = [
      "## Tasks",
      "- [ ] Parent task",
      "  - [x] Done sub",
      "  - [ ] Pending sub",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    // Parent rolls over with only the unchecked child
    expect(result.rolloverLines).toEqual([
      "- [ ] Parent task",
      "  - [ ] Pending sub",
    ]);
    // Parent stays in source to keep the tree valid (checked child still has its parent)
    expect(result.newContent).toBe(
      ["## Tasks", "- [ ] Parent task", "  - [x] Done sub"].join("\n")
    );
  });

  it("handles nested checkboxes — unchecked parent with all checked children stays in source and rolls over alone", () => {
    const content = [
      "## Tasks",
      "- [ ] Parent task",
      "  - [x] Done sub A",
      "  - [x] Done sub B",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    // Parent rolls over alone (no unchecked children to bring along)
    expect(result.rolloverLines).toEqual(["- [ ] Parent task"]);
    // Parent and its checked children stay intact in source
    expect(result.newContent).toBe(
      ["## Tasks", "- [ ] Parent task", "  - [x] Done sub A", "  - [x] Done sub B"].join("\n")
    );
  });

  it("handles nested checkboxes — unchecked parent with all-unchecked children rolls over entire subtree", () => {
    const content = [
      "## Tasks",
      "- [ ] Parent task",
      "  - [ ] Sub A",
      "  - [ ] Sub B",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.rolloverLines).toEqual([
      "- [ ] Parent task",
      "  - [ ] Sub A",
      "  - [ ] Sub B",
    ]);
    expect(result.newContent).toBe("## Tasks");
  });

  it("handles nested checkboxes — checked parent with unchecked child", () => {
    const content = [
      "## Tasks",
      "- [x] Parent task",
      "  - [x] Done sub",
      "  - [ ] Pending sub",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    // Parent included as context, only unchecked child rolled over
    expect(result.rolloverLines).toEqual([
      "- [x] Parent task",
      "  - [ ] Pending sub",
    ]);
    expect(result.uncheckedCount).toBe(1);

    // In old file: parent stays with its checked child; unchecked child removed
    expect(result.newContent).toBe(
      ["## Tasks", "- [x] Parent task", "  - [x] Done sub"].join("\n")
    );
  });

  it("handles deeply nested mixed states", () => {
    const content = [
      "## Tasks",
      "- [x] Level 0",
      "  - [x] Level 1",
      "    - [ ] Level 2 unchecked",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    // Both ancestors come as context
    expect(result.rolloverLines).toEqual([
      "- [x] Level 0",
      "  - [x] Level 1",
      "    - [ ] Level 2 unchecked",
    ]);
    // In old file: the unchecked leaf is removed, parents stay
    expect(result.newContent).toBe(
      ["## Tasks", "- [x] Level 0", "  - [x] Level 1"].join("\n")
    );
  });

  it("preserves content before and after Tasks section", () => {
    const content = [
      "# 2026-03-20",
      "## Journal",
      "Had a good day.",
      "## Tasks",
      "- [ ] Do something",
      "## Notes",
      "Some notes here.",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.newContent).toContain("# 2026-03-20");
    expect(result.newContent).toContain("## Journal");
    expect(result.newContent).toContain("Had a good day.");
    expect(result.newContent).toContain("## Notes");
    expect(result.newContent).toContain("Some notes here.");
    expect(result.newContent).not.toContain("Do something");
  });

  it("rolls over [/] in-progress items AND keeps them in source (duplicated)", () => {
    const content = [
      "## Tasks",
      "- [ ] Not started",
      "- [/] In progress",
      "- [x] Done",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.rolloverLines).toEqual([
      "- [ ] Not started",
      "- [/] In progress",
    ]);
    expect(result.uncheckedCount).toBe(2);
    // [/] stays in source; only [ ] is removed
    expect(result.newContent).toBe(
      ["## Tasks", "- [/] In progress", "- [x] Done"].join("\n")
    );
  });

  it("duplicates [/] in-progress with its entire subtree", () => {
    const content = [
      "## Tasks",
      "- [/] In progress",
      "  - [x] Done sub",
      "  - [ ] Pending sub",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    // Whole subtree is duplicated into rollover
    expect(result.rolloverLines).toEqual([
      "- [/] In progress",
      "  - [x] Done sub",
      "  - [ ] Pending sub",
    ]);
    // Nothing removed from source
    expect(result.newContent).toBe(content);
  });

  it("counts [/] in-progress items in uncheckedCount", () => {
    const content = [
      "## Tasks",
      "- [/] In progress A",
      "- [/] In progress B",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.uncheckedCount).toBe(2);
    // Source unchanged — both items are duplicated, not removed
    expect(result.newContent).toBe(content);
  });

  it("does not roll over [-] cancelled items", () => {
    const content = [
      "## Tasks",
      "- [-] Cancelled",
      "- [x] Done",
    ].join("\n");

    expect(computeRollover(content, "Tasks")).toBeNull();
  });

  it("[-] cancelled suppresses its entire subtree — unchecked children don't roll over", () => {
    const content = [
      "## Tasks",
      "- [-] Cancelled parent",
      "  - [ ] Unchecked child",
      "  - [ ] Another unchecked",
    ].join("\n");

    expect(computeRollover(content, "Tasks")).toBeNull();
  });

  it("[-] cancelled is preserved in source alongside unchecked siblings", () => {
    const content = [
      "## Tasks",
      "- [ ] Normal task",
      "- [-] Cancelled task",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.rolloverLines).toEqual(["- [ ] Normal task"]);
    // Cancelled item stays in source; unchecked is removed
    expect(result.newContent).toBe(["## Tasks", "- [-] Cancelled task"].join("\n"));
  });

  it("[-] cancelled child under unchecked parent: parent rolls over alone, cancelled child stays", () => {
    const content = [
      "## Tasks",
      "- [ ] Parent",
      "  - [-] Cancelled child",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.rolloverLines).toEqual(["- [ ] Parent"]);
    // Parent stays in source (cancelled child pins it), cancelled child also stays
    expect(result.newContent).toBe(content);
  });

  it("handles ### Tasks (deeper heading level)", () => {
    const content = [
      "## Daily",
      "### Tasks",
      "- [ ] Item",
    ].join("\n");

    const result = computeRollover(content, "Tasks")!;
    expect(result.rolloverLines).toEqual(["- [ ] Item"]);
  });
});

// ── insertRollovers ─────────────────────────────────────────────────────

describe("insertRollovers", () => {
  it("inserts rollover sections after existing Tasks content", () => {
    const today = [
      "# 2026-03-25",
      "## Tasks",
      "",
      "My existing items",
      "- [ ] Today's task",
    ].join("\n");

    const result = insertRollovers(today, "Tasks", [
      { dateStr: "2026-03-24", lines: ["- [ ] Yesterday's task"] },
      { dateStr: "2026-03-23", lines: ["- [ ] Older task"] },
    ]);

    const lines = result.split("\n");
    expect(lines[0]).toBe("# 2026-03-25");
    expect(lines[1]).toBe("## Tasks");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("My existing items");
    expect(lines[4]).toBe("- [ ] Today's task");
    // Rollovers follow existing content
    expect(lines[5]).toBe("");
    expect(lines[6]).toBe("Rollovers from 2026-03-24");
    expect(lines[7]).toBe("- [ ] Yesterday's task");
    expect(lines[8]).toBe("");
    expect(lines[9]).toBe("Rollovers from 2026-03-23");
    expect(lines[10]).toBe("- [ ] Older task");
  });

  it("inserts rollover sections right after heading when Tasks section is empty", () => {
    const today = [
      "# 2026-03-25",
      "## Tasks",
    ].join("\n");

    const result = insertRollovers(today, "Tasks", [
      { dateStr: "2026-03-24", lines: ["- [ ] Yesterday's task"] },
    ]);

    const lines = result.split("\n");
    expect(lines[0]).toBe("# 2026-03-25");
    expect(lines[1]).toBe("## Tasks");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("Rollovers from 2026-03-24");
    expect(lines[4]).toBe("- [ ] Yesterday's task");
  });

  it("throws when heading is missing", () => {
    expect(() =>
      insertRollovers("# No tasks here", "Tasks", [
        { dateStr: "2026-03-24", lines: ["- [ ] Item"] },
      ])
    ).toThrow();
  });
});
