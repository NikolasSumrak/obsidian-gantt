import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import type GanttPlugin from './main';
import {
	VIEW_TYPE, DAY_WIDTH_DEFAULT, DAY_WIDTH_MIN, DAY_WIDTH_MAX, ZOOM_STEP,
	ROW_HEIGHT, BAR_HEIGHT, BAR_VERTICAL_OFFSET, DATE_PADDING_DAYS,
	TASK_COLORS, MONTH_NAMES,
} from './constants';
import { GanttTask, FileTask } from './types';
import {
	parseDate, formatDate, addDays, addMonths, daysBetween, stripTime,
	isWeekend, isToday, extractTaskTitle, parseTaskLine, updateFileTaskDates,
	clearFileTaskDates, isMarkerTruthy, isPathExcluded,
} from './utils';
import { ProjectEditModal, FileTaskEditModal } from './modals';

// A display row is a project, sub-task, or an "add task" placeholder
interface DisplayRow {
	type: 'project' | 'task' | 'add-task';
	project?: GanttTask;
	fileTask?: FileTask;
	projectFile?: TFile; // for add-task and aggregate-project rows
	aggregate?: boolean; // project whose dates are derived from its tasks (no own frontmatter dates)
	segments?: DateInterval[]; // for aggregate projects: task intervals to draw (with gaps)
	startDate: Date | null;
	endDate: Date | null;
	title: string;
	colorIndex: number;
	hasDates: boolean;
	completed: boolean;
}

interface DateInterval {
	start: Date;
	end: Date;
}

// A marked project (file with the marker property) plus its rolled-up date range.
// `segments` are the merged task intervals — the project bar is drawn only over
// these, leaving gaps where the project has no tasks.
interface MarkedProject {
	file: TFile;
	tasks: FileTask[];
	start: Date | null;
	end: Date | null;
	segments: DateInterval[];
}

export class GanttChartView extends ItemView {
	private plugin: GanttPlugin;
	private tasks: GanttTask[] = [];
	// Expanded projects and their loaded tasks
	private expanded = new Set<string>(); // file.path
	private fileTasksMap = new Map<string, FileTask[]>(); // file.path -> tasks
	private displayRows: DisplayRow[] = [];
	private timelineStart: Date = new Date();
	private totalDays = 0;
	private dayWidth = DAY_WIDTH_DEFAULT;
	private activeTab: 'projects' | 'tasks' | 'byproject' = 'byproject';
	private allFileTasks: FileTask[] = [];
	private markedProjects: MarkedProject[] = [];
	private hideCompleted = false;
	// When true, the next render scrolls the timeline so today is centered.
	private centerOnToday = true;

	// Selection state for Delete key
	private selectedRow: DisplayRow | null = null;
	private selectedBarEl: HTMLElement | null = null;
	private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: GanttPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return 'Gantt Chart'; }
	getIcon(): string { return 'bar-chart-horizontal'; }

	async onOpen(): Promise<void> {
		this.hideCompleted = this.plugin.settings.hideCompletedTasks;
		this.centerOnToday = true;
		this.boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
		document.addEventListener('keydown', this.boundKeyDown);
		await this.refresh();
	}

	async onClose(): Promise<void> {
		if (this.boundKeyDown) {
			document.removeEventListener('keydown', this.boundKeyDown);
			this.boundKeyDown = null;
		}
	}

	private selectBar(row: DisplayRow, barEl: HTMLElement): void {
		if (this.selectedBarEl) this.selectedBarEl.removeClass('gantt-bar-selected');
		this.selectedRow = row;
		this.selectedBarEl = barEl;
		barEl.addClass('gantt-bar-selected');
	}

	private clearSelection(): void {
		if (this.selectedBarEl) this.selectedBarEl.removeClass('gantt-bar-selected');
		this.selectedRow = null;
		this.selectedBarEl = null;
	}

	private async onKeyDown(e: KeyboardEvent): Promise<void> {
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		if (!this.selectedRow) return;
		// Don't interfere with inputs
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

		e.preventDefault();
		await this.deleteDatesForRow(this.selectedRow);
		this.clearSelection();
	}

	private async deleteDatesForRow(row: DisplayRow): Promise<void> {
		if (row.type === 'project' && row.project) {
			const startProp = this.plugin.settings.startDateProperty;
			const endProp = this.plugin.settings.endDateProperty;
			await this.app.fileManager.processFrontMatter(row.project.file, (fm) => {
				delete fm[startProp];
				delete fm[endProp];
			});
		} else if (row.type === 'task' && row.fileTask) {
			await clearFileTaskDates(this.app, row.fileTask);
		}
	}

	private showContextMenu(e: MouseEvent, row: DisplayRow): void {
		e.preventDefault();
		e.stopPropagation();

		// Remove any existing context menu
		document.querySelector('.gantt-context-menu')?.remove();

		const menu = document.createElement('div');
		menu.className = 'gantt-context-menu';
		menu.style.position = 'fixed';
		menu.style.left = `${e.clientX}px`;
		menu.style.top = `${e.clientY}px`;
		menu.style.zIndex = '1000';

		const deleteItem = document.createElement('div');
		deleteItem.className = 'gantt-context-menu-item gantt-context-menu-item-danger';
		deleteItem.textContent = 'Delete dates';
		deleteItem.addEventListener('click', async () => {
			menu.remove();
			await this.deleteDatesForRow(row);
		});
		menu.appendChild(deleteItem);

		document.body.appendChild(menu);

		const closeMenu = (ev: MouseEvent) => {
			if (!menu.contains(ev.target as Node)) {
				menu.remove();
				document.removeEventListener('mousedown', closeMenu);
			}
		};
		setTimeout(() => document.addEventListener('mousedown', closeMenu), 0);
	}

	async refresh(): Promise<void> {
		this.collectTasks();
		// Reload file tasks for all expanded projects
		for (const path of this.expanded) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				await this.loadFileTasks(file);
			} else {
				this.expanded.delete(path);
				this.fileTasksMap.delete(path);
			}
		}
		await this.rebuildRows();
	}

	// Rebuild display rows for the active tab, recompute the time range and render.
	private async rebuildRows(): Promise<void> {
		if (this.activeTab === 'tasks') {
			await this.collectAllFileTasks();
			this.buildTasksOnlyRows();
		} else if (this.activeTab === 'byproject') {
			await this.collectMarkedProjects();
			this.buildByProjectRows();
		} else {
			await this.buildDisplayRows();
		}
		this.computeTimeRange();
		this.render();
	}

	private async toggleProject(file: TFile): Promise<void> {
		const path = file.path;
		if (this.expanded.has(path)) {
			this.expanded.delete(path);
			this.fileTasksMap.delete(path);
		} else {
			this.expanded.add(path);
			await this.loadFileTasks(file);
		}
		await this.rebuildRows();
	}

	private async addTaskToFile(file: TFile, taskName: string): Promise<void> {
		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		const taskLine = `- [ ] ${taskName}`;

		// Find the last task line (- [ ] or - [x])
		let lastTaskIdx = -1;
		for (let i = lines.length - 1; i >= 0; i--) {
			if (/^\s*-\s*\[.\]/.test(lines[i]!)) {
				lastTaskIdx = i;
				break;
			}
		}

		if (lastTaskIdx >= 0) {
			// Insert after the last task line
			lines.splice(lastTaskIdx + 1, 0, taskLine);
		} else {
			// No tasks found — append a section at the end
			const toAppend = content.endsWith('\n') ? '' : '\n';
			lines.push(toAppend + '## To Do', taskLine);
		}

		await this.app.vault.modify(file, lines.join('\n'));
		// Reload tasks for this project
		await this.loadFileTasks(file);
		await this.rebuildRows();
	}

	// ── Data ─────────────────────────────────────────────────────────

	private collectTasks(): void {
		const files = this.app.vault.getMarkdownFiles();
		const startProp = this.plugin.settings.startDateProperty;
		const endProp = this.plugin.settings.endDateProperty;
		const excluded = this.plugin.settings.excludedFolders;
		const tasks: GanttTask[] = [];
		let ci = 0;

		for (const file of files) {
			if (isPathExcluded(file.path, excluded)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			let s = parseDate(fm[startProp]), e = parseDate(fm[endProp]);
			if (!s && !e) continue;
			if (!s && e) s = e;
			if (s && !e) e = s;
			if (!s || !e) continue;
			if (s.getTime() > e.getTime()) { const t = s; s = e; e = t; }
			tasks.push({ file, title: file.basename, startDate: s, endDate: e, colorIndex: ci % TASK_COLORS.length });
			ci++;
		}

		tasks.sort((a, b) => {
			const d = a.startDate.getTime() - b.startDate.getTime();
			return d !== 0 ? d : a.title.localeCompare(b.title);
		});
		this.tasks = tasks;
	}

	private async loadFileTasks(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		const dated: FileTask[] = [];
		const undated: FileTask[] = [];
		let ci = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (!/^\s*-\s*\[.\]/.test(line)) continue;
			const completed = /^\s*-\s*\[x\]/i.test(line);
			const { start, due } = parseTaskLine(line);
			let s = start, e = due;

			if (!s && !e) {
				undated.push({ file, lineNumber: i, text: extractTaskTitle(line), startDate: null, endDate: null, colorIndex: ci % TASK_COLORS.length, completed });
				ci++;
				continue;
			}

			if (!s && e) s = e;
			if (s && !e) e = s;
			if (!s || !e) continue;
			if (s.getTime() > e.getTime()) { const t = s; s = e; e = t; }
			dated.push({ file, lineNumber: i, text: extractTaskTitle(line), startDate: s, endDate: e, colorIndex: ci % TASK_COLORS.length, completed });
			ci++;
		}

		dated.sort((a, b) => {
			const d = a.startDate!.getTime() - b.startDate!.getTime();
			return d !== 0 ? d : a.text.localeCompare(b.text);
		});
		this.fileTasksMap.set(file.path, [...dated, ...undated]);
	}

	private async buildDisplayRows(): Promise<void> {
		const rows: DisplayRow[] = [];
		for (const task of this.tasks) {
			rows.push({
				type: 'project', project: task,
				startDate: task.startDate, endDate: task.endDate,
				title: task.title, colorIndex: task.colorIndex,
				hasDates: true, completed: false,
			});
			if (this.expanded.has(task.file.path)) {
				const fts = this.fileTasksMap.get(task.file.path) ?? [];
				for (const ft of fts) {
					if (this.hideCompleted && ft.completed) continue;
					const hasDates = ft.startDate !== null && ft.endDate !== null;
					rows.push({
						type: 'task', fileTask: ft,
						startDate: ft.startDate, endDate: ft.endDate,
						title: ft.text, colorIndex: ft.colorIndex,
						hasDates, completed: ft.completed,
					});
				}
				rows.push({
					type: 'add-task', projectFile: task.file,
					startDate: null, endDate: null,
					title: '', colorIndex: 0, hasDates: false, completed: false,
				});
			}
		}
		this.displayRows = rows;
	}

	private async collectAllFileTasks(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const excluded = this.plugin.settings.excludedFolders;
		const all: FileTask[] = [];
		let ci = 0;

		for (const file of files) {
			if (isPathExcluded(file.path, excluded)) continue;
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split('\n');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]!;
				if (!/^\s*-\s*\[.\]/.test(line)) continue;
				const completed = /^\s*-\s*\[x\]/i.test(line);
				const { start, due } = parseTaskLine(line);
				let s = start, e = due;
				if (!s && !e) {
					all.push({ file, lineNumber: i, text: extractTaskTitle(line), startDate: null, endDate: null, colorIndex: ci % TASK_COLORS.length, completed });
					ci++; continue;
				}
				if (!s && e) s = e;
				if (s && !e) e = s;
				if (!s || !e) continue;
				if (s.getTime() > e.getTime()) { const t = s; s = e; e = t; }
				all.push({ file, lineNumber: i, text: extractTaskTitle(line), startDate: s, endDate: e, colorIndex: ci % TASK_COLORS.length, completed });
				ci++;
			}
		}

		const dated = all.filter(t => t.startDate && t.endDate);
		const undated = all.filter(t => !t.startDate || !t.endDate);
		dated.sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime() || a.text.localeCompare(b.text));
		this.allFileTasks = [...dated, ...undated];
	}

	private buildTasksOnlyRows(): void {
		const rows: DisplayRow[] = [];
		for (const ft of this.allFileTasks) {
			if (this.hideCompleted && ft.completed) continue;
			const hasDates = ft.startDate !== null && ft.endDate !== null;
			rows.push({
				type: 'task', fileTask: ft,
				startDate: ft.startDate, endDate: ft.endDate,
				title: ft.text, colorIndex: ft.colorIndex,
				hasDates, completed: ft.completed,
			});
		}
		this.displayRows = rows;
	}

	// ── "By Project" mode ────────────────────────────────────────────
	// Files carrying the marker property become projects. A project has no
	// dates of its own — its bar spans the earliest start to the latest end
	// of the dated tasks it contains.
	private async collectMarkedProjects(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const markerProp = this.plugin.settings.projectMarkerProperty;
		const excluded = this.plugin.settings.excludedFolders;
		const result: MarkedProject[] = [];

		for (const file of files) {
			if (isPathExcluded(file.path, excluded)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm || !isMarkerTruthy(fm[markerProp])) continue;

			await this.loadFileTasks(file);
			const tasks = this.fileTasksMap.get(file.path) ?? [];

			const segments = this.mergeTaskIntervals(tasks);
			const start = segments.length ? segments[0]!.start : null;
			const end = segments.length ? segments[segments.length - 1]!.end : null;
			result.push({ file, tasks, start, end, segments });
		}

		result.sort((a, b) => {
			const at = a.start ? a.start.getTime() : Infinity;
			const bt = b.start ? b.start.getTime() : Infinity;
			return at !== bt ? at - bt : a.file.basename.localeCompare(b.file.basename);
		});
		this.markedProjects = result;
	}

	// Merge the dated tasks of a project into contiguous intervals. Overlapping or
	// day-adjacent tasks are joined; anything with an empty day between stays separate,
	// so the project bar shows gaps where there are no tasks.
	private mergeTaskIntervals(tasks: FileTask[]): DateInterval[] {
		const intervals: DateInterval[] = tasks
			.filter((t) => t.startDate && t.endDate)
			.map((t) => ({ start: t.startDate!, end: t.endDate! }))
			.sort((a, b) => a.start.getTime() - b.start.getTime());

		const merged: DateInterval[] = [];
		for (const iv of intervals) {
			const last = merged[merged.length - 1];
			// Join when the next interval starts on or before the day after `last` ends.
			if (last && iv.start.getTime() <= addDays(last.end, 1).getTime()) {
				if (iv.end.getTime() > last.end.getTime()) last.end = iv.end;
			} else {
				merged.push({ start: iv.start, end: iv.end });
			}
		}
		return merged;
	}

	private buildByProjectRows(): void {
		const rows: DisplayRow[] = [];
		let ci = 0;
		for (const proj of this.markedProjects) {
			const hasDates = proj.start !== null && proj.end !== null;
			rows.push({
				type: 'project', projectFile: proj.file, aggregate: true,
				segments: proj.segments,
				startDate: proj.start, endDate: proj.end,
				title: proj.file.basename, colorIndex: ci % TASK_COLORS.length,
				hasDates, completed: false,
			});
			ci++;

			if (this.expanded.has(proj.file.path)) {
				for (const ft of proj.tasks) {
					if (this.hideCompleted && ft.completed) continue;
					const tHasDates = ft.startDate !== null && ft.endDate !== null;
					rows.push({
						type: 'task', fileTask: ft,
						startDate: ft.startDate, endDate: ft.endDate,
						title: ft.text, colorIndex: ft.colorIndex,
						hasDates: tHasDates, completed: ft.completed,
					});
				}
				rows.push({
					type: 'add-task', projectFile: proj.file,
					startDate: null, endDate: null,
					title: '', colorIndex: 0, hasDates: false, completed: false,
				});
			}
		}
		this.displayRows = rows;
	}

	private computeTimeRange(): void {
		const today = stripTime(new Date());
		// The timeline always spans at least the configured windows: a short
		// history behind today and a longer runway ahead, so you can scroll
		// forward. Real data outside these windows still extends the range.
		const historyStart = addMonths(today, -this.plugin.settings.historyMonths);
		const futureEnd = addMonths(today, this.plugin.settings.futureMonths);
		let earliest = historyStart;
		let latest = futureEnd;

		const dated = this.displayRows.filter(r => r.hasDates && r.startDate && r.endDate);
		for (const t of dated) {
			if (t.startDate!.getTime() < earliest.getTime()) earliest = t.startDate!;
			if (t.endDate!.getTime() > latest.getTime()) latest = t.endDate!;
		}

		this.timelineStart = addDays(earliest, -DATE_PADDING_DAYS);
		const end = addDays(latest, DATE_PADDING_DAYS);
		this.totalDays = Math.max(daysBetween(this.timelineStart, end) + 1, 14);
	}

	// ── Rendering ────────────────────────────────────────────────────

	private render(): void {
		const container = this.contentEl;
		// Preserve the current scroll position across re-renders (e.g. expand/collapse)
		// so the timeline doesn't jump back to the start.
		const prevTimeline = container.querySelector('.gantt-timeline') as HTMLElement | null;
		const savedScrollLeft = prevTimeline ? prevTimeline.scrollLeft : null;
		const savedScrollTop = prevTimeline ? prevTimeline.scrollTop : null;
		container.empty();
		container.addClass('gantt-container');

		// ── Tabs ─────────────────────────────────────────────────
		const tabBar = container.createDiv({ cls: 'gantt-tab-bar' });
		const byProjectTab = tabBar.createEl('button', { cls: 'gantt-tab', text: 'By Project' });
		const projectsTab = tabBar.createEl('button', { cls: 'gantt-tab', text: 'Projects' });
		const tasksTab = tabBar.createEl('button', { cls: 'gantt-tab', text: 'Tasks' });

		if (this.activeTab === 'projects') projectsTab.addClass('gantt-tab-active');
		else if (this.activeTab === 'tasks') tasksTab.addClass('gantt-tab-active');
		else byProjectTab.addClass('gantt-tab-active');

		const switchTab = (tab: 'projects' | 'tasks' | 'byproject') => {
			if (this.activeTab === tab) return;
			this.activeTab = tab;
			this.centerOnToday = true;
			this.refresh();
		};
		projectsTab.addEventListener('click', () => switchTab('projects'));
		tasksTab.addEventListener('click', () => switchTab('tasks'));
		byProjectTab.addEventListener('click', () => switchTab('byproject'));

		// Right-aligned controls: "Today" button + hide-completed toggle
		const toggleWrap = tabBar.createDiv({ cls: 'gantt-tab-spacer' });
		const todayBtn = toggleWrap.createEl('button', { cls: 'gantt-today-btn', text: 'Today' });
		todayBtn.setAttribute('title', 'Scroll the timeline to center on today');
		todayBtn.addEventListener('click', () => this.centerTimelineOnToday());
		const hideLabel = toggleWrap.createEl('label', { cls: 'gantt-hide-completed-label' });
		const checkbox = hideLabel.createEl('input', { type: 'checkbox' });
		checkbox.type = 'checkbox';
		checkbox.checked = this.hideCompleted;
		hideLabel.appendText(' Hide completed');
		checkbox.addEventListener('change', () => {
			this.hideCompleted = checkbox.checked;
			this.refresh();
		});

		if (this.displayRows.length === 0) {
			const empty = container.createDiv({ cls: 'gantt-empty' });
			let title: string;
			let msg: string;
			if (this.activeTab === 'projects') {
				title = 'No projects found';
				msg = `No files with "${this.plugin.settings.startDateProperty}" or "${this.plugin.settings.endDateProperty}" frontmatter properties were found.`;
			} else if (this.activeTab === 'byproject') {
				title = 'No projects found';
				msg = `No files with the "${this.plugin.settings.projectMarkerProperty}: true" frontmatter property were found.`;
			} else {
				title = 'No tasks found';
				msg = 'No tasks with dates (\u{1F6EB}/\u{1F4C5}) found in any file.';
			}
			empty.createEl('h3', { text: title });
			empty.createEl('p', { text: msg });
			return;
		}

		const wrapper = container.createDiv({ cls: 'gantt-wrapper' });
		const rowCount = this.displayRows.length;

		// ── Sidebar ──────────────────────────────────────────────
		const sidebarW = this.plugin.settings.sidebarWidth;
		const sidebar = wrapper.createDiv({ cls: 'gantt-sidebar' });
		sidebar.style.width = `${sidebarW}px`;
		sidebar.style.minWidth = `${sidebarW}px`;
		const sidebarHeaderText = this.activeTab === 'tasks' ? 'Task' : 'Project';
		sidebar.createDiv({ cls: 'gantt-sidebar-header', text: sidebarHeaderText });
		const sidebarBody = sidebar.createDiv({ cls: 'gantt-sidebar-body' });

		// Resize handle
		const resizeHandle = wrapper.createDiv({ cls: 'gantt-sidebar-resize' });
		resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startW = this.plugin.settings.sidebarWidth;
			const onMove = (ev: MouseEvent) => {
				const newW = Math.max(120, Math.min(500, startW + ev.clientX - startX));
				sidebar.style.width = `${newW}px`;
				sidebar.style.minWidth = `${newW}px`;
			};
			const onUp = async (ev: MouseEvent) => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				const finalW = Math.max(120, Math.min(500, startW + ev.clientX - startX));
				this.plugin.settings.sidebarWidth = finalW;
				await this.plugin.saveSettings();
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});

		for (const row of this.displayRows) {
			if (row.type === 'project' && (row.project || row.projectFile)) {
				const projectFile = row.project ? row.project.file : row.projectFile!;
				const sidebarRow = sidebarBody.createDiv({ cls: 'gantt-sidebar-row gantt-sidebar-row-project' });
				const isExpanded = this.expanded.has(projectFile.path);

				// Chevron
				const chevron = sidebarRow.createEl('span', { cls: 'gantt-chevron' });
				chevron.innerHTML = isExpanded
					? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>'
					: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';
				chevron.addEventListener('click', (e) => {
					e.preventDefault(); e.stopPropagation();
					this.toggleProject(projectFile);
				});

				// Project name (click to expand/collapse)
				const name = sidebarRow.createEl('span', { cls: 'gantt-project-name', text: row.title });
				name.addEventListener('click', (e) => {
					e.preventDefault(); e.stopPropagation();
					this.toggleProject(projectFile);
				});

				// File icon (opens file)
				const link = sidebarRow.createEl('a', { cls: 'gantt-file-link' });
				link.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
				link.setAttribute('title', 'Open file');
				link.addEventListener('click', (e) => {
					e.preventDefault(); e.stopPropagation();
					this.app.workspace.getLeaf('tab').openFile(projectFile);
				});
			} else if (row.type === 'add-task' && row.projectFile) {
				// "Add task" row
				const sidebarRow = sidebarBody.createDiv({ cls: 'gantt-sidebar-row gantt-sidebar-row-add' });
				const addLabel = sidebarRow.createEl('span', { cls: 'gantt-add-task-label', text: '+ Add task' });
				const projectFile = row.projectFile;

				addLabel.addEventListener('click', (e) => {
					e.preventDefault(); e.stopPropagation();
					// Replace label with input
					addLabel.style.display = 'none';
					const input = sidebarRow.createEl('input', { cls: 'gantt-add-task-input' });
					input.type = 'text';
					input.placeholder = 'Task name...';
					input.focus();

					const submit = async () => {
						const name = input.value.trim();
						if (!name) {
							addLabel.style.display = '';
							input.remove();
							return;
						}
						await this.addTaskToFile(projectFile, name);
						input.value = '';
						input.focus();
					};

					input.addEventListener('keydown', (ke) => {
						if (ke.key === 'Enter') {
							ke.preventDefault();
							submit();
						} else if (ke.key === 'Escape') {
							addLabel.style.display = '';
							input.remove();
						}
					});

					input.addEventListener('blur', () => {
						// Small delay so Enter can fire first
						setTimeout(() => {
							if (input.parentElement) {
								addLabel.style.display = '';
								input.remove();
							}
						}, 150);
					});
				});
			} else if (row.fileTask) {
				const isNested = this.activeTab !== 'tasks';
				const baseCls = isNested ? 'gantt-sidebar-row gantt-sidebar-row-task' : 'gantt-sidebar-row gantt-sidebar-row-task-flat';
				let cls = row.hasDates ? baseCls : baseCls + ' gantt-sidebar-row-undated';
				if (row.completed) cls += ' gantt-sidebar-row-completed';
				const sidebarRow = sidebarBody.createDiv({ cls });
				sidebarRow.createEl('span', { cls: 'gantt-task-text', text: row.title });
				if (!isNested) {
					// Show source file name in tasks-only mode (clickable)
					const source = sidebarRow.createEl('a', { cls: 'gantt-task-source', text: row.fileTask.file.basename });
					source.setAttribute('title', 'Open: ' + row.fileTask.file.path);
					const sourceFile = row.fileTask.file;
					source.addEventListener('click', (ev) => {
						ev.preventDefault(); ev.stopPropagation();
						this.app.workspace.getLeaf('tab').openFile(sourceFile);
					});
				}
				if (!row.hasDates) {
					sidebarRow.createEl('span', { cls: 'gantt-no-dates-badge', text: 'no dates' });
				}
				const ft = row.fileTask;
				sidebarRow.addEventListener('dblclick', (e) => {
					e.preventDefault(); e.stopPropagation();
					new FileTaskEditModal(this.app, ft).open();
				});
			}
		}

		// ── Timeline ─────────────────────────────────────────────
		const timelineWidth = this.totalDays * this.dayWidth;
		const timeline = wrapper.createDiv({ cls: 'gantt-timeline' });

		const header = timeline.createDiv({ cls: 'gantt-timeline-header' });
		header.style.width = `${timelineWidth}px`;
		this.renderHeader(header);

		const body = timeline.createDiv({ cls: 'gantt-timeline-body' });
		body.style.width = `${timelineWidth}px`;
		body.style.height = `${rowCount * ROW_HEIGHT}px`;
		this.renderGrid(body, rowCount);
		this.renderBars(body);

		this.setupScrollSync(timeline, sidebarBody);
		this.setupZoom(timeline);

		if (this.centerOnToday) {
			this.centerOnToday = false;
			const today = stripTime(new Date());
			const todayX = daysBetween(this.timelineStart, today) * this.dayWidth + this.dayWidth / 2;
			// Defer until the element is laid out so clientWidth is known.
			requestAnimationFrame(() => {
				timeline.scrollLeft = Math.max(0, todayX - timeline.clientWidth / 2);
			});
		} else if (savedScrollLeft !== null) {
			// Keep the timeline where the user left it after a re-render.
			timeline.scrollLeft = savedScrollLeft;
			if (savedScrollTop !== null) {
				timeline.scrollTop = savedScrollTop;
				sidebarBody.scrollTop = savedScrollTop;
			}
		}
	}

	private renderBars(body: HTMLElement): void {
		for (let i = 0; i < this.displayRows.length; i++) {
			const row = this.displayRows[i]!;

			if (row.type === 'project' && row.aggregate && row.projectFile && row.segments && row.segments.length) {
				// Rolled-up project bar: derived from its tasks, so it is read-only
				// (no drag, no date editing — you edit the underlying tasks instead).
				// Drawn as one segment per task interval, leaving gaps where the
				// project has no tasks.
				const projectFile = row.projectFile;
				const currentRow = row;
				row.segments.forEach((seg, segIdx) => {
					// Show the project name only on the first (earliest) segment.
					const label = segIdx === 0 ? row.title : '';
					const bar = this.createBar(body, i, seg.start, seg.end, label, row.colorIndex);
					bar.addClass('gantt-bar-aggregate');
					bar.addEventListener('click', (e) => { e.stopPropagation(); this.selectBar(currentRow, bar); });
					bar.addEventListener('dblclick', (e) => {
						e.preventDefault(); e.stopPropagation();
						this.app.workspace.getLeaf('tab').openFile(projectFile);
					});
				});
			} else if (row.type === 'project' && row.project && row.startDate && row.endDate) {
				const task = row.project;
				const bar = this.createBar(body, i, row.startDate, row.endDate, row.title, row.colorIndex);
				const currentRow = row;
				bar.addEventListener('click', (e) => { e.stopPropagation(); this.selectBar(currentRow, bar); });
				bar.addEventListener('contextmenu', (e) => this.showContextMenu(e, currentRow));
				bar.addEventListener('dblclick', (e) => {
					e.preventDefault(); e.stopPropagation();
					new ProjectEditModal(this.app, this.plugin.settings, task).open();
				});
				this.attachDrag(bar, async (s, e) => {
					await this.app.fileManager.processFrontMatter(task.file, (fm) => {
						fm[this.plugin.settings.startDateProperty] = formatDate(s);
						fm[this.plugin.settings.endDateProperty] = formatDate(e);
					});
				});
			} else if (row.fileTask && row.hasDates && row.startDate && row.endDate) {
				const ft = row.fileTask;
				const bar = this.createBar(body, i, row.startDate, row.endDate, row.title, row.colorIndex);
				bar.addClass('gantt-bar-subtask');
				if (row.completed) bar.addClass('gantt-bar-completed');
				const currentRow = row;
				bar.addEventListener('click', (e) => { e.stopPropagation(); this.selectBar(currentRow, bar); });
				bar.addEventListener('contextmenu', (e) => this.showContextMenu(e, currentRow));
				bar.addEventListener('dblclick', (e) => {
					e.preventDefault(); e.stopPropagation();
					new FileTaskEditModal(this.app, ft).open();
				});
				this.attachDrag(bar, (s, e) => updateFileTaskDates(this.app, ft, s, e));
			} else if (row.type === 'task' && row.fileTask && !row.hasDates) {
				// Undated task: render a full-width zone. Click for a single day, or
				// press and drag to draw a bar spanning as many days as you like.
				const ft = row.fileTask;
				const rowIndex = i;
				const zone = body.createDiv({ cls: 'gantt-undated-zone' });
				zone.style.top = `${i * ROW_HEIGHT}px`;
				zone.style.height = `${ROW_HEIGHT}px`;
				zone.style.width = `${this.totalDays * this.dayWidth}px`;
				zone.setAttribute('title', 'Click or drag on this row to set a date for: ' + ft.text + '\n(Double-click the task name to edit precisely)');

				zone.addEventListener('mousedown', (e: MouseEvent) => {
					e.preventDefault();
					e.stopPropagation();
					const startDayIdx = Math.max(0, Math.floor((e.clientX - zone.getBoundingClientRect().left) / this.dayWidth));
					let endDayIdx = startDayIdx;

					const color = TASK_COLORS[row.colorIndex] ?? TASK_COLORS[0]!;
					const temp = body.createDiv({ cls: 'gantt-bar gantt-bar-subtask gantt-bar-dragging' });
					temp.style.top = `${rowIndex * ROW_HEIGHT + BAR_VERTICAL_OFFSET}px`;
					temp.style.height = `${BAR_HEIGHT}px`;
					temp.style.backgroundColor = color.bg;
					temp.style.borderColor = color.border;
					const paint = () => {
						const lo = Math.min(startDayIdx, endDayIdx);
						const hi = Math.max(startDayIdx, endDayIdx);
						temp.style.left = `${lo * this.dayWidth}px`;
						temp.style.width = `${(hi - lo + 1) * this.dayWidth}px`;
					};
					paint();

					const onMove = (ev: MouseEvent) => {
						endDayIdx = Math.max(0, Math.floor((ev.clientX - zone.getBoundingClientRect().left) / this.dayWidth));
						paint();
					};
					const onUp = async (ev: MouseEvent) => {
						document.removeEventListener('mousemove', onMove);
						document.removeEventListener('mouseup', onUp);
						endDayIdx = Math.max(0, Math.floor((ev.clientX - zone.getBoundingClientRect().left) / this.dayWidth));
						const lo = Math.min(startDayIdx, endDayIdx);
						const hi = Math.max(startDayIdx, endDayIdx);
						const s = addDays(this.timelineStart, lo);
						const e2 = addDays(this.timelineStart, hi);
						await updateFileTaskDates(this.app, ft, s, e2);
					};
					document.addEventListener('mousemove', onMove);
					document.addEventListener('mouseup', onUp);
				});
			}
		}
	}

	// ── Shared rendering helpers ─────────────────────────────────────

	private setupScrollSync(timeline: HTMLElement, sidebarBody: HTMLElement): void {
		timeline.addEventListener('scroll', () => { sidebarBody.scrollTop = timeline.scrollTop; });
	}

	// Scroll the timeline horizontally so today sits in the middle of the view.
	private centerTimelineOnToday(): void {
		const timeline = this.contentEl.querySelector('.gantt-timeline') as HTMLElement | null;
		if (!timeline) return;
		const today = stripTime(new Date());
		const todayX = daysBetween(this.timelineStart, today) * this.dayWidth + this.dayWidth / 2;
		timeline.scrollLeft = Math.max(0, todayX - timeline.clientWidth / 2);
	}

	private setupZoom(timeline: HTMLElement): void {
		timeline.addEventListener('wheel', (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			const fraction = timeline.scrollWidth > 0
				? (timeline.scrollLeft + timeline.clientWidth / 2) / timeline.scrollWidth : 0.5;
			this.dayWidth = e.deltaY < 0
				? Math.min(this.dayWidth + ZOOM_STEP, DAY_WIDTH_MAX)
				: Math.max(this.dayWidth - ZOOM_STEP, DAY_WIDTH_MIN);
			this.render();
			const el = this.contentEl.querySelector('.gantt-timeline') as HTMLElement | null;
			if (el) el.scrollLeft = Math.max(0, fraction * el.scrollWidth - el.clientWidth / 2);
		}, { passive: false });
	}

	private getZoomLevel(): 'day' | 'week' | 'month' {
		if (this.dayWidth >= 20) return 'day';
		if (this.dayWidth >= 12) return 'week';
		return 'month';
	}

	private renderHeader(header: HTMLElement): void {
		const zoom = this.getZoomLevel();
		const topRow = header.createDiv({ cls: 'gantt-month-row' });
		const bottomRow = header.createDiv({ cls: 'gantt-day-row' });

		if (zoom === 'day') {
			this.renderHeaderDaily(topRow, bottomRow);
		} else if (zoom === 'week') {
			this.renderHeaderWeekly(topRow, bottomRow);
		} else {
			this.renderHeaderMonthly(topRow, bottomRow);
		}
	}

	private renderHeaderDaily(topRow: HTMLElement, bottomRow: HTMLElement): void {
		let curMonth = -1, curYear = -1, span = 0;
		let mEl: HTMLElement | null = null;

		for (let i = 0; i < this.totalDays; i++) {
			const d = addDays(this.timelineStart, i);
			if (d.getMonth() !== curMonth || d.getFullYear() !== curYear) {
				if (mEl) mEl.style.width = `${span * this.dayWidth}px`;
				curMonth = d.getMonth(); curYear = d.getFullYear(); span = 0;
				mEl = topRow.createDiv({ cls: 'gantt-month-cell' });
				mEl.textContent = `${MONTH_NAMES[curMonth]} ${curYear}`;
			}
			span++;
			const dc = bottomRow.createDiv({ cls: 'gantt-day-cell' });
			dc.style.width = `${this.dayWidth}px`;
			dc.style.minWidth = `${this.dayWidth}px`;
			dc.textContent = String(d.getDate());
			if (isWeekend(d)) dc.addClass('gantt-weekend');
			if (isToday(d)) dc.addClass('gantt-today');
		}
		if (mEl) mEl.style.width = `${span * this.dayWidth}px`;
	}

	private renderHeaderWeekly(topRow: HTMLElement, bottomRow: HTMLElement): void {
		let curMonth = -1, curYear = -1, monthSpan = 0;
		let mEl: HTMLElement | null = null;
		let weekSpan = 0;
		let wEl: HTMLElement | null = null;
		let weekStart: Date | null = null;

		for (let i = 0; i < this.totalDays; i++) {
			const d = addDays(this.timelineStart, i);
			const isMonday = d.getDay() === 1;

			// Top row: months
			if (d.getMonth() !== curMonth || d.getFullYear() !== curYear) {
				if (mEl) mEl.style.width = `${monthSpan * this.dayWidth}px`;
				curMonth = d.getMonth(); curYear = d.getFullYear(); monthSpan = 0;
				mEl = topRow.createDiv({ cls: 'gantt-month-cell' });
				mEl.textContent = `${MONTH_NAMES[curMonth]} ${curYear}`;
			}
			monthSpan++;

			// Bottom row: weeks (split on Monday)
			if (isMonday || i === 0) {
				if (wEl && weekStart) {
					wEl.style.width = `${weekSpan * this.dayWidth}px`;
					wEl.textContent = `${weekStart.getDate()} ${MONTH_NAMES[weekStart.getMonth()]?.substring(0, 3)}`;
				}
				weekSpan = 0;
				weekStart = d;
				wEl = bottomRow.createDiv({ cls: 'gantt-day-cell gantt-week-cell' });
			}
			weekSpan++;
		}
		if (mEl) mEl.style.width = `${monthSpan * this.dayWidth}px`;
		if (wEl && weekStart) {
			wEl.style.width = `${weekSpan * this.dayWidth}px`;
			wEl.textContent = `${weekStart.getDate()} ${MONTH_NAMES[weekStart.getMonth()]?.substring(0, 3)}`;
		}
	}

	private renderHeaderMonthly(topRow: HTMLElement, bottomRow: HTMLElement): void {
		let curYear = -1, yearSpan = 0;
		let yEl: HTMLElement | null = null;
		let curMonth = -1, curMonthYear = -1, monthSpan = 0;
		let mEl: HTMLElement | null = null;

		for (let i = 0; i < this.totalDays; i++) {
			const d = addDays(this.timelineStart, i);

			// Top row: years
			if (d.getFullYear() !== curYear) {
				if (yEl) yEl.style.width = `${yearSpan * this.dayWidth}px`;
				curYear = d.getFullYear(); yearSpan = 0;
				yEl = topRow.createDiv({ cls: 'gantt-month-cell' });
				yEl.textContent = String(curYear);
			}
			yearSpan++;

			// Bottom row: months
			if (d.getMonth() !== curMonth || d.getFullYear() !== curMonthYear) {
				if (mEl) mEl.style.width = `${monthSpan * this.dayWidth}px`;
				curMonth = d.getMonth(); curMonthYear = d.getFullYear(); monthSpan = 0;
				mEl = bottomRow.createDiv({ cls: 'gantt-day-cell gantt-month-label-cell' });
				mEl.textContent = MONTH_NAMES[curMonth]?.substring(0, 3) ?? '';
			}
			monthSpan++;
		}
		if (yEl) yEl.style.width = `${yearSpan * this.dayWidth}px`;
		if (mEl) mEl.style.width = `${monthSpan * this.dayWidth}px`;
	}

	private renderGrid(body: HTMLElement, rowCount: number): void {
		const grid = body.createDiv({ cls: 'gantt-grid' });
		const h = rowCount * ROW_HEIGHT;
		const zoom = this.getZoomLevel();

		for (let i = 0; i < this.totalDays; i++) {
			const d = addDays(this.timelineStart, i);
			const col = grid.createDiv({ cls: 'gantt-grid-col' });
			col.style.left = `${i * this.dayWidth}px`;
			col.style.width = `${this.dayWidth}px`;
			col.style.height = `${h}px`;

			if (zoom === 'day') {
				// Show all day gridlines, highlight weekends & today
				if (isWeekend(d)) col.addClass('gantt-weekend');
				if (isToday(d)) col.addClass('gantt-today');
			} else if (zoom === 'week') {
				// Only show gridlines on Mondays, highlight today
				if (d.getDay() === 1) col.addClass('gantt-grid-col-major');
				else col.addClass('gantt-grid-col-minor');
				if (isToday(d)) col.addClass('gantt-today');
			} else {
				// Only show gridlines on 1st of month, highlight today
				if (d.getDate() === 1) col.addClass('gantt-grid-col-major');
				else col.addClass('gantt-grid-col-minor');
				if (isToday(d)) col.addClass('gantt-today');
			}
		}
		for (let r = 0; r <= rowCount; r++) {
			const line = grid.createDiv({ cls: 'gantt-row-line' });
			line.style.top = `${r * ROW_HEIGHT}px`;
			line.style.width = `${this.totalDays * this.dayWidth}px`;
		}
	}

	private createBar(body: HTMLElement, row: number, start: Date, end: Date, title: string, ci: number): HTMLElement {
		const so = daysBetween(this.timelineStart, start);
		const dur = daysBetween(start, end) + 1;
		const color = TASK_COLORS[ci] ?? TASK_COLORS[0]!;

		const bar = body.createDiv({ cls: 'gantt-bar' });
		bar.style.left = `${so * this.dayWidth}px`;
		bar.style.width = `${dur * this.dayWidth}px`;
		bar.style.top = `${row * ROW_HEIGHT + BAR_VERTICAL_OFFSET}px`;
		bar.style.height = `${BAR_HEIGHT}px`;
		bar.style.backgroundColor = color.bg;
		bar.style.borderColor = color.border;

		bar.createDiv({ cls: 'gantt-bar-label' }).textContent = title;
		bar.setAttribute('title', `${title}\n${formatDate(start)} \u2013 ${formatDate(end)}`);
		bar.createDiv({ cls: 'gantt-bar-handle gantt-bar-handle-left' });
		bar.createDiv({ cls: 'gantt-bar-handle gantt-bar-handle-right' });
		return bar;
	}

	private attachDrag(bar: HTMLElement, onEnd: (s: Date, e: Date) => Promise<void>): void {
		const hL = bar.querySelector('.gantt-bar-handle-left') as HTMLElement;
		const hR = bar.querySelector('.gantt-bar-handle-right') as HTMLElement;

		const startDrag = (ev: MouseEvent, type: 'move' | 'resize-start' | 'resize-end') => {
			ev.preventDefault(); ev.stopPropagation();
			const oL = parseInt(bar.style.left, 10), oW = parseInt(bar.style.width, 10), sX = ev.clientX;
			bar.addClass('gantt-bar-dragging');

			const move = (e: MouseEvent) => {
				const dd = Math.round((e.clientX - sX) / this.dayWidth);
				if (type === 'move') bar.style.left = `${oL + dd * this.dayWidth}px`;
				else if (type === 'resize-start') {
					const nw = oW - dd * this.dayWidth;
					if (nw >= this.dayWidth) { bar.style.left = `${oL + dd * this.dayWidth}px`; bar.style.width = `${nw}px`; }
				} else {
					const nw = oW + dd * this.dayWidth;
					if (nw >= this.dayWidth) bar.style.width = `${nw}px`;
				}
			};

			const up = async (e: MouseEvent) => {
				document.removeEventListener('mousemove', move);
				document.removeEventListener('mouseup', up);
				bar.removeClass('gantt-bar-dragging');
				const dd = Math.round((e.clientX - sX) / this.dayWidth);
				if (dd === 0) return;
				const osd = addDays(this.timelineStart, Math.round(oL / this.dayWidth));
				const oed = addDays(osd, Math.round(oW / this.dayWidth) - 1);
				let ns: Date, ne: Date;
				if (type === 'move') { ns = addDays(osd, dd); ne = addDays(oed, dd); }
				else if (type === 'resize-start') { ns = addDays(osd, dd); ne = oed; if (ns > ne) ns = ne; }
				else { ns = osd; ne = addDays(oed, dd); if (ne < ns) ne = ns; }
				await onEnd(ns, ne);
			};

			document.addEventListener('mousemove', move);
			document.addEventListener('mouseup', up);
		};

		bar.addEventListener('mousedown', (e) => { if (e.target !== hL && e.target !== hR) startDrag(e, 'move'); });
		hL.addEventListener('mousedown', (e) => startDrag(e, 'resize-start'));
		hR.addEventListener('mousedown', (e) => startDrag(e, 'resize-end'));
	}
}
