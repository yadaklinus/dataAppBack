/**
 * Global Payment Utilities
 * Centralized logic for fee calculations and wallet credits.
 */

/**
 * Calculate the principal amount to credit to a user's wallet 
 * based on the total amount received from the payment gateway.
 * 
 * Logic: ₦40 / 2% / ₦2000 fee structure.
 * 
 * @param {number|string} totalReceived - The total amount paid by the customer.
 * @returns {number} The net amount to credit to the wallet.
 */
const getWalletCreditAmount = (totalReceived) => {
    const total = Number(totalReceived);

    // Safety check for very small amounts to avoid negative balances
    if (total <= 40) return 0;

    if (total <= 2540) {
        // Tier 1: Small amounts (Principal <= ₦2,500)
        // Customer pays Principal + ₦40. We credit Principal.
        return total - 40;
    } else if (total > 102000) {
        // Tier 3: Large amounts (Principal > ₦100,000)
        // Cap fee at ₦2,000.
        return total - 2000;
    } else {
        // Tier 2: Mid-range (2% Fee)
        // Total = Principal / 0.98. Credit = Total * 0.98.
        return Math.floor(total * 0.98);
    }
};

module.exports = {
    getWalletCreditAmount
};
