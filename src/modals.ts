import { App, Modal, Setting } from 'obsidian';
import { START_EMOJI, DUE_EMOJI } from './constants';
import { GanttTask, FileTask, GanttSettings } from './types';
import { formatDate, parseDate, updateFileTaskDates } from './utils';

export class ProjectEditModal extends Modal {
	private task: GanttTask;
	private settings: GanttSettings;

	constructor(app: App, settings: GanttSettings, task: GanttTask) {
		super(app);
		this.settings = settings;
		this.task = task;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gantt-modal');

		contentEl.createEl('h2', { text: this.task.title, cls: 'gantt-modal-title' });

		const startProp = this.settings.startDateProperty;
		const endProp = this.settings.endDateProperty;

		let currentStart = formatDate(this.task.startDate);
		let currentEnd = formatDate(this.task.endDate);

		new Setting(contentEl)
			.setName(startProp)
			.addText((text) => {
				text.setValue(currentStart).setPlaceholder('YYYY-MM-DD');
				text.inputEl.type = 'date';
				text.inputEl.addClass('gantt-modal-date-input');
				text.onChange((value) => { currentStart = value; });
			});

		new Setting(contentEl)
			.setName(endProp)
			.addText((text) => {
				text.setValue(currentEnd).setPlaceholder('YYYY-MM-DD');
				text.inputEl.type = 'date';
				text.inputEl.addClass('gantt-modal-date-input');
				text.onChange((value) => { currentEnd = value; });
			});

		const btnContainer = contentEl.createDiv({ cls: 'gantt-modal-buttons' });
		btnContainer.createEl('button', { text: 'Save', cls: 'mod-cta' }).addEventListener('click', async () => {
			const newStart = parseDate(currentStart);
			const newEnd = parseDate(currentEnd);
			if (!newStart || !newEnd) return;

			const finalStart = newStart.getTime() <= newEnd.getTime() ? newStart : newEnd;
			const finalEnd = newStart.getTime() <= newEnd.getTime() ? newEnd : newStart;

			try {
				await this.app.fileManager.processFrontMatter(this.task.file, (fm) => {
					fm[startProp] = formatDate(finalStart);
					fm[endProp] = formatDate(finalEnd);
				});
			} catch (err) {
				console.error('Gantt Chart: failed to update frontmatter', err);
			}
			this.close();
		});

		btnContainer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
	}

	onClose(): void { this.contentEl.empty(); }
}

export class FileTaskEditModal extends Modal {
	private fileTask: FileTask;

	constructor(app: App, fileTask: FileTask) {
		super(app);
		this.fileTask = fileTask;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gantt-modal');

		contentEl.createEl('h2', { text: this.fileTask.text, cls: 'gantt-modal-title' });

		let currentStart = this.fileTask.startDate ? formatDate(this.fileTask.startDate) : '';
		let currentEnd = this.fileTask.endDate ? formatDate(this.fileTask.endDate) : '';

		new Setting(contentEl)
			.setName('Start date (' + START_EMOJI + ')')
			.addText((text) => {
				text.setValue(currentStart).setPlaceholder('YYYY-MM-DD');
				text.inputEl.type = 'date';
				text.inputEl.addClass('gantt-modal-date-input');
				text.onChange((value) => { currentStart = value; });
			});

		new Setting(contentEl)
			.setName('Due date (' + DUE_EMOJI + ')')
			.addText((text) => {
				text.setValue(currentEnd).setPlaceholder('YYYY-MM-DD');
				text.inputEl.type = 'date';
				text.inputEl.addClass('gantt-modal-date-input');
				text.onChange((value) => { currentEnd = value; });
			});

		const btnContainer = contentEl.createDiv({ cls: 'gantt-modal-buttons' });
		btnContainer.createEl('button', { text: 'Save', cls: 'mod-cta' }).addEventListener('click', async () => {
			const newStart = parseDate(currentStart);
			const newEnd = parseDate(currentEnd);
			if (!newStart || !newEnd) return;

			const finalStart = newStart.getTime() <= newEnd.getTime() ? newStart : newEnd;
			const finalEnd = newStart.getTime() <= newEnd.getTime() ? newEnd : newStart;

			await updateFileTaskDates(this.app, this.fileTask, finalStart, finalEnd);
			this.close();
		});

		btnContainer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
	}

	onClose(): void { this.contentEl.empty(); }
}
