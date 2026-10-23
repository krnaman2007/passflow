/**
 * Formatting utilities for secondary market display
 * Converts minor currency units (paise) to INR presentation units.
 * 1 INR = 100 paise.
 */

/**
 * Converts integer minor units (paise) to decimal currency string.
 * Supports numbers, BigInts, and numeric strings.
 *
 * @param {number|string|bigint} amountInPaise
 * @param {string} [currency='₹']
 * @returns {string} Formatted currency string, e.g. "₹105.00"
 */
export function formatPaise(amountInPaise, currency = '₹') {
  if (amountInPaise == null || amountInPaise === '') {
    return `${currency}0.00`;
  }
  const num = typeof amountInPaise === 'bigint' ? Number(amountInPaise) : Number(amountInPaise);
  if (Number.isNaN(num)) {
    return `${currency}0.00`;
  }
  // Convert minor units (paise) to major units (INR)
  const major = num / 100;
  return `${currency}${major.toFixed(2)}`;
}

/**
 * Returns the numeric major currency string without currency symbol, e.g. "105.00".
 *
 * @param {number|string|bigint} amountInPaise
 * @returns {string}
 */
export function formatPaiseNumber(amountInPaise) {
  if (amountInPaise == null || amountInPaise === '') {
    return '0.00';
  }
  const num = typeof amountInPaise === 'bigint' ? Number(amountInPaise) : Number(amountInPaise);
  if (Number.isNaN(num)) {
    return '0.00';
  }
  return (num / 100).toFixed(2);
}

/**
 * Formats ISO timestamp or Date into UI time string, e.g. "12:04" or "12:04:15".
 *
 * @param {string|Date|number} timestamp
 * @param {boolean} [includeSeconds=false]
 * @returns {string}
 */
export function formatTradeTime(timestamp, includeSeconds = false) {
  if (!timestamp) return '--:--';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return String(timestamp);

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  if (includeSeconds) {
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }
  return `${hours}:${minutes}`;
}
