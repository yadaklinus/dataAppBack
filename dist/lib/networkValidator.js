"use strict";
/**
 * Nigerian Network Prefix Validator
 * Logic: Normalizes phone numbers and verifies they match the selected provider.
 */
const NETWORK_PREFIXES = {
    MTN: ['0703', '0704', '0706', '0803', '0806', '0810', '0813', '0814', '0816', '0903', '0906', '0913', '0916', '07025', '07026', '0707'],
    AIRTEL: ['0701', '0708', '0802', '0808', '0812', '0901', '0902', '0904', '0907', '0911', '0912'],
    GLO: ['0705', '0805', '0807', '0811', '0815', '0905', '0915'],
    "9MOBILE": ['0809', '0817', '0818', '0908', '0909']
};
/**
 * Normalizes a number to the 11-digit 080... format
 */
const normalizePhoneNumber = (phone) => {
    let cleaned = phone.replace(/\D/g, ''); // Remove non-digits
    if (cleaned.startsWith('234') && cleaned.length === 13) {
        cleaned = '0' + cleaned.slice(3);
    }
    else if (cleaned.length === 10) {
        cleaned = '0' + cleaned;
    }
    return cleaned;
};
/**
 * Validates if a phone number matches the selected network
 * @returns {boolean}
 */
const validateNetworkMatch = (network, phone) => {
    const normalized = normalizePhoneNumber(phone);
    const networkKey = network.toUpperCase();
    const prefixes = NETWORK_PREFIXES[networkKey];
    if (!prefixes)
        return true; // Fallback if network is unknown
    // Check for 5-digit prefixes (MTN Visafone) first, then 4-digit
    return prefixes.some(prefix => normalized.startsWith(prefix));
};
module.exports = { validateNetworkMatch, normalizePhoneNumber };
