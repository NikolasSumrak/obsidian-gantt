import { App } from 'obsidian';
import { DAY_MS, START_EMOJI, DUE_EMOJI, SCHEDULED_EMOJI } from './constants';
import { FileTask } from './types';

export function parseDate(value: unknown): Date | null {
	if (value == null) return null;

	let str: string;
	if (value instanceof Date) {
		if (isNaN(value.getTime())) return null;
		return stripTime(value);
	} else if (typeof value === 'string') {
		str = value.trim();
	} else if (typeof value === 'number') {
		str = String(value);
	} else {
		return null;
	}

	const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) return null;

	const year = parseInt(match[1] ?? '0', 10);
	const month = parseInt(match[2] ?? '0', 10) - 1;
	const day = parseInt(match[3] ?? '0', 10);
	const d = new Date(year, month, day);

	if (isNaN(d.getTime())) return null;
	if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;

	return d;
}

export function parseDateString(str: string): Date | null {
	return parseDate(str);
}

export function stripTime(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
	const result = new Date(d.getTime());
	result.setDate(result.getDate() + n);
	return result;
}

export function daysBetween(a: Date, b: Date): number {
	return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function isWeekend(d: Date): boolean {
	const dow = d.getDay();
	return dow === 0 || dow === 6;
}

export function isToday(d: Date): boolean {
	const now = new Date();
	return d.getFullYear() === now.getFullYear()
		&& d.getMonth() === now.getMonth()
		&& d.getDate() === now.getDate();
}

export function extractTaskTitle(line: string): string {
	let text = line.replace(/^[\s]*-\s*\[.\]\s*/, '');
	text = text.replace(/[🛫📅⏳➕✅❌]\s*\d{4}-\d{2}-\d{2}/g, '');
	text = text.replace(/[⏫🔼🔽⏬]/g, '');
	text = text.replace(/🔁\s*[^\s]*/g, '');
	return text.trim() || '(untitled task)';
}

export function parseTaskLine(line: string): { start: Date | null; due: Date | null } {
	let start: Date | null = null;
	let due: Date | null = null;

	const startMatch = line.match(new RegExp(START_EMOJI + '\\s*(\\d{4}-\\d{2}-\\d{2})'));
	if (startMatch && startMatch[1]) {
		start = parseDateString(startMatch[1]);
	}

	if (!start) {
		const schedMatch = line.match(new RegExp(SCHEDULED_EMOJI + '\\s*(\\d{4}-\\d{2}-\\d{2})'));
		if (schedMatch && schedMatch[1]) {
			start = parseDateString(schedMatch[1]);
		}
	}

	const dueMatch = line.match(new RegExp(DUE_EMOJI + '\\s*(\\d{4}-\\d{2}-\\d{2})'));
	if (dueMatch && dueMatch[1]) {
		due = parseDateString(dueMatch[1]);
	}

	return { start, due };
}

export function replaceEmojiDate(line: string, emoji: string, newDate: string): string {
	const regex = new RegExp('(' + emoji + '\\s*)\\d{4}-\\d{2}-\\d{2}');
	if (regex.test(line)) {
		return line.replace(regex, '$1' + newDate);
	}
	return line.trimEnd() + ' ' + emoji + ' ' + newDate;
}

export function removeEmojiDate(line: string, emoji: string): string {
	const regex = new RegExp('\\s*' + emoji + '\\s*\\d{4}-\\d{2}-\\d{2}', 'g');
	return line.replace(regex, '');
}

export async function clearFileTaskDates(app: App, ft: FileTask): Promise<void> {
	const content = await app.vault.read(ft.file);
	const lines = content.split('\n');
	const lineIdx = ft.lineNumber;
	if (lineIdx < 0 || lineIdx >= lines.length) return;

	let line = lines[lineIdx]!;
	line = removeEmojiDate(line, START_EMOJI);
	line = removeEmojiDate(line, DUE_EMOJI);
	line = removeEmojiDate(line, SCHEDULED_EMOJI);
	lines[lineIdx] = line;

	await app.vault.modify(ft.file, lines.join('\n'));
}

export async function updateFileTaskDates(app: App, ft: FileTask, newStart: Date, newEnd: Date): Promise<void> {
	const content = await app.vault.read(ft.file);
	const lines = content.split('\n');
	const lineIdx = ft.lineNumber;
	if (lineIdx < 0 || lineIdx >= lines.length) return;

	let line = lines[lineIdx]!;
	line = replaceEmojiDate(line, START_EMOJI, formatDate(newStart));
	line = replaceEmojiDate(line, DUE_EMOJI, formatDate(newEnd));
	lines[lineIdx] = line;

	await app.vault.modify(ft.file, lines.join('\n'));
}
