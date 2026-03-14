const { z } = require('zod');
const prisma = require('@/lib/prisma');
const monnifyProvider = require('@/services/monnifyProvider');
const paymentProvider = require('@/services/paymentProvider');

// Helper for generating refs
const crypto = require('crypto');
const generateFlightRef = () => `FLT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * Constants
 */
const NIGERIA_AIRPORTS = [
    { name: "Murtala Muhammed International Airport", location: "Ikeja, Lagos State", code: "LOS" },
    { name: "Nnamdi Azikiwe International Airport", location: "Abuja, FCT", code: "ABV" },
    { name: "Port Harcourt International Airport", location: "Omagwa, Rivers State", code: "PHC" },
    { name: "Mallam Aminu Kano International Airport", location: "Kano, Kano State", code: "KAN" },
    { name: "Akanu Ibiam International Airport", location: "Enugu, Enugu State", code: "ENU" },
    { name: "Kaduna International Airport", location: "Kaduna, Kaduna State", code: "KAD" },
    { name: "Margaret Ekpo International Airport", location: "Calabar, Cross River State", code: "CBQ" },
    { name: "Sadiq Abubakar III International Airport", location: "Sokoto, Sokoto State", code: "SKO" },
    { name: "Victor Attah International Airport", location: "Uyo, Akwa Ibom State", code: "QUO" },
    { name: "Asaba International Airport", location: "Asaba, Delta State", code: "ABB" },
    { name: "Maiduguri International Airport", location: "Maiduguri, Borno State", code: "MIU" },
    { name: "General Tunde Idiagbon International Airport", location: "Ilorin, Kwara State", code: "ILR" },
    { name: "Benin Airport", location: "Benin City, Edo State", code: "BNI" },
    { name: "Sam Mbakwe International Cargo Airport", location: "Owerri, Imo State", code: "QOW" },
    { name: "Yakubu Gowon Airport", location: "Jos, Plateau State", code: "JOS" },
    { name: "Ibadan Airport", location: "Ibadan, Oyo State", code: "IBA" },
    { name: "Yola Airport", location: "Yola, Adamawa State", code: "YOL" },
    { name: "Akure Airport", location: "Akure, Ondo State", code: "AKR" },
    { name: "Sir Abubakar Tafawa Balewa Airport", location: "Bauchi, Bauchi State", code: "BCU" },
    { name: "Gombe Lawanti International Airport", location: "Gombe, Gombe State", code: "GMO" },
    { name: "Katsina Airport", location: "Katsina, Katsina State", code: "DKA" },
    { name: "Makurdi Airport", location: "Makurdi, Benue State", code: "MDI" },
    { name: "Minna Airport", location: "Minna, Niger State", code: "MXJ" },
    { name: "Osubi Airport (Warri Airport)", location: "Osubi, Delta State", code: "QRW" },
    { name: "Zaria Airport", location: "Zaria, Kaduna State", code: "ZAR" },
];

/**
 * Validations
 */
const flightRequestSchema = z.object({
    origin: z.string().min(2),
    destination: z.string().min(2),
    targetDate: z.string().datetime(),
    returnDate: z.string().datetime().optional(),
    tripType: z.enum(['ONE_WAY', 'ROUND_TRIP']).default('ONE_WAY'),
    flightClass: z.string().optional(),
    adults: z.number().int().min(1).default(1),
    children: z.number().int().default(0),
    infants: z.number().int().default(0)
}).refine(data => {
    if (data.tripType === 'ROUND_TRIP' && !data.returnDate) {
        return false;
    }
    return true;
}, {
    message: "Return date is required for round trips",
    path: ["returnDate"]
}).refine(data => {
    if (data.tripType === 'ROUND_TRIP' && data.returnDate && data.targetDate) {
        return new Date(data.returnDate) > new Date(data.targetDate);
    }
    return true;
}, {
    message: "Return date must be after departure date",
    path: ["returnDate"]
});

const bookFlightSchema = z.object({
    selectedOptionId: z.string().min(1),
    passengers: z.array(z.object({
        title: z.string().min(1),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        dateOfBirth: z.string().datetime(),
        gender: z.string().min(1)
    })).min(1)
});

/**
 * 1. Submit Initial Flight Request (Phase 1)
 * @route POST /api/v1/flights/user/request
 */
const requestFlight = async (req, res) => {
    try {
        const validation = flightRequestSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ status: "ERROR", message: validation.error.issues[0].message });
        }

        const { origin, destination, targetDate, returnDate, tripType, flightClass, adults, children, infants } = validation.data;
        const userId = req.user.id;

        const target = new Date(targetDate);
        const initialStatus = 'FUTURE_HELD';

        const newRequest = await prisma.flightBookingRequest.create({
            data: {
                userId,
                origin,
                destination,
                targetDate: target,
                returnDate: returnDate ? new Date(returnDate) : null,
                tripType,
                flightClass: flightClass || 'ECONOMY',
                adults,
                children,
                infants,
                status: initialStatus
            }
        });

        await prisma.flightRequestActivity.create({
            data: {
                requestId: newRequest.id,
                userId,
                previousState: 'NONE',
                newState: initialStatus,
                actionDetails: 'User submitted initial flight request'
            }
        });

        res.status(201).json({
            status: "OK",
            message: "Flight request submitted successfully",
            data: newRequest
        });
    } catch (error) {
        console.error("Flight Request Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to submit flight request" });
    }
};

/**
 * 2. List User's Flight Requests
 * @route GET /api/v1/flights/user/requests
 */
const getUserRequests = async (req, res) => {
    try {
        const userId = req.user.id;
        const requests = await prisma.flightBookingRequest.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: { passengers: true }
        });

        const mappedRequests = requests.map(r => ({ ...r, passengerDetails: r.passengers }));

        res.status(200).json({
            status: "OK",
            data: mappedRequests
        });
    } catch (error) {
        console.error("Get User Flights Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch flight requests" });
    }
};

/**
 * 3. User "Books" a Flight Option (Provides Passengers & Starts 30m Timer)
 * @route POST /api/v1/flights/user/:id/book
 */
const bookFlight = async (req, res) => {
    try {
        const validation = bookFlightSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ status: "ERROR", message: validation.error.issues[0].message });
        }

        const { selectedOptionId, passengers } = validation.data;
        const requestId = req.params.id;
        const userId = req.user.id;

        const flightRequest = await prisma.flightBookingRequest.findFirst({
            where: { id: requestId, userId }
        });

        if (!flightRequest) {
            return res.status(404).json({ status: "ERROR", message: "Flight request not found" });
        }

        let validOption = false;
        let selectedFlightDate = null;
        const hasOptions = flightRequest.flightOptions && Array.isArray(flightRequest.flightOptions) && flightRequest.flightOptions.length > 0;

        if (hasOptions) {
            const match = flightRequest.flightOptions.find(opt => opt.id === selectedOptionId);
            if (match) {
                validOption = true;
                selectedFlightDate = match.date;
            }
        }

        if (hasOptions && !validOption) {
            return res.status(400).json({ status: "ERROR", message: "Invalid option selected from available choices." });
        }

        const totalExpected = flightRequest.adults + flightRequest.children + flightRequest.infants;
        if (passengers.length !== totalExpected) {
            return res.status(400).json({
                status: "ERROR",
                message: `Please provide details for exactly ${totalExpected} passengers.`
            });
        }

        const updatedRequest = await prisma.$transaction(async (tx) => {
            await tx.passenger.deleteMany({ where: { flightRequestId: requestId } });

            await tx.passenger.createMany({
                data: passengers.map(p => ({
                    flightRequestId: requestId,
                    title: p.title,
                    firstName: p.firstName,
                    lastName: p.lastName,
                    dateOfBirth: new Date(p.dateOfBirth),
                    gender: p.gender
                }))
            });

            const paymentExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
            const options = flightRequest.flightOptions || [];
            const selectedOption = options.find(opt => opt.id === selectedOptionId);
            if (!selectedOption) throw new Error("Selected option details not found");

            const updatePayload = {
                status: 'SELECTION_MADE',
                selectedOptionId,
                paymentExpiresAt,
                airlineName: selectedOption.airline,
                sellingPrice: selectedOption.estPrice,
                departureTime: selectedOption.departureTime || selectedOption.time,
                arrivalTime: selectedOption.arrivalTime,
                legs: selectedOption.legs
            };

            if (selectedFlightDate) {
                updatePayload.targetDate = new Date(selectedFlightDate);
            }

            const reqUpdate = await tx.flightBookingRequest.update({
                where: { id: requestId },
                data: updatePayload
            });

            await tx.flightRequestActivity.create({
                data: {
                    requestId,
                    userId,
                    previousState: flightRequest.status,
                    newState: 'SELECTION_MADE',
                    actionDetails: `User BOOKED option ${selectedOptionId}. 30-minute timer started.`
                }
            });

            return reqUpdate;
        });

        res.status(200).json({
            status: "OK",
            message: "Flight booked successfully. Please complete payment within 30 minutes.",
            data: updatedRequest
        });

    } catch (error) {
        console.error("Select Option Error:", error);
        res.status(500).json({ status: "ERROR", message: error.message || "Failed to submit selection" });
    }
};

/**
 * 4. User Pays for Flight via Wallet Balance
 * @route POST /api/v1/flights/user/:id/pay
 */
const payForFlight = async (req, res) => {
    try {
        const requestId = req.params.id;
        const userId = req.user.id;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("User not found");

        const result = await prisma.$transaction(async (tx) => {
            const flightRequest = await tx.flightBookingRequest.findUnique({
                where: { id: requestId }
            });

            if (!flightRequest || flightRequest.userId !== userId) {
                throw new Error("Flight request not found");
            }

            if (flightRequest.status !== 'SELECTION_MADE' && flightRequest.status !== 'QUOTED') {
                throw new Error(`Cannot pay. Request is in state: ${flightRequest.status}`);
            }

            // Check 30-minute window expiry
            if (flightRequest.paymentExpiresAt && new Date() > new Date(flightRequest.paymentExpiresAt)) {
                await tx.flightBookingRequest.update({
                    where: { id: requestId },
                    data: { status: 'EXPIRED' }
                });

                await tx.flightRequestActivity.create({
                    data: { requestId, previousState: flightRequest.status, newState: 'EXPIRED', actionDetails: '30-minute payment window expired' }
                });

                throw new Error("The 30-minute payment window has expired. Please book the flight again.");
            }

            if (!flightRequest.sellingPrice) {
                throw new Error("No price set for this flight");
            }

            const paymentAmount = Number(flightRequest.sellingPrice);

            const wallet = await tx.wallet.findUnique({
                where: { userId }
            });

            if (!wallet) {
                throw new Error("Wallet not found to link transaction");
            }

            if (Number(wallet.balance) < paymentAmount) {
                throw new Error(`Insufficient balance. Current: ₦${wallet.balance}, Required: ₦${paymentAmount}`);
            }

            // Deduct and log
            await tx.wallet.update({
                where: { id: wallet.id },
                data: { balance: { decrement: paymentAmount } }
            });

            const txRef = generateFlightRef();
            await tx.flightTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: 'PAYMENT',
                    amount: paymentAmount,
                    reference: txRef,
                    flightRequestId: requestId
                }
            });

            const updatedRequest = await tx.flightBookingRequest.update({
                where: { id: requestId },
                data: { status: 'PAID_PROCESSING' }
            });

            await tx.flightRequestActivity.create({
                data: {
                    requestId,
                    previousState: flightRequest.status,
                    newState: 'PAID_PROCESSING',
                    actionDetails: `Wallet payment of ₦${paymentAmount} successful. Ref: ${txRef}`
                }
            });

            return updatedRequest;
        });

        res.status(200).json({
            status: "OK",
            message: "Payment successful. Your flight is now being ticketed.",
            data: result
        });

    } catch (error) {
        console.error("Flight Wallet Payment Error:", error);
        res.status(400).json({ status: "ERROR", message: error.message || "Payment failed" });
    }
};

/**
 * 5. Get a specific flight request by ID
 * @route GET /api/v1/flights/user/requests/:id
 */
const getUserRequestById = async (req, res) => {
    try {
        const requestId = req.params.id;
        const userId = req.user.id;

        const request = await prisma.flightBookingRequest.findUnique({
            where: { id: requestId },
            include: { passengers: true }
        });

        if (!request || request.userId !== userId) {
            return res.status(404).json({ status: "ERROR", message: "Flight request not found" });
        }

        res.status(200).json({
            status: "OK",
            data: { ...request, passengerDetails: request.passengers }
        });
    } catch (error) {
        console.error("Get Flight Request Details Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch flight request details" });
    }
};

/**
 * 6. User Cancels Flight Request
 * @route POST /api/v1/flights/user/:id/cancel
 */
const cancelFlightRequest = async (req, res) => {
    try {
        const requestId = req.params.id;
        const userId = req.user.id;

        const flightRequest = await prisma.flightBookingRequest.findFirst({
            where: { id: requestId, userId }
        });

        if (!flightRequest) {
            return res.status(404).json({ status: "ERROR", message: "Flight request not found" });
        }

        if (['PAID_PROCESSING', 'TICKETED', 'CANCELLED', 'REFUNDED'].includes(flightRequest.status)) {
            return res.status(400).json({ status: "ERROR", message: `Cannot cancel a request in ${flightRequest.status} state.` });
        }

        const updatedRequest = await prisma.flightBookingRequest.update({
            where: { id: requestId },
            data: { status: 'CANCELLED' }
        });

        await prisma.flightRequestActivity.create({
            data: {
                requestId,
                userId,
                previousState: flightRequest.status,
                newState: 'CANCELLED',
                actionDetails: 'User manually cancelled the request'
            }
        });

        res.status(200).json({ status: "OK", message: "Flight request cancelled successfully", data: updatedRequest });
    } catch (error) {
        console.error("User Cancel Flight Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to cancel flight request" });
    }
};

/**
 * 7. Get List of Airports
 * @route GET /api/v1/flights/user/airports
 */
const getAirports = (req, res) => {
    res.status(200).json({ status: "OK", data: NIGERIA_AIRPORTS });
};

/**
 * 8. User gets their flight transaction history
 * @route GET /api/v1/flights/user/transactions
 */
const getUserFlightTransactions = async (req, res) => {
    try {
        const userId = req.user.id;

        const transactions = await prisma.flightTransaction.findMany({
            where: {
                wallet: { userId }
            },
            orderBy: { createdAt: 'desc' },
            include: {
                flightRequest: {
                    select: {
                        origin: true,
                        destination: true,
                        airlineName: true,
                        pnr: true,
                        status: true
                    }
                }
            }
        });

        res.status(200).json({ status: "OK", data: transactions });
    } catch (error) {
        console.error("Get User Transactions Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch transaction history" });
    }
};

module.exports = {
    requestFlight,
    getUserRequests,
    getUserRequestById,
    bookFlight,
    payForFlight,
    cancelFlightRequest,
    getAirports,
    getUserFlightTransactions
};
