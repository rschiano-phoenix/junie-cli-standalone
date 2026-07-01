function maskSecret(value, visibleChars = 4) {
    if (!value) return '<missing>';
    const stringValue = String(value);
    if (stringValue.length <= visibleChars) return '*'.repeat(stringValue.length);
    return `${stringValue.slice(0, visibleChars)}...${'*'.repeat(Math.min(4, stringValue.length - visibleChars))}`;
}

function sanitizeName(value, fallback = 'unknown') {
    const sanitized = String(value || fallback)
        .replace(/[^a-z0-9_-]/gi, '_')
        .replace(/_+/g, '_')
        .toLowerCase();

    return sanitized || fallback;
}

function parseCurrency(value) {
    if (!value) return 0;
    const normalized = String(value).replace(',', '.').replace(/[^\d.]/g, '');
    return Number.parseFloat(normalized) || 0;
}

function parseInteger(value) {
    if (!value) return 0;
    const normalized = String(value).replace(/[^\d]/g, '');
    return Number.parseInt(normalized, 10) || 0;
}

module.exports = {
    maskSecret,
    parseCurrency,
    parseInteger,
    sanitizeName,
};