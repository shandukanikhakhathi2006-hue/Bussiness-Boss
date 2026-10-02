const sidebar = document.querySelector('#sidebar');
const menuButton = document.querySelector('#menuButton');

if (sidebar && menuButton) {
	const expandButton = sidebar.querySelector('.sidebar-expand-button');
	const mobileViewport = window.matchMedia('(max-width: 700px)');
	const backdrop = document.createElement('button');
	backdrop.type = 'button';
	backdrop.className = 'sidebar-backdrop';
	backdrop.tabIndex = -1;
	backdrop.setAttribute('aria-label', 'Close navigation');
	document.body.append(backdrop);

	const syncNavigationControls = () => {
		const mobileOpen = mobileViewport.matches && sidebar.classList.contains('open');
		const desktopExpanded = !mobileViewport.matches && !document.body.classList.contains('sidebar-collapsed');
		const navigationExpanded = mobileViewport.matches ? mobileOpen : desktopExpanded;
		menuButton.setAttribute('aria-expanded', String(navigationExpanded));
		menuButton.setAttribute('aria-label', mobileViewport.matches
			? (mobileOpen ? 'Close navigation' : 'Open navigation')
			: (desktopExpanded ? 'Collapse navigation' : 'Expand navigation'));
		expandButton?.setAttribute('aria-expanded', String(navigationExpanded));
	};

	const closeMobileSidebar = () => {
		if (!sidebar.classList.contains('open')) return;
		sidebar.classList.remove('open');
		syncNavigationControls();
		menuButton.focus();
	};

	backdrop.addEventListener('click', closeMobileSidebar);
	menuButton.addEventListener('click', () => {
		if (mobileViewport.matches) {
			sidebar.classList.toggle('open');
		} else {
			sidebar.classList.remove('open');
			document.body.classList.toggle('sidebar-collapsed');
		}
		syncNavigationControls();
	});
	expandButton?.addEventListener('click', () => {
		if (mobileViewport.matches) return;
		document.body.classList.remove('sidebar-collapsed');
		syncNavigationControls();
	});
	mobileViewport.addEventListener('change', () => {
		sidebar.classList.remove('open');
		document.body.classList.remove('sidebar-collapsed');
		syncNavigationControls();
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && mobileViewport.matches) closeMobileSidebar();
	});
	syncNavigationControls();
}
