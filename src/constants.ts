export const VIEW_TYPE = 'gantt-chart-view';
export const DAY_MS = 86400000;
export const DAY_WIDTH_DEFAULT = 32;
export const DAY_WIDTH_MIN = 8;
export const DAY_WIDTH_MAX = 80;
export const ZOOM_STEP = 4;
export const SIDEBAR_WIDTH = 220;
export const ROW_HEIGHT = 40;
export const HEADER_HEIGHT = 52;
export const BAR_HEIGHT = 26;
export const BAR_VERTICAL_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;
export const RESIZE_HANDLE_WIDTH = 8;
export const DATE_PADDING_DAYS = 3;

// Tasks plugin emoji markers
export const START_EMOJI = '\u{1F6EB}'; // 🛫
export const DUE_EMOJI = '\u{1F4C5}';   // 📅
export const SCHEDULED_EMOJI = '\u{23F3}'; // ⏳

export const TASK_COLORS = [
	{ bg: 'hsl(210, 70%, 55%)', border: 'hsl(210, 70%, 45%)' },
	{ bg: 'hsl(150, 55%, 45%)', border: 'hsl(150, 55%, 35%)' },
	{ bg: 'hsl(340, 65%, 55%)', border: 'hsl(340, 65%, 45%)' },
	{ bg: 'hsl(35, 80%, 52%)', border: 'hsl(35, 80%, 42%)' },
	{ bg: 'hsl(270, 55%, 55%)', border: 'hsl(270, 55%, 45%)' },
	{ bg: 'hsl(185, 60%, 45%)', border: 'hsl(185, 60%, 35%)' },
	{ bg: 'hsl(10, 70%, 55%)', border: 'hsl(10, 70%, 45%)' },
	{ bg: 'hsl(60, 60%, 45%)', border: 'hsl(60, 60%, 35%)' },
	{ bg: 'hsl(300, 45%, 55%)', border: 'hsl(300, 45%, 45%)' },
	{ bg: 'hsl(120, 45%, 45%)', border: 'hsl(120, 45%, 35%)' },
];

export const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];
