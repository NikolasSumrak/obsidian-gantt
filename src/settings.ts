import { App, PluginSettingTab, Setting, debounce } from 'obsidian';
import type GanttPlugin from './main';

export class GanttSettingTab extends PluginSettingTab {
	private plugin: GanttPlugin;

	constructor(app: App, plugin: GanttPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Gantt Chart Settings' });

		const allProperties = this.collectAllPropertyNames();

		this.addPropertySetting(containerEl, 'Start date property',
			'The frontmatter property name used for project start dates.',
			this.plugin.settings.startDateProperty, allProperties,
			async (value: string) => {
				this.plugin.settings.startDateProperty = value;
				await this.plugin.saveSettings();
				this.plugin.refreshViews();
			});

		this.addPropertySetting(containerEl, 'End date property',
			'The frontmatter property name used for project end dates.',
			this.plugin.settings.endDateProperty, allProperties,
			async (value: string) => {
				this.plugin.settings.endDateProperty = value;
				await this.plugin.saveSettings();
				this.plugin.refreshViews();
			});

		new Setting(containerEl)
			.setName('Hide completed tasks')
			.setDesc('Hide tasks marked as done ([x]) by default when opening the Gantt chart.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.hideCompletedTasks);
				toggle.onChange(async (value) => {
					this.plugin.settings.hideCompletedTasks = value;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				});
			});

		containerEl.createEl('h3', { text: 'By Project mode' });

		this.addPropertySetting(containerEl, 'Project marker property',
			'Frontmatter property that marks a note as a project in the "By Project" tab (e.g. "gantt: true"). The project bar is derived from the dates of the tasks inside the note.',
			this.plugin.settings.projectMarkerProperty, allProperties,
			async (value: string) => {
				this.plugin.settings.projectMarkerProperty = value.trim() || 'gantt';
				await this.plugin.saveSettings();
				this.plugin.refreshViews();
			});

		containerEl.createEl('h3', { text: 'Filtering & timeline' });

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Folders to ignore when scanning for projects and tasks (one folder path per line). Applies to all tabs.')
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.excludedFolders.join('\n'));
				text.setPlaceholder('Templates\nArchive/2024');
				text.inputEl.rows = 4;
				text.inputEl.addClass('gantt-excluded-folders-input');
				text.onChange(debounce(async (value: string) => {
					this.plugin.settings.excludedFolders = value
						.split('\n')
						.map((s) => s.trim())
						.filter((s) => s.length > 0);
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				}, 500, true));
			});

		new Setting(containerEl)
			.setName('History window (months back)')
			.setDesc('How many months before today the timeline extends. Today is centered when the chart opens.')
			.addSlider((slider) => {
				slider.setLimits(1, 24, 1);
				slider.setValue(this.plugin.settings.historyMonths);
				slider.setDynamicTooltip();
				slider.onChange(async (value) => {
					this.plugin.settings.historyMonths = value;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				});
			});

		new Setting(containerEl)
			.setName('Future window (months ahead)')
			.setDesc('How many months after today the timeline extends, so you can scroll and schedule ahead.')
			.addSlider((slider) => {
				slider.setLimits(1, 24, 1);
				slider.setValue(this.plugin.settings.futureMonths);
				slider.setDynamicTooltip();
				slider.onChange(async (value) => {
					this.plugin.settings.futureMonths = value;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				});
			});
	}

	private addPropertySetting(containerEl: HTMLElement, name: string, desc: string,
		currentValue: string, options: string[], onChange: (value: string) => Promise<void>): void {
		const datalistId = `gantt-datalist-${name.replace(/\s+/g, '-').toLowerCase()}`;
		new Setting(containerEl).setName(name).setDesc(desc).addText((text) => {
			text.setValue(currentValue).setPlaceholder('Property name...');
			const datalist = document.createElement('datalist');
			datalist.id = datalistId;
			for (const opt of options) {
				const el = document.createElement('option');
				el.value = opt;
				datalist.appendChild(el);
			}
			text.inputEl.setAttribute('list', datalistId);
			text.inputEl.parentElement?.appendChild(datalist);
			text.onChange(debounce(async (value: string) => { await onChange(value); }, 500, true));
		});
	}

	private collectAllPropertyNames(): string[] {
		const names = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			for (const key of Object.keys(fm)) {
				if (key !== 'position') names.add(key);
			}
		}
		return Array.from(names).sort((a, b) => a.localeCompare(b));
	}
}
