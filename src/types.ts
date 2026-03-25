import { TFile } from 'obsidian';

export interface GanttSettings {
	startDateProperty: string;
	endDateProperty: string;
}

export const DEFAULT_SETTINGS: GanttSettings = {
	startDateProperty: 'start_date',
	endDateProperty: 'end_date',
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
}
