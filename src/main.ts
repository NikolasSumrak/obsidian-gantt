import { Plugin, debounce } from 'obsidian';
import { VIEW_TYPE } from './constants';
import { GanttSettings, DEFAULT_SETTINGS } from './types';
import { GanttChartView } from './gantt-view';
import { GanttSettingTab } from './settings';

export default class GanttPlugin extends Plugin {
	settings: GanttSettings = DEFAULT_SETTINGS;

	private debouncedRefresh = debounce(() => { this.refreshViews(); }, 300, true);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerView(VIEW_TYPE, (leaf) => new GanttChartView(leaf, this));
		this.addRibbonIcon('bar-chart-horizontal', 'Open Gantt Chart', () => this.activateView());
		this.addCommand({ id: 'open-gantt-chart', name: 'Open Gantt Chart', callback: () => this.activateView() });
		this.addSettingTab(new GanttSettingTab(this.app, this));
		this.registerEvent(this.app.metadataCache.on('changed', () => this.debouncedRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.debouncedRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.debouncedRefresh()));
		this.registerEvent(this.app.vault.on('modify', () => this.debouncedRefresh()));
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			const newLeaf = workspace.getLeaf('tab');
			await newLeaf.setViewState({ type: VIEW_TYPE, active: true });
			leaf = newLeaf;
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof GanttChartView) leaf.view.refresh();
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<GanttSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
