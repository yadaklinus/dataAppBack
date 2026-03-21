const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');

/**
 * Utility to extract validity from product name
 */
const extractValidity = (name) => {
    const patterns = [
        { regex: /\((\d+)\s*Days?\)/i, format: (m) => `${m[1]} Day${m[1] == '1' ? '' : 's'}` },
        { regex: /-(\s*)(\d+)\s*days/i, format: (m) => `${m[2]} Days` },
        { regex: /Daily/i, format: () => '1 Day' },
        { regex: /Weekly/i, format: () => '7 Days' },
        { regex: /Monthly/i, format: () => '30 Days' },
        { regex: /Yearly/i, format: () => '1 Year' },
        { regex: /24hrs/i, format: () => '1 Day' },
    ];

    for (const p of patterns) {
        const match = name.match(p.regex);
        if (match) return p.format(match);
    }

    // Fallback search for standalone "30 days", "7 days" etc.
    const fallbackMatch = name.match(/(\d+)\s*(days|day)/i);
    if (fallbackMatch) return `${fallbackMatch[1]} ${fallbackMatch[2].charAt(0).toUpperCase() + fallbackMatch[2].slice(1).toLowerCase()}${fallbackMatch[2].toLowerCase().endsWith('s') ? '' : ''}`;

    // Handle Month patterns
    const monthMatch = name.match(/(\d+)\s*Month(s)?/i);
    if (monthMatch) return `${monthMatch[1] === '1' ? '30 Days' : `${monthMatch[1]} Months`}`;

    return "Monthly"; // Default for these providers usually
};

/**
 * Utility to determine plan type from product name
 */
const determinePlanType = (name) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('sme')) return 'SME';
    if (lowerName.includes('gifting')) return 'Gifting';
    if (lowerName.includes('corporate')) return 'Corporate';
    if (lowerName.includes('binge')) return 'Binge';
    if (lowerName.includes('broadband') || lowerName.includes('hynet')) return 'Broadband';
    if (lowerName.includes('daily')) return 'Daily';
    if (lowerName.includes('weekly')) return 'Weekly';
    return 'Gifting'; // Default
};

/**
 * Utility to clean display name and replace price
 */
const cleanDisplayName = (name, sellingPrice, validity) => {
    let clean = name;

    // 1. Remove "Best Value", "Plan", specific price patterns, trailing dashes, parentheses
    clean = clean.replace(/\(Best Value\)/gi, '')
                  .replace(/Plan/gi, '')
                  .replace(/Daily/gi, '')
                  .replace(/Weekly/gi, '')
                  .replace(/Monthly/gi, '')
                  .replace(/Yearly/gi, '')
                  // Matches "1Day", "1 Day", "1Days", "1 Days" etc.
                  .replace(/(- )?\d+\s*Day(s)?/gi, '')
                  .replace(/(- )?N?[\d,.]+\s*Naira/gi, '') // Matches "99 Naira", "- 99 Naira", "N99 Naira"
                  .replace(/(- )?N[\d,.]+/gi, '')        // Matches "N99", "- N99"
                  .replace(/\([\d]+\s*Days?\)/gi, '')
                  .replace(/\([\d]+\s*Day\)/gi, '')
                  .replace(/- [\d]+\s*days/gi, '')
                  .replace(/\(\s*\)/g, '') // New: Remove empty or whitespace-only parentheses
                  .replace(/\s+/g, ' ')
                  .trim();

    // 2. Remove network prefix if still present at the start (e.g. "MTN ")
    clean = clean.replace(/^(MTN|GLO|AIRTEL|9MOBILE)(\s+|$)/gi, '');
    
    // 3. Construct final name
    let result = clean.trim();
    if (validity) {
        result = `${result} - ${validity}`;
    }
    if (sellingPrice) {
        result = `${result} - ₦${sellingPrice}`;
    }
    
    // Final cleanup: remove potential empty core names OR trailing/duplicated markers
    return result.trim().replace(/^-\s+/, '').replace(/\s+-\s+-/g, ' -').replace(/-\s+$/, '');
};

/**
 * Sync Data Plans from Provider
 * @route POST /api/v1/admin/data-plans/sync
 */
const syncDataPlans = async (req, res) => {
    try {
        const providerData = await vtpassProvider.fetchAllDataPlansMapped();
        if (providerData.status !== "OK") {
            throw new Error("Failed to fetch plans from provider");
        }

        const networks = providerData.data.MOBILE_NETWORK;
        let syncedCount = 0;

        for (const [networkName, networkWrappers] of Object.entries(networks)) {
            for (const wrapper of networkWrappers) {
                const externalNetworkId = wrapper.ID; // e.g., "01"
                
                // 1. Ensure Network exists
                const network = await prisma.networkPlan.upsert({
                    where: { externalId: externalNetworkId },
                    update: { name: networkName },
                    create: {
                        name: networkName,
                        externalId: externalNetworkId
                    }
                });

                // 2. Sync Products
                for (const product of wrapper.PRODUCT) {
                    const costPrice = parseFloat(product.PRODUCT_AMOUNT);
                    // Default markup: 10%
                    const sellingPrice = parseFloat(product.SELLING_PRICE) || Math.ceil(costPrice * 1.1);

                    const validity = extractValidity(product.PRODUCT_NAME);
                    const planType = determinePlanType(product.PRODUCT_NAME);
                    const displayName = cleanDisplayName(product.PRODUCT_NAME, sellingPrice, validity);

                    await prisma.dataPlan.upsert({
                        where: { productId: product.PRODUCT_ID },
                        update: {
                            productCode: product.PRODUCT_CODE,
                            rawName: product.PRODUCT_NAME,
                            costPrice: costPrice,
                            userPrice: sellingPrice,
                            validity: validity,
                            planType: planType,
                            displayName: displayName,
                        },
                        create: {
                            networkId: network.id,
                            productId: product.PRODUCT_ID,
                            productCode: product.PRODUCT_CODE,
                            rawName: product.PRODUCT_NAME,
                            costPrice: costPrice,
                            userPrice: sellingPrice,
                            validity: validity,
                            planType: planType,
                            displayName: displayName,
                            isActive: true
                        }
                    });
                    syncedCount++;
                }
            }
        }

        res.status(200).json({
            status: "OK",
            message: `Successfully synced ${syncedCount} data plans across ${Object.keys(networks).length} networks.`,
        });
    } catch (error) {
        console.error("Sync Data Plans Error:", error);
        res.status(500).json({ status: "ERROR", message: error.message || "Failed to sync data plans" });
    }
};

/**
 * Get All Data Plans (Admin)
 * @route GET /api/v1/admin/data-plans
 */
const getAllDataPlans = async (req, res) => {
    try {
        const plans = await prisma.dataPlan.findMany({
            include: { network: true },
            orderBy: [
                { networkId: 'asc' },
                { sortOrder: 'asc' },
                { costPrice: 'asc' }
            ]
        });

        // Serialize Decimals for JSON
        const data = plans.map(p => ({
            ...p,
            costPrice: Number(p.costPrice),
            userPrice: Number(p.userPrice),
        }));

        res.status(200).json({ status: "OK", data });
    } catch (error) {
        console.error("Get All Data Plans Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch data plans: " + error.message });
    }
};

/**
 * Update Data Plan (Admin)
 * @route PATCH /api/v1/admin/data-plans/:id
 */
const updateDataPlan = async (req, res) => {
    const { id } = req.params;
    const { displayName, userPrice, isActive, isBestValue, planType, validity } = req.body;

    try {
        const updated = await prisma.dataPlan.update({
            where: { id },
            data: {
                displayName,
                userPrice,
                isActive,
                isBestValue,
                planType,
                validity
            }
        });

        // Serialize Decimals for JSON
        const data = {
            ...updated,
            costPrice: Number(updated.costPrice),
            userPrice: Number(updated.userPrice)
        };

        res.status(200).json({ status: "OK", data });
    } catch (error) {
        res.status(500).json({ status: "ERROR", message: "Failed to update data plan" });
    }
};

/**
 * Update Data Plan Order (Admin)
 * @route PATCH /api/v1/admin/data-plans/reorder
 */
const reorderDataPlans = async (req, res) => {
    const { orders } = req.body; // Array of { id, sortOrder }

    try {
        await prisma.$transaction(
            orders.map((o) =>
                prisma.dataPlan.update({
                    where: { id: o.id },
                    data: { sortOrder: o.sortOrder },
                })
            )
        );
        res.status(200).json({ status: "OK", message: "Reordered successfully" });
    } catch (error) {
        console.error("Reorder Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to reorder plans" });
    }
};

/**
 * Delete Data Plan (Admin)
 * @route DELETE /api/v1/admin/data-plans/:id
 */
const deleteDataPlan = async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.dataPlan.delete({ where: { id } });
        res.status(200).json({ status: "OK", message: "Plan deleted successfully" });
    } catch (error) {
        res.status(500).json({ status: "ERROR", message: "Failed to delete plan" });
    }
};

module.exports = {
    syncDataPlans,
    getAllDataPlans,
    updateDataPlan,
    reorderDataPlans,
    deleteDataPlan
};
