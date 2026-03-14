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

/**
 * Resilient Refund Helper
 * Retries the refund transaction up to 3 times with exponential backoff.
 */
const safeRefund = async (prisma, userId, amount, transactionId) => {
    let attempts = 0;
    const maxAttempts = 3;
    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    while (attempts < maxAttempts) {
        try {
            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: transactionId },
                    data: { status: 'FAILED' }
                }),
                prisma.wallet.update({
                    where: { userId },
                    data: {
                        balance: { increment: amount },
                        totalSpent: { decrement: amount }
                    }
                })
            ], {
                maxWait: 10000,
                timeout: 15000
            });

            console.log(`[Financial Safety] Refund OK Tx: ${transactionId} (attempt ${attempts + 1})`);
            return true;
        } catch (error) {
            attempts++;
            console.error(`[Financial Safety] Refund attempt ${attempts} failed for Tx: ${transactionId}:`, error.message);
            if (attempts < maxAttempts) {
                await delay(1000 * attempts); // Linear backoff: 1s, 2s
            }
        }
    }
    console.error(`[Financial Safety] CRITICAL: Refund failed after ${maxAttempts} attempts for Tx: ${transactionId}. Manual intervention may be required.`);
    return false;
};

module.exports = { isNetworkError, safeRefund };
