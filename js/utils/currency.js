// Preserve the current R prefix and browser-locale number formatting.
const formatCurrency = (value) => `R${Number(value).toLocaleString()}`;

// Existing page formatter: retain its fallback for missing or falsy amounts.
const money = (value) => formatCurrency(value || 0);

// Axis label formatting using the same convention as every other money figure in the app
// (Number.toLocaleString(), no K/M abbreviation) so a y-axis reads "0 / 500 / 1 000 / 1 500"
// consistently with the rest of BusinessBoss.
const formatAxisValue = (value) => Math.round(value).toLocaleString();

export { formatCurrency, money, formatAxisValue };
