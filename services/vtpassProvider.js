const axios = require('@/lib/providerClient');
const crypto = require('crypto');

/**
 * VTPass API Integration Service
 * Documentation: https://www.vtpass.com/documentation/
 */

const getBaseUrl = () => {
    const ENV = process.env.NODE_ENV === 'production' ? 'live' : 'sandbox';
    return ENV === 'live' ? 'https://vtpass.com/api' : 'https://sandbox.vtpass.com/api';
};

/**
 * Generate standard headers for POST requests per VTPass docs.
 */
const getPostHeaders = () => {
    return {
        'api-key': process.env.VTPASS_API_KEY,
        'secret-key': process.env.VTPASS_SECRET_KEY,
        'Content-Type': 'application/json'
    };
};

/**
 * Generate standard headers for GET requests per VTPass docs.
 */
const getGetHeaders = () => {
    return {
        'api-key': process.env.VTPASS_API_KEY,
        'public-key': process.env.VTPASS_PUBLIC_KEY,
        'Content-Type': 'application/json'
    };
};

/**
 * Handle VTPass Purchase Response
 * Returns an object with isPending flag if transaction is processing.
 */
const handlePurchaseResponse = (data, requestId, defaultErrorMsg) => {
    if (data.code === "000" || data.code === "099") {
        const txStatus = data.content?.transactions?.status || (data.code === "099" ? 'pending' : 'delivered');
        const isPending = data.code === "099" || txStatus === 'initiated' || txStatus === 'pending';

        return {
            success: !isPending,
            isPending,
            orderId: data.content?.transactions?.transactionId || requestId,
            status: txStatus,
            token: data.token || data.purchased_code || data.metertoken || null,
            provider: 'VTPASS'
        };
    }
    throw new Error(data.response_description || defaultErrorMsg);
};

/**
 * Map standard network names to VTPass Service IDs
 */
const AIRTIME_SERVICE_IDS = {
    'MTN': 'mtn',
    'GLO': 'glo',
    '9MOBILE': 'etisalat',
    'AIRTEL': 'airtel'
};

const DATA_SERVICE_IDS = {
    'MTN': 'mtn-data',
    'GLO': 'glo-sme-data',
    '9MOBILE': 'etisalat-data',
    'AIRTEL': 'airtel-data'
};

const CABLE_SERVICE_IDS = {
    'DSTV': 'dstv',
    'GOTV': 'gotv',
    'STARTIMES': 'startimes',
    'SHOWMAX': 'showmax'
};

const ELECTRICITY_SERVICE_IDS = {
    // ClubKonnect & Nellobyte Numeric IDs mapped to VTPass Service IDs
    '01': 'eko-electric',
    '02': 'ikeja-electric',
    '03': 'abuja-electric',
    '04': 'kano-electric',
    '05': 'portharcourt-electric',
    '06': 'jos-electric',
    '07': 'ibadan-electric',
    '08': 'kaduna-electric',
    '09': 'enugu-electric',
    '10': 'benin-electric',
    '11': 'yola-electric',
    '12': 'aba-electric',

    // Fallbacks just in case string abbreviations are passed
    'IKEDC': 'ikeja-electric',
    'EKEDC': 'eko-electric',
    'KEDCO': 'kano-electric',
    'PHED': 'portharcourt-electric',
    'JED': 'jos-electric',
    'IBEDC': 'ibadan-electric',
    'KAEDCO': 'kaduna-electric',
    'AEDC': 'abuja-electric',
    'EEDC': 'enugu-electric',
    'BEDC': 'benin-electric',
    'ABA': 'aba-electric',
    'YEDC': 'yola-electric'
};

/**
 * ==========================================
 * AIRTIME
 * ==========================================
 */
const buyAirtime = async (network, amount, phoneNumber, requestId) => {
    try {
        const serviceID = AIRTIME_SERVICE_IDS[network.toUpperCase()];
        if (!serviceID) throw new Error("Invalid network selection for VTPass");

        const response = await axios.post(`${getBaseUrl()}/pay`, {
            request_id: requestId,
            serviceID: serviceID,
            amount: amount,
            phone: phoneNumber
        }, {
            headers: getPostHeaders()
        });

        console.log("VTPass Airtime Response:", response.data);

        const data = response.data;
        return handlePurchaseResponse(data, requestId, "Airtime purchase failed on VTPass");
    } catch (error) {
        console.error("VTPass Airtime Error:", error.response?.data || error.message);
        throw error;
    }
};

/**
 * ==========================================
 * DATA
 * ==========================================
 */

/**
 * Utility: Calculate your 10% marked-up price (same as dataProvider.js)
 */
const calculateMyPrice = (providerAmount) => {
    const amount = parseFloat(providerAmount);
    if (isNaN(amount)) return 0;
    const markup = amount * 0.10;
    return Math.ceil(amount + markup);
};

const fetchDataPlans = async (network) => {
    try {
        const serviceID = DATA_SERVICE_IDS[network.toUpperCase()];
        if (!serviceID) throw new Error("Invalid network selection for VTPass");

        const response = await axios.get(`${getBaseUrl()}/service-variations`, {
            params: { serviceID: serviceID },
            headers: getGetHeaders()
        });

        if (response.data.content && response.data.content.varations) {
            // Apply markup similar to Nellobyte flow
            const plans = response.data.content.varations.map(plan => ({
                ...plan,
                SELLING_PRICE: calculateMyPrice(plan.variation_amount)
            }));
            return plans;
        }

        return [];
    } catch (error) {
        console.error("VTPass Fetch Data Plans Error:", error.response?.data || error.message);
        throw error; // Let controller handle it
    }
}

/**
 * Fetch all available plans for all networks and map to ClubKonnect layout
 */
const fetchAllDataPlansMapped = async () => {
    const networks = [
        { key: 'MTN', name: 'MTN', id: '01' },
        { key: 'GLO', name: 'Glo', id: '02' },
        { key: '9MOBILE', name: 'm_9mobile', id: '03' },
        { key: 'AIRTEL', name: 'Airtel', id: '04' }
    ];

    const results = await Promise.all(
        networks.map(async (net) => {
            try {
                const plans = await fetchDataPlans(net.key);
                const products = plans.map((plan, index) => ({
                    PRODUCT_SNO: String(index + 1),
                    PRODUCT_CODE: plan.variation_code,
                    PRODUCT_ID: plan.variation_code,
                    PRODUCT_NAME: plan.name,
                    PRODUCT_AMOUNT: plan.variation_amount,
                    SELLING_PRICE: plan.SELLING_PRICE
                }));
                return {
                    networkKey: net.name,
                    data: [
                        {
                            ID: net.id,
                            PRODUCT: products
                        }
                    ]
                };
            } catch (err) {
                return {
                    networkKey: net.name,
                    data: [
                        {
                            ID: net.id,
                            PRODUCT: []
                        }
                    ]
                };
            }
        })
    );

    const mobileNetwork = {};
    for (const res of results) {
        mobileNetwork[res.networkKey] = res.data;
    }

    return {
        status: "OK",
        data: {
            MOBILE_NETWORK: mobileNetwork
        }
    };
};

/**
 * Purchase Data
 * VTPass requires variation_code and ignores 'amount' for data bundles.
 * 'amount' is still required in the payload but ignored by VTPass for variation-based services.
 */
const buyData = async (network, variationCode, phoneNumber, requestId) => {
    try {
        const serviceID = DATA_SERVICE_IDS[network.toUpperCase()];
        if (!serviceID) throw new Error("Invalid network selection for VTPass");

        const response = await axios.post(`${getBaseUrl()}/pay`, {
            request_id: requestId,
            serviceID: serviceID,
            billersCode: phoneNumber, // For data, phone goes in billersCode
            variation_code: variationCode,
            amount: 100, // Amount is ignored for data subscriptions, but required by API schema
            phone: phoneNumber
        }, {
            headers: getPostHeaders()
        });

        const data = response.data;
        console.log("VTPass Data Response:", data);
        return handlePurchaseResponse(data, requestId, "Data purchase failed on VTPass");
    } catch (error) {
        console.error("VTPass Data Error:", error.response?.data || error.message);
        throw error;
    }
};


/**
 * ==========================================
 * CABLE TV
 * ==========================================
 */

/**
 * Fetch all available packages
 */
const fetchCablePackages = async (cableTV) => {
    try {
        const serviceID = CABLE_SERVICE_IDS[cableTV.toUpperCase()];
        if (!serviceID) throw new Error("Invalid cable provider for VTPass");

        const response = await axios.get(`${getBaseUrl()}/service-variations`, {
            params: { serviceID: serviceID },
            headers: getGetHeaders()
        });

        if (response.data.content && response.data.content.varations) {
            return response.data.content.varations;
        }

        return [];
    } catch (error) {
        console.error("VTPass Fetch Cable Packages Error:", error.response?.data || error.message);
        throw error;
    }
};

/**
 * Fetch all available cable packages mapped to standard format
 */
const fetchAllCablePackagesMapped = async () => {
    const cables = [
        { key: 'DSTV', name: 'DStv', id: 'dstv' },
        { key: 'GOTV', name: 'GOtv', id: 'gotv' },
        { key: 'STARTIMES', name: 'Startimes', id: 'startimes' },
        { key: 'SHOWMAX', name: 'Showmax', id: 'showmax' }
    ];

    const results = await Promise.all(
        cables.map(async (cable) => {
            try {
                const packages = await fetchCablePackages(cable.key);
                const products = packages.map((pkg) => ({
                    PACKAGE_ID: pkg.variation_code,
                    PACKAGE_NAME: pkg.name,
                    PACKAGE_AMOUNT: pkg.variation_amount
                }));
                return {
                    cableKey: cable.name,
                    data: [
                        {
                            ID: cable.id,
                            PRODUCT: products
                        }
                    ]
                };
            } catch (err) {
                return {
                    cableKey: cable.name,
                    data: [
                        {
                            ID: cable.id,
                            PRODUCT: []
                        }
                    ]
                };
            }
        })
    );

    const cableData = {};
    for (const res of results) {
        cableData[res.cableKey] = res.data;
    }

    return {
        status: "OK",
        data: cableData
    };
};

/**
 * Verify SmartCard / IUC Number
 */
const verifySmartCard = async (cableTV, smartCardNo) => {
    try {
        const serviceID = CABLE_SERVICE_IDS[cableTV.toUpperCase()];
        if (!serviceID) throw new Error("Invalid cable provider for VTPass");

        const response = await axios.post(`${getBaseUrl()}/merchant-verify`, {
            serviceID: serviceID,
            billersCode: smartCardNo
        }, {
            headers: getPostHeaders()
        });

        console.log("VTPass Verify SmartCard Response:", response.data);

        const data = response.data;
        if (data.code === "000" && data.content && data.content.Customer_Name !== "INVALID") {
            // Mapping VTPass response format to our system's expected format (from Nellobyte)
            return {
                customer_name: data.content.Customer_Name,
                Current_Bouquet: data.content.Current_Bouquet,
                Renewal_Amount: data.content.Renewal_Amount,
                Status: data.content.Status
            };
        }

        throw new Error("Invalid smartcard number or mismatching provider.");
    } catch (error) {
        throw new Error(error.message || "SmartCard verification failed on VTPass");
    }
};

/**
 * Purchase Cable TV Subscription
 * `packageCode` is the `variation_code` from the packages.
 */
const buyCableTV = async (cableTV, packageCode, smartCardNo, phoneNo, amount, requestId) => {
    try {
        const serviceID = CABLE_SERVICE_IDS[cableTV.toUpperCase()];
        if (!serviceID) throw new Error("Invalid cable provider for VTPass");

        const response = await axios.post(`${getBaseUrl()}/pay`, {
            request_id: requestId,
            serviceID: serviceID,
            billersCode: smartCardNo,
            variation_code: packageCode,
            amount: amount, // Required if doing a bouquet change/renewal specifying exact amount, or ignored if fixed price variation
            phone: phoneNo
        }, {
            headers: getPostHeaders()
        });

        const data = response.data;
        console.log("VTPass Cable Response:", data);
        return handlePurchaseResponse(data, requestId, "Cable TV subscription failed on VTPass");
    } catch (error) {
        console.error("VTPass Cable Error:", error.response?.data || error.message);
        throw error;
    }
};

/**
 * ==========================================
 * ELECTRICITY
 * ==========================================
 */
const verifyMeter = async (discoCode, meterNo, meterType) => {
    try {
        const serviceID = ELECTRICITY_SERVICE_IDS[discoCode.toUpperCase()];
        if (!serviceID) throw new Error("Invalid electricity provider for VTPass");

        const typeStr = meterType.toLowerCase(); // 'prepaid' or 'postpaid'

        const response = await axios.post(`${getBaseUrl()}/merchant-verify`, {
            serviceID: serviceID,
            billersCode: meterNo,
            type: typeStr
        }, {
            headers: getPostHeaders()
        });

        const data = response.data;

        console.log("VTPass Verify Meter Response:", response.data);

        if (data.code === "000" && data.content) {
            return {
                customer_name: data.content.Customer_Name,
                Address: data.content.Address,
                Meter_Number: data.content.Meter_Number
            };
        }

        throw new Error("Invalid meter number. Please check the number and try again.");
    } catch (error) {
        throw new Error(error.message || "Meter verification failed on VTPass");
    }
};

const payElectricityBill = async (discoCode, meterType, meterNo, amount, phoneNo, requestId) => {
    try {
        const serviceID = ELECTRICITY_SERVICE_IDS[discoCode.toUpperCase()];
        if (!serviceID) throw new Error("Invalid electricity provider for VTPass");

        const typeStr = meterType.toLowerCase();

        const response = await axios.post(`${getBaseUrl()}/pay`, {
            request_id: requestId,
            serviceID: serviceID,
            billersCode: meterNo,
            variation_code: typeStr, // VTPass expects 'prepaid' or 'postpaid' as variation_code for electricity
            amount: amount,
            phone: phoneNo
        }, {
            headers: getPostHeaders()
        });

        const data = response.data;
        console.log(data)
        return handlePurchaseResponse(data, requestId, "Electricity payment failed on VTPass");
    } catch (error) {
        console.error("VTPass Electricity Error:", error.response?.data || error.message);
        throw error;
    }
};


const CLUB_KONNECT_DISCOS = [
    { "id": "01", "name": "Eko Electric - EKEDC (PHCN)", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "02", "name": "Ikeja Electric - IKEDC (PHCN)", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "03", "name": "Abuja Electric - AEDC", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "04", "name": "Kano Electric - KEDC", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "05", "name": "Portharcourt Electric - PHEDC", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "06", "name": "Jos Electric - JEDC", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "07", "name": "Ibadan Electric - IBEDC", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "08", "name": "Kaduna Electric - KAEDC", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "09", "name": "ENUGU Electric - EEDC", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "10", "name": "BENIN Electric - BEDC", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "11", "name": "YOLA Electric - YEDC", "minAmount": 1000, "maxAmount": 200000 },
    { "id": "12", "name": "ABA Electric - APLE", "minAmount": 1000, "maxAmount": 200000 }
];

const fetchElectricityDiscos = async () => {
    return CLUB_KONNECT_DISCOS;
};

/**
 * ==========================================
 * COMMON: QUERY STATUS
 * ==========================================
 */
const queryTransaction = async (requestId) => {
    try {
        const response = await axios.post(`${getBaseUrl()}/requery`, {
            request_id: requestId
        }, {
            headers: getPostHeaders(),
            timeout: 15000
        });

        const data = response.data;
        let unifiedStatus = 'FAILED';

        if (data.code === "000") {
            const txStatus = data.content?.transactions?.status;
            if (txStatus === 'delivered') unifiedStatus = 'SUCCESS';
            else if (txStatus === 'pending' || txStatus === 'initiated') unifiedStatus = 'PENDING';
        } else if (data.code === "099") {
            unifiedStatus = 'PENDING';
        }

        return {
            status: unifiedStatus,
            original: data
        };
    } catch (error) {
        console.error(`[VTPass] queryTransaction Error for Ref ${requestId}:`, error.message);
        throw new Error("Transaction query failed on VTPass");
    }
};

module.exports = {
    buyAirtime,
    buyData,
    fetchDataPlans,
    fetchAllDataPlansMapped,
    fetchCablePackages,
    fetchAllCablePackagesMapped,
    verifySmartCard,
    buyCableTV,
    verifyMeter,
    payElectricityBill,
    fetchElectricityDiscos,
    queryTransaction,
    calculateMyPrice
};
