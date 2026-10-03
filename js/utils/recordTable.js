const getColumnLabels = (tableBody) => [...(tableBody.closest('table')?.querySelectorAll('thead th') || [])]
	.map((header) => header.textContent.trim());

const escapeHtml = (value) => String(value ?? '')
	.replaceAll('&', '&amp;')
	.replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;')
	.replaceAll("'", '&#039;');

export const renderTableState = (tableBody, { message, actionLabel, state = 'empty' }) => {
	if (!tableBody) return;
	const columnCount = getColumnLabels(tableBody).length || 1;
	const button = actionLabel
		? `<button type="button" class="secondary-button" data-clear-filters>${escapeHtml(actionLabel)}</button>`
		: '';
	tableBody.innerHTML = `<tr class="table-state-row table-state-${escapeHtml(state)}"><td class="table-state-cell" colspan="${columnCount}"><p class="table-state-message" role="${state === 'error' ? 'alert' : 'status'}">${escapeHtml(message)}</p>${button}</td></tr>`;
	tableBody.setAttribute?.('aria-busy', String(state === 'loading'));
};

export const observeResponsiveTableLabels = (root) => {
	if (!root) return null;
	const applyLabels = (tableBody) => {
		const labels = getColumnLabels(tableBody);
		if (!labels.length) return;
		if (!tableBody.querySelector('.loading-cell')) tableBody.setAttribute('aria-busy', 'false');
		tableBody.querySelectorAll('tr').forEach((row) => {
			const cells = [...row.children];
			if (cells.length !== labels.length || cells.some((cell) => cell.colSpan !== 1)) return;
			cells.forEach((cell, index) => {
				if (cell.tagName === 'TD') cell.dataset.label = labels[index];
			});
		});
	};
	root.querySelectorAll('.table-container tbody').forEach(applyLabels);
	const observer = new MutationObserver((mutations) => {
		const changedBodies = new Set(mutations
			.map((mutation) => mutation.target)
			.filter((target) => target instanceof HTMLTableSectionElement && target.matches('.table-container tbody')));
		changedBodies.forEach(applyLabels);
	});
	observer.observe(root, { childList: true, subtree: true });
	return observer;
};
