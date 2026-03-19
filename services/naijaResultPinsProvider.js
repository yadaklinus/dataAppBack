const axios = require('axios');

/**
 * NaijaResultPins API Provider
 * Documentation: Provided by User
 */

const getBaseUrl = () => {
    return process.env.NAIJA_RESULT_PINS_BASE_URL || 'https://sandbox.naijaresultpins.com/api/v1';
};

const getHeaders = () => {
    return {
        'Authorization': `Bearer ${process.env.NAIJA_RESULT_PINS_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
};

/**
 * Purchase Examination Card
 * @param {string} cardTypeId - The ID of the card type (1=WAEC, etc.)
 * @param {number} quantity - Number of cards (User specified 1 per user)
 */
const buyExamCard = async (cardTypeId, quantity = 1) => {
    try {
        const response = await axios.post(`${getBaseUrl()}/exam-card/buy`, {
            card_type_id: String(cardTypeId),
            quantity: String(quantity)
        }, {
            headers: getHeaders()
        });

        const data = response.data;

        if (data.status === true && data.code === "000") {
            // Success
            // Expected cards: [{ pin: "...", serial_no: "..." }]
            const cards = data.cards || [];
            let cardDetails = null;
            if (cards.length > 0) {
                cardDetails = `Serial: ${cards[0].serial_no} | PIN: ${cards[0].pin}`;
            }

            return {
                success: true,
                isPending: false,
                orderId: data.reference,
                status: 'delivered',
                cardDetails: cardDetails,
                provider: 'NAIJA_RESULT_PINS',
                raw: data
            };
        }

        // Handle specific error codes if needed, or just throw the message
        throw new Error(data.message || "Transaction failed on NaijaResultPins");
    } catch (error) {
        console.error("NaijaResultPins Purchase Error:", error.response?.data || error.message);
        
        // Extract message from response if available
        const errorMsg = error.response?.data?.message || error.message;
        throw new Error(errorMsg);
    }
};

module.exports = {
    buyExamCard
};
