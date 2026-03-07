/**
 * Normalizes provider date strings (e.g., "02-FEB-25" or ISO strings) 
 * into a clean "DD-MM-YYYY" format.
 */
function normalizeProviderDate(dateStr) {
    if (!dateStr) return null;

    let date;

    // 1. Handle "DD-MMM-YY" format (e.g., "02-FEB-25")
    const ddmmyyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/;
    const match = String(dateStr).match(ddmmyyRegex);

    if (match) {
        const day = parseInt(match[1]);
        const monthStr = match[2].toUpperCase();
        let year = parseInt(match[3]);

        const monthMap = {
            'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
            'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
        };

        const month = monthMap[monthStr];

        if (month !== undefined) {
            // Adjust 2-digit year to 4-digit
            if (year < 100) {
                year += 2000;
            }
            date = new Date(year, month, day);
        }
    }

    // 2. Fallback to standard JS parsing (Handles ISO strings like "2025-02-06T00:00:00")
    if (!date || isNaN(date.getTime())) {
        date = new Date(dateStr);
    }

    // 3. If still invalid, return the original string
    if (!date || isNaN(date.getTime())) {
        return dateStr;
    }

    // 4. Format as "DD-MM-YYYY"
    const finalDay = String(date.getDate()).padStart(2, '0');
    const finalMonth = String(date.getMonth() + 1).padStart(2, '0');
    const finalYear = date.getFullYear();

    return `${finalDay}-${finalMonth}-${finalYear}`;
}

module.exports = { normalizeProviderDate };
