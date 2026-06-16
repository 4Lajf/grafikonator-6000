export const SCHEDULE_MODES = {
	EVENTS: 'events',
	PEOPLE: 'people'
};

export const ISSUE_SEVERITY = {
	ERROR: 'error',
	WARNING: 'warning',
	INFO: 'info'
};

export function normalizeScheduleMode(value) {
	return value === SCHEDULE_MODES.PEOPLE ? SCHEDULE_MODES.PEOPLE : SCHEDULE_MODES.EVENTS;
}

export function normalizeTags(value) {
	if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
	return String(value ?? '')
		.split(/[,;\n]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function normalizeColor(value) {
	const color = String(value ?? '').trim();
	return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

export function normalizeBlockLimit(value) {
	if (value == null || value === '') return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	return Math.max(0, Math.floor(parsed));
}

export const CLUSTER_LIMIT_OPTIONS = ['0', '2', '3', '4', '5', 'MAX'];

export function normalizeClusterLimit(value) {
	const raw = String(value ?? '0').toUpperCase();
	return CLUSTER_LIMIT_OPTIONS.includes(raw) ? raw : '0';
}

export function clusterLimitToNumber(value) {
	const normalized = normalizeClusterLimit(value);
	if (normalized === 'MAX') return Number.POSITIVE_INFINITY;
	return Number(normalized);
}

export function haveSharedTags(a, b) {
	const left = normalizeTags(a);
	if (!left.length) return false;
	const right = new Set(normalizeTags(b).map((tag) => tag.toLowerCase()));
	return left.some((tag) => right.has(tag.toLowerCase()));
}

export function normalizeIssue(issue) {
	const severity = issue?.severity || ISSUE_SEVERITY.INFO;
	const code = issue?.code || inferIssueCode(issue?.message);
	return {
		...issue,
		severity,
		code,
		priority: issue?.priority ?? issuePriority({ severity, code })
	};
}

export function inferIssueCode(message = '') {
	const normalized = String(message).toLowerCase();
	if (normalized.includes('niedostępny w tym czasie')) return 'availability-unavailable';
	if (normalized.includes('nie mogę')) return 'availability-unavailable';
	if (normalized.includes('tier atrakcji')) return 'tier-mismatch';
	if (normalized.includes('tag')) return 'tag-conflict';
	return 'generic';
}

export function issuePriority(issue) {
	if (issue.code === 'availability-unavailable') return 0;
	if (issue.severity === ISSUE_SEVERITY.ERROR) return 10;
	if (issue.severity === ISSUE_SEVERITY.WARNING) return 20;
	if (issue.severity === ISSUE_SEVERITY.INFO) return 30;
	return 40;
}

export function sortIssuesByPriority(issues) {
	return [...issues].map(normalizeIssue).sort((a, b) => {
		if (a.priority !== b.priority) return a.priority - b.priority;
		return String(a.message || '').localeCompare(String(b.message || ''));
	});
}

export function normalizeModeSettings(mode, settings = {}) {
	const scheduleMode = normalizeScheduleMode(mode);
	return {
		...settings,
		mode: scheduleMode
	};
}
