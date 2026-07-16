import { TFile } from 'obsidian';

export interface GanttSettings {
	startDateProperty: string;
	endDateProperty: string;
	hideCompletedTasks: boolean;
	sidebarWidth: number;
	projectMarkerProperty: string;
	excludedFolders: string[];
	historyMonths: number;
	futureMonths: number;
}

export const DEFAULT_SETTINGS: GanttSettings = {
	startDateProperty: 'start_date',
	endDateProperty: 'end_date',
	hideCompletedTasks: false,
	sidebarWidth: 220,
	projectMarkerProperty: 'gantt',
	excludedFolders: [],
	historyMonths: 1,
	futureMonths: 6,
};

export interface GanttTask {
	file: TFile;
	title: string;
	startDate: Date;
	endDate: Date;
	colorIndex: number;
}

export interface FileTask {
	file: TFile;
	lineNumber: number;
	text: string;
	startDate: Date | null;
	endDate: Date | null;
	colorIndex: number;
	completed: boolean;
}
