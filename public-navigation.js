const menuButton = document.querySelector('.nav-menu-toggle');
const navigationPanel = document.querySelector('#public-navigation-panel');
const mobileNavigation = window.matchMedia('(max-width: 620px)');

if (menuButton && navigationPanel) {
	const setOpen = (isOpen, restoreFocus = false) => {
		navigationPanel.classList.toggle('is-open', isOpen);
		menuButton.setAttribute('aria-expanded', String(isOpen));
		menuButton.setAttribute('aria-label', isOpen ? 'Close site navigation' : 'Open site navigation');
		if (restoreFocus) menuButton.focus();
	};

	menuButton.addEventListener('click', () => {
		if (!mobileNavigation.matches) return;
		setOpen(menuButton.getAttribute('aria-expanded') !== 'true');
	});

	navigationPanel.addEventListener('click', (event) => {
		if (mobileNavigation.matches && event.target instanceof HTMLAnchorElement) setOpen(false);
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') setOpen(false, true);
	});

	mobileNavigation.addEventListener('change', () => setOpen(false));
	setOpen(false);
}
