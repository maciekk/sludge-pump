import {
  Plugin,
  TFile,
  Notice,
  PluginSettingTab,
  App,
  Setting,
  Modal,
} from "obsidian";
import { computeRollover, insertRollovers } from "./rollover";

// ── Settings ────────────────────────────────────────────────────────────

interface TaskRolloverSettings {
  dailyNotesFolder: string;
  dateFormat: string;
  lookbackDays: number;
  tasksHeading: string;
  backupFolder: string;
}

const DEFAULT_SETTINGS: TaskRolloverSettings = {
  dailyNotesFolder: "_journal/day/YYYY",
  dateFormat: "YYYY-MM-DD",
  lookbackDays: 7,
  tasksHeading: "Tasks",
  backupFolder: ".rollover-backups",
};

// ── Plugin ──────────────────────────────────────────────────────────────

export default class TaskRolloverPlugin extends Plugin {
  settings!: TaskRolloverSettings;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "rollover-tasks",
      name: "Rollover unchecked tasks from recent daily notes",
      callback: () => this.rolloverTasks(),
    });

    this.addCommand({
      id: "undo-rollover",
      name: "Undo last task rollover",
      callback: () => this.undoLastRollover(),
    });

    this.addSettingTab(new TaskRolloverSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── Rollover command ────────────────────────────────────────────────

  /**
   * Resolve the vault-relative path for a daily note on a given date.
   * The folder setting may contain date tokens (YYYY, MM, DD) that get
   * replaced with values from the date — e.g. `_journal/day/YYYY` becomes
   * `_journal/day/2026` for any date in 2026.
   */
  private dailyNotePath(date: any): string {
    const dateStr = date.format(this.settings.dateFormat);
    const raw = this.settings.dailyNotesFolder.replace(/^\/|\/$/g, "");
    const folder = raw
      .replace(/YYYY/g, date.format("YYYY"))
      .replace(/YY/g, date.format("YY"))
      .replace(/MM/g, date.format("MM"))
      .replace(/DD/g, date.format("DD"));
    return folder ? `${folder}/${dateStr}.md` : `${dateStr}.md`;
  }

  private async rolloverTasks() {
    try {
      const moment = (window as any).moment;
      const today = moment();
      const todayStr = today.format(this.settings.dateFormat);

      const todayPath = this.dailyNotePath(today);

      const todayFile = this.app.vault.getAbstractFileByPath(todayPath);
      if (!(todayFile instanceof TFile)) {
        new Notice(`Today's daily note not found: ${todayPath}`);
        return;
      }

      // Scan past N days for unchecked tasks
      const rollovers: {
        dateStr: string;
        lines: string[];
        file: TFile;
        newContent: string;
        uncheckedCount: number;
      }[] = [];

      for (let i = 1; i <= this.settings.lookbackDays; i++) {
        const date = moment().subtract(i, "days");
        const dateStr = date.format(this.settings.dateFormat);
        const path = this.dailyNotePath(date);

        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;

        const content = await this.app.vault.read(file);
        const result = computeRollover(content, this.settings.tasksHeading);
        if (result) {
          rollovers.push({
            dateStr,
            lines: result.rolloverLines,
            file,
            newContent: result.newContent,
            uncheckedCount: result.uncheckedCount,
          });
        }
      }

      if (rollovers.length === 0) {
        new Notice("No unchecked tasks to roll over.");
        return;
      }

      // ── Show confirmation diff ────────────────────────────────────

      const confirmed = await new RolloverConfirmModal(
        this.app,
        todayPath,
        rollovers.map((r) => ({
          dateStr: r.dateStr,
          filePath: r.file.path,
          removedLines: r.lines,
          addedLines: r.lines,
        }))
      ).open();

      if (!confirmed) {
        new Notice("Rollover cancelled.");
        return;
      }

      // ── Backup phase (all reads, no writes yet) ────────────────────

      const timestamp = today.format("YYYY-MM-DD_HH-mm-ss");
      const backupDir = `${this.settings.backupFolder}/${timestamp}`;

      // Read all files that will be modified
      const todayContent = await this.app.vault.read(todayFile);
      const backups: { originalPath: string; content: string }[] = [
        { originalPath: todayFile.path, content: todayContent },
      ];
      for (const r of rollovers) {
        // We already read this above; re-read for the backup to capture
        // the exact state at backup time.
        const content = await this.app.vault.read(r.file);
        backups.push({ originalPath: r.file.path, content });
      }

      // Write backups
      for (const b of backups) {
        const backupPath = `${backupDir}/${b.originalPath}`;
        await this.ensureFolderExists(
          backupPath.substring(0, backupPath.lastIndexOf("/"))
        );
        await this.app.vault.create(backupPath, b.content);
      }

      // ── Write phase ────────────────────────────────────────────────

      // Update today's note
      const newTodayContent = insertRollovers(
        todayContent,
        this.settings.tasksHeading,
        rollovers.map((r) => ({ dateStr: r.dateStr, lines: r.lines }))
      );
      await this.app.vault.modify(todayFile, newTodayContent);

      // Update old notes (remove rolled-over items)
      for (const r of rollovers) {
        await this.app.vault.modify(r.file, r.newContent);
      }

      // Save undo metadata
      const data = (await this.loadData()) || {};
      data.lastBackupFolder = backupDir;
      data.lastRolloverTime = Date.now();
      await this.saveData({ ...this.settings, ...data });

      const total = rollovers.reduce((s, r) => s + r.uncheckedCount, 0);
      new Notice(
        `Rolled over ${total} task(s) from ${rollovers.length} day(s). Backups saved.`
      );
    } catch (e: any) {
      console.error("Task rollover failed:", e);
      new Notice(`Rollover failed: ${e.message}`);
    }
  }

  // ── Undo command ──────────────────────────────────────────────────

  private async undoLastRollover() {
    try {
      const data = (await this.loadData()) || {};
      const backupDir: string | undefined = data.lastBackupFolder;

      if (!backupDir) {
        new Notice("No rollover to undo.");
        return;
      }

      const backupFolder = this.app.vault.getAbstractFileByPath(backupDir);
      if (!backupFolder) {
        new Notice("Backup folder not found. Cannot undo.");
        return;
      }

      // Find all backup files
      const backupFiles = this.app.vault
        .getFiles()
        .filter((f) => f.path.startsWith(backupDir + "/"));

      if (backupFiles.length === 0) {
        new Notice("No backup files found. Cannot undo.");
        return;
      }

      // Restore each file
      let restored = 0;
      for (const bf of backupFiles) {
        const originalPath = bf.path.substring(backupDir.length + 1);
        const content = await this.app.vault.read(bf);

        const originalFile =
          this.app.vault.getAbstractFileByPath(originalPath);
        if (originalFile instanceof TFile) {
          await this.app.vault.modify(originalFile, content);
        } else {
          await this.app.vault.create(originalPath, content);
        }
        restored++;
      }

      // Clean up backup files and folders
      for (const bf of backupFiles) {
        await this.app.vault.delete(bf);
      }
      await this.deleteEmptyFolders(backupDir);

      // Clear undo metadata
      delete data.lastBackupFolder;
      delete data.lastRolloverTime;
      await this.saveData(data);

      new Notice(`Restored ${restored} file(s). Rollover undone.`);
    } catch (e: any) {
      console.error("Undo rollover failed:", e);
      new Notice(`Undo failed: ${e.message}`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async ensureFolderExists(path: string): Promise<void> {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!this.app.vault.getAbstractFileByPath(dirPath)) {
        await this.app.vault.createFolder(dirPath);
      }
    }
  }

  private async deleteEmptyFolders(path: string): Promise<void> {
    // Walk up from the deepest backup subdirectories and delete empty ones
    const allFolders = this.app.vault
      .getAllLoadedFiles()
      .filter((f) => f.path.startsWith(path) && !(f instanceof TFile))
      .sort((a, b) => b.path.length - a.path.length); // deepest first

    for (const folder of allFolders) {
      const children = this.app.vault
        .getAllLoadedFiles()
        .filter(
          (f) => f.path.startsWith(folder.path + "/") && f.path !== folder.path
        );
      if (children.length === 0) {
        await this.app.vault.delete(folder);
      }
    }
  }
}

// ── Confirmation Modal ────────────────────────────────────────────────

interface RolloverDiffEntry {
  dateStr: string;
  filePath: string;
  removedLines: string[];
  addedLines: string[];
}

class RolloverConfirmModal extends Modal {
  private todayPath: string;
  private entries: RolloverDiffEntry[];
  private resolve!: (confirmed: boolean) => void;

  constructor(app: App, todayPath: string, entries: RolloverDiffEntry[]) {
    super(app);
    this.todayPath = todayPath;
    this.entries = entries;
  }

  /** Override open() to return a promise that resolves on confirm/cancel. */
  open(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("task-rollover-confirm");

    contentEl.createEl("h2", { text: "Task Rollover Preview" });
    contentEl.createEl("p", {
      text: "Review the changes below. Backups will be created before any files are modified.",
      cls: "task-rollover-subtitle",
    });

    // ── Per-file diffs ──────────────────────────────────────────────

    for (const entry of this.entries) {
      const section = contentEl.createDiv({ cls: "task-rollover-file" });

      section.createEl("h3", {
        text: `Remove from ${entry.filePath}`,
        cls: "task-rollover-file-heading",
      });

      const removeBlock = section.createEl("pre", {
        cls: "task-rollover-diff task-rollover-removed",
      });
      for (const line of entry.removedLines) {
        const lineEl = removeBlock.createEl("div", {
          cls: "task-rollover-diff-line",
        });
        lineEl.createSpan({ text: "- ", cls: "task-rollover-diff-marker" });
        lineEl.createSpan({ text: line });
      }
    }

    // ── What gets added to today ────────────────────────────────────

    const addSection = contentEl.createDiv({ cls: "task-rollover-file" });
    addSection.createEl("h3", {
      text: `Add to ${this.todayPath}`,
      cls: "task-rollover-file-heading",
    });

    const addBlock = addSection.createEl("pre", {
      cls: "task-rollover-diff task-rollover-added",
    });
    for (const entry of this.entries) {
      const headerEl = addBlock.createEl("div", {
        cls: "task-rollover-diff-line",
      });
      headerEl.createSpan({ text: "+ ", cls: "task-rollover-diff-marker" });
      headerEl.createSpan({ text: `Rollovers from ${entry.dateStr}` });

      for (const line of entry.addedLines) {
        const lineEl = addBlock.createEl("div", {
          cls: "task-rollover-diff-line",
        });
        lineEl.createSpan({ text: "+ ", cls: "task-rollover-diff-marker" });
        lineEl.createSpan({ text: line });
      }
    }

    // ── Buttons ─────────────────────────────────────────────────────

    const buttonRow = contentEl.createDiv({ cls: "task-rollover-buttons" });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      const r = this.resolve;
      this.resolve = null as any;
      r(false);
      this.close();
    });

    const confirmBtn = buttonRow.createEl("button", {
      text: "Confirm Rollover",
      cls: "mod-cta",
    });
    confirmBtn.addEventListener("click", () => {
      const r = this.resolve;
      this.resolve = null as any;
      r(true);
      this.close();
    });
  }

  onClose() {
    // If closed via Escape or clicking outside, treat as cancel.
    // Guard: resolve only once (confirm/cancel buttons also call resolve).
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null as any;
      r(false);
    }
    this.contentEl.empty();
  }
}

// ── Settings Tab ──────────────────────────────────────────────────────

class TaskRolloverSettingTab extends PluginSettingTab {
  plugin: TaskRolloverPlugin;

  constructor(app: App, plugin: TaskRolloverPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Task Rollover Settings" });

    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc(
        "Vault-relative path. May contain date tokens: YYYY, MM, DD " +
        "(e.g. _journal/day/YYYY)"
      )
      .addText((text) =>
        text
          .setPlaceholder("_journal/day/YYYY")
          .setValue(this.plugin.settings.dailyNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Date format")
      .setDesc(
        "Moment.js date format used for daily note filenames (e.g. YYYY-MM-DD)"
      )
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.dateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dateFormat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Lookback days")
      .setDesc("How many past days to scan for unchecked tasks")
      .addText((text) =>
        text
          .setPlaceholder("7")
          .setValue(String(this.plugin.settings.lookbackDays))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.lookbackDays = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Tasks heading")
      .setDesc('The section heading under which tasks live (without "##")')
      .addText((text) =>
        text
          .setPlaceholder("Tasks")
          .setValue(this.plugin.settings.tasksHeading)
          .onChange(async (value) => {
            this.plugin.settings.tasksHeading = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Backup folder")
      .setDesc(
        "Where rollover backups are stored (vault-relative). Used for undo."
      )
      .addText((text) =>
        text
          .setPlaceholder(".rollover-backups")
          .setValue(this.plugin.settings.backupFolder)
          .onChange(async (value) => {
            this.plugin.settings.backupFolder = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
