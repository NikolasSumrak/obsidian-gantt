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
