"use strict";
/**
 * Financial Safety Utilities
 */
/**
 * Detects if an error is a network timeout or connection error.
 * These errors should NOT trigger an auto-refund because the transaction
 * might have actually succeeded at the provider.
 */
const isNetworkError = (error) => {
    // Axios Error Codes
    const timeoutCodes = ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK', 'ECONNRESET', 'ENOTFOUND'];
    if (error.code && timeoutCodes.includes(error.code)) {
        return true;
    }
    // Message-based detection for cases where code might be missing
    const message = error.message?.toLowerCase() || '';
    if (message.includes('timeout') || message.includes('network error') || message.includes('econnrefused')) {
        return true;
    }
    return false;
};
module.exports = { isNetworkError };
