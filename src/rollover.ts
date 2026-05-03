/**
 * Pure rollover logic — no Obsidian dependencies, fully testable.
 */

// ── Data types ──────────────────────────────────────────────────────────

export type CheckState = "unchecked" | "checked" | "cancelled" | "in-progress";

export interface TaskNode {
  line: string;
  indent: number;
  isCheckbox: boolean;
  isChecked: boolean;
  checkState: CheckState | null; // null for non-checkbox items
  children: TaskNode[];
  lineIndex: number; // original line number in the file
}

export interface GroupInfo {
  /** Non-list text lines that precede the checkbox list (e.g. "Crash list") */
  headingLineIndices: number[];
  headingLines: string[];
  /** List items (checkboxes and plain list items) */
  items: {
    line: string;
    indent: number;
    isCheckbox: boolean;
    isChecked: boolean;
    checkState: CheckState | null;
    lineIndex: number;
  }[];
}

export interface RolloverComputation {
  /** Lines to insert into today's note (under the date heading) */
  rolloverLines: string[];
  /** Lines actually deleted from the source file */
  removedLines: string[];
  /** The modified content of the source file (unchecked items removed) */
  newContent: string;
  /** Number of unchecked checkbox items rolled over */
  uncheckedCount: number;
}

// ── Parsing helpers ─────────────────────────────────────────────────────

export function parseListItem(
  line: string
): { indent: number; isCheckbox: boolean; isChecked: boolean; checkState: CheckState | null } | null {
  const cbMatch = line.match(/^(\s*)-\s+\[(.)\]/);
  if (cbMatch) {
    const marker = cbMatch[2];
    const isChecked = marker === "x" || marker === "X";
    let checkState: CheckState;
    if (marker === "x" || marker === "X") checkState = "checked";
    else if (marker === "-") checkState = "cancelled";
    else if (marker === "/") checkState = "in-progress";
    else checkState = "unchecked";
    return { indent: cbMatch[1].length, isCheckbox: true, isChecked, checkState };
  }
  const listMatch = line.match(/^(\s*)-\s+/);
  if (listMatch) {
    return { indent: listMatch[1].length, isCheckbox: false, isChecked: false, checkState: null };
  }
  return null;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Tree building ───────────────────────────────────────────────────────

export function buildTree(
  items: GroupInfo["items"]
): TaskNode[] {
  const roots: TaskNode[] = [];
  const stack: TaskNode[] = [];

  for (const item of items) {
    const node: TaskNode = { ...item, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].indent >= node.indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

// ── Tree queries ────────────────────────────────────────────────────────

/** Does this node or any non-cancelled descendant need to roll over? */
export function hasUnchecked(node: TaskNode): boolean {
  if (node.isCheckbox) {
    if (node.checkState === "cancelled") return false; // suppresses entire subtree
    if (node.checkState === "unchecked" || node.checkState === "in-progress") return true;
  }
  return node.children.some(hasUnchecked);
}

/** Collect every line index in a subtree. */
function getAllIndices(node: TaskNode): number[] {
  return [node.lineIndex, ...node.children.flatMap(getAllIndices)];
}

/** Collect every line string in a subtree. */
function getAllLines(node: TaskNode): string[] {
  return [node.line, ...node.children.flatMap(getAllLines)];
}

/**
 * Returns true when this node and its entire subtree would be rolled away —
 * i.e. the node is an unchecked checkbox and every descendant is too.
 * Checked, cancelled, and in-progress nodes always survive in source.
 */
export function isCompletelyRemoved(node: TaskNode): boolean {
  if (!node.isCheckbox || node.checkState !== "unchecked") return false;
  return node.children.every(isCompletelyRemoved);
}

/**
 * Line indices that should be REMOVED from the source file.
 *
 * - Unchecked checkbox with no surviving children → remove it and entire subtree.
 * - Unchecked checkbox with some checked/cancelled/in-progress children → keep parent
 *   in source (to preserve valid tree structure); only remove fully-unchecked subtrees.
 * - Checked parent with rollover descendants → keep the parent, recurse into children.
 * - Cancelled or in-progress nodes → never removed (stay in source).
 */
export function getRemovalIndices(node: TaskNode): number[] {
  if (node.checkState === "cancelled" || node.checkState === "in-progress") return [];
  if (node.isCheckbox && node.checkState === "unchecked") {
    if (isCompletelyRemoved(node)) {
      return getAllIndices(node);
    }
    // Parent stays in source for tree validity; remove only fully-gone subtrees
    return node.children.flatMap((child) =>
      isCompletelyRemoved(child) ? getAllIndices(child) : getRemovalIndices(child)
    );
  }
  if (node.children.some(hasUnchecked)) {
    return node.children.flatMap((child) =>
      hasUnchecked(child) ? getRemovalIndices(child) : []
    );
  }
  return [];
}

/**
 * Lines to INSERT into today's note.
 *
 * - Cancelled checkbox → nothing (suppresses entire subtree).
 * - In-progress checkbox → duplicate entire subtree as-is.
 * - Unchecked checkbox → include it and recurse into children.
 * - Checked parent with rollover descendants → include parent as context,
 *   recurse into children.
 */
export function getRolloverLines(node: TaskNode): string[] {
  if (node.checkState === "cancelled") return [];
  if (node.checkState === "in-progress") return getAllLines(node);
  if (node.isCheckbox && node.checkState === "unchecked") {
    return [node.line, ...node.children.flatMap(getRolloverLines)];
  }
  if (node.children.some(hasUnchecked)) {
    return [
      node.line,
      ...node.children.flatMap((child) =>
        hasUnchecked(child) ? getRolloverLines(child) : []
      ),
    ];
  }
  return [];
}

// ── Section parsing ─────────────────────────────────────────────────────

export function parseTasksSection(
  lines: string[],
  tasksHeading: string
): {
  sectionStart: number;
  sectionEnd: number;
  groups: GroupInfo[];
} | null {
  const headingPattern = new RegExp(
    `^(#{1,6})\\s+${escapeRegex(tasksHeading)}\\s*$`
  );
  let sectionStart = -1;
  let headingLevel = 2;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingPattern);
    if (m) {
      sectionStart = i;
      headingLevel = m[1].length;
      break;
    }
  }
  if (sectionStart === -1) return null;

  // Section ends at next same-or-higher-level heading, or EOF
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= headingLevel) {
      sectionEnd = i;
      break;
    }
  }

  // Parse lines into groups (separated by blank lines)
  const groups: GroupInfo[] = [];
  let curHeadingIndices: number[] = [];
  let curHeadingLines: string[] = [];
  let curItems: GroupInfo["items"] = [];

  const flush = () => {
    if (curItems.length > 0) {
      groups.push({
        headingLineIndices: curHeadingIndices,
        headingLines: curHeadingLines,
        items: curItems,
      });
    }
    curHeadingIndices = [];
    curHeadingLines = [];
    curItems = [];
  };

  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const line = lines[i];

    if (line.trim() === "") {
      if (curItems.length > 0) {
        flush();
      }
      continue;
    }

    const parsed = parseListItem(line);
    if (parsed) {
      curItems.push({ line, ...parsed, lineIndex: i });
    } else {
      // Non-list text line — starts or continues a group heading
      if (curItems.length > 0) {
        flush();
      }
      curHeadingIndices.push(i);
      curHeadingLines.push(line);
    }
  }
  flush();

  return { sectionStart, sectionEnd, groups };
}

// ── Main computation ────────────────────────────────────────────────────

/**
 * Given the full text content of a daily note, compute:
 * - The lines to roll over into today's note
 * - The new content of this file (with rolled-over items removed)
 *
 * Returns null if there is nothing to roll over.
 */
export function computeRollover(
  content: string,
  tasksHeading: string
): RolloverComputation | null {
  const lines = content.split("\n");
  const parsed = parseTasksSection(lines, tasksHeading);
  if (!parsed) return null;

  const removeSet = new Set<number>();
  const allRolloverLines: string[] = [];
  let uncheckedCount = 0;

  for (const group of parsed.groups) {
    const tree = buildTree(group.items);

    const groupRolloverLines: string[] = [];
    const groupRemovalIndices: number[] = [];

    for (const node of tree) {
      groupRolloverLines.push(...getRolloverLines(node));
      groupRemovalIndices.push(...getRemovalIndices(node));
    }

    if (groupRolloverLines.length > 0) {
      // Add spacing: blank line before heading lines, or between groups
      if (group.headingLines.length > 0) {
        allRolloverLines.push("");
      } else if (allRolloverLines.length > 0) {
        allRolloverLines.push("");
      }
      // Include group heading for context
      allRolloverLines.push(...group.headingLines);
      allRolloverLines.push(...groupRolloverLines);

      for (const idx of groupRemovalIndices) {
        removeSet.add(idx);
      }

      // If every item in the group is removed, also remove its heading lines
      const allItemIndices = group.items.map((item) => item.lineIndex);
      if (allItemIndices.every((idx) => removeSet.has(idx))) {
        for (const idx of group.headingLineIndices) {
          removeSet.add(idx);
        }
      }

      uncheckedCount += groupRolloverLines.filter((l) =>
        /^\s*-\s+\[(?![xX]).\]/.test(l)
      ).length;
    }
  }

  if (allRolloverLines.length === 0) return null;

  // Rebuild content, omitting removed lines
  const newLines = lines.filter((_, i) => !removeSet.has(i));

  // Collapse runs of 3+ consecutive blank lines to 2
  const cleaned: string[] = [];
  let blanks = 0;
  for (const line of newLines) {
    if (line.trim() === "") {
      blanks++;
      if (blanks <= 2) cleaned.push(line);
    } else {
      blanks = 0;
      cleaned.push(line);
    }
  }

  const removedLines = lines.filter((_, i) => removeSet.has(i));

  return {
    rolloverLines: allRolloverLines,
    removedLines,
    newContent: cleaned.join("\n"),
    uncheckedCount,
  };
}

/**
 * Insert rollover sections into today's note content.
 * Returns the new content, or throws if the tasks heading is not found.
 */
export function insertRollovers(
  todayContent: string,
  tasksHeading: string,
  rollovers: { dateStr: string; lines: string[] }[]
): string {
  const lines = todayContent.split("\n");
  const headingPattern = new RegExp(
    `^#{1,6}\\s+${escapeRegex(tasksHeading)}\\s*$`
  );

  let sectionStart = -1;
  let headingLevel = 2;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingPattern);
    if (m) {
      sectionStart = i;
      const levelMatch = lines[i].match(/^(#{1,6})\s/);
      headingLevel = levelMatch ? levelMatch[1].length : 2;
      break;
    }
  }

  if (sectionStart === -1) {
    throw new Error(
      `"## ${tasksHeading}" heading not found in today's daily note.`
    );
  }

  // Find the end of the section (next same-or-higher-level heading, or EOF)
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= headingLevel) {
      sectionEnd = i;
      break;
    }
  }

  // Insert after existing content in the section, before the next heading
  // Skip trailing blank lines to place rollovers at the true end of content
  let insertIdx = sectionEnd;
  while (insertIdx > sectionStart + 1 && lines[insertIdx - 1].trim() === "") {
    insertIdx--;
  }

  const rolloverText: string[] = [];
  for (const r of rollovers) {
    rolloverText.push("");
    rolloverText.push(`Rollovers from ${r.dateStr}`);
    rolloverText.push(...r.lines);
  }

  return [
    ...lines.slice(0, insertIdx),
    ...rolloverText,
    ...lines.slice(insertIdx),
  ].join("\n");
}
