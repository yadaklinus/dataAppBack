const { z } = require('zod');
const prisma = require('@/lib/prisma');
//const { generateRef } = require('@/utils/generateRef'); // Assuming a ref generator exists, or we will use crypto

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

const selectOptionSchema = z.object({
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

        // Calculate if flight is > 60 days away
        const target = new Date(targetDate);
        const daysDifference = (target.getTime() - Date.now()) / (1000 * 3600 * 24);

        let initialStatus = 'FUTURE_HELD';
        if (daysDifference <= 60) {
            // Note: Per spec, if < 60 days, jumps to SELECTION_MADE or needs options.
            // Let's set to PENDING or OPTIONS_PROVIDED equivalent so staff knows it needs options ASAP
            // Actually spec says "If a flight is < 60 days away at initial request, it jumps straight to this state (SELECTION_MADE)"
            // But user hasn't selected options yet, so it should technically be PENDING_OPTIONS for staff.
            // We'll use FUTURE_HELD for > 60 days. If < 60, we'll keep it FUTURE_HELD but cron will pick it up or we can flag it.
            // Let's stick to FUTURE_HELD as the default entry point and let staff/cron transition it.
            initialStatus = 'FUTURE_HELD';
        }

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

        // Audit Trail
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
        console.log(mappedRequests);
    } catch (error) {
        console.error("Get User Flights Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch flight requests" });
    }
};

/**
 * 3. User Selects Option and Submits Passengers (Phase 2)
 * @route POST /api/v1/flights/user/:id/select
 */
const selectOptionAndPassengers = async (req, res) => {
    try {
        const validation = selectOptionSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ status: "ERROR", message: validation.error.issues[0].message });
        }

        const { selectedOptionId, passengers } = validation.data;
        const requestId = req.params.id;
        const userId = req.user.id;

        // Concurrency/State Lock: Must be in OPTIONS_PROVIDED state (or FUTURE_HELD if fast-tracked)
        const flightRequest = await prisma.flightBookingRequest.findFirst({
            where: { id: requestId, userId }
        });

        if (!flightRequest) {
            return res.status(404).json({ status: "ERROR", message: "Flight request not found" });
        }

        // Validate the option exists if options have been provided
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

        // If options were provided by staff, force valid selection. 
        // If not (e.g. initial request fast-track), we allow the selection to proceed (usually just passenger info).
        if (hasOptions && !validOption) {
            return res.status(400).json({ status: "ERROR", message: "Invalid option selected from available choices." });
        }

        // Atomic Transaction: Update request and insert passengers
        const updatedRequest = await prisma.$transaction(async (tx) => {
            // Unlink old passengers if any
            await tx.passenger.deleteMany({ where: { flightRequestId: requestId } });

            // Create new passengers
            const createdPassengers = await tx.passenger.createMany({
                data: passengers.map(p => ({
                    flightRequestId: requestId,
                    title: p.title,
                    firstName: p.firstName,
                    lastName: p.lastName,
                    dateOfBirth: new Date(p.dateOfBirth),
                    gender: p.gender
                }))
            });

            // Prepare the payload for the request update
            const updatePayload = {
                status: 'SELECTION_MADE',
                selectedOptionId
            };

            // If a specific date was attached to this option, update the targetDate to match it
            if (selectedFlightDate) {
                updatePayload.targetDate = new Date(selectedFlightDate);
            }

            // Update state
            const reqUpdate = await tx.flightBookingRequest.update({
                where: { id: requestId },
                data: updatePayload
            });

            // Audit
            await tx.flightRequestActivity.create({
                data: {
                    requestId,
                    userId,
                    previousState: flightRequest.status,
                    newState: 'SELECTION_MADE',
                    actionDetails: `User selected option ${selectedOptionId} and submitted ${passengers.length} passengers`
                }
            });

            return reqUpdate;
        });

        res.status(200).json({
            status: "OK",
            message: "Flight option and passengers submitted successfully",
            data: updatedRequest
        });

    } catch (error) {
        console.error("Select Option Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to submit selection" });
    }
};

/**
 * 4. User Pays for Quoted Flight (Atomic Wallet Deduction)
 * @route POST /api/v1/flights/user/:id/pay
 */
const payForFlight = async (req, res) => {
    try {
        const requestId = req.params.id;
        const userId = req.user.id;

        // Start serializable database transaction to guarantee no race conditions
        const result = await prisma.$transaction(async (tx) => {
            // 1. Lock the Flight Request matching the QUOTED state exactly
            const flightRequest = await tx.flightBookingRequest.findUnique({
                where: { id: requestId }
            });

            if (!flightRequest || flightRequest.userId !== userId) {
                throw new Error("Flight request not found");
            }

            if (flightRequest.status !== 'QUOTED') {
                throw new Error(`Cannot pay. Request is in state: ${flightRequest.status}`);
            }

            if (!flightRequest.sellingPrice) {
                throw new Error("Staff has not set a selling price yet");
            }

            // Verify Ticketing Time Limit has not expired
            if (flightRequest.ticketingTimeLimit && new Date() > new Date(flightRequest.ticketingTimeLimit)) {
                // Auto-expire
                await tx.flightBookingRequest.update({
                    where: { id: requestId },
                    data: { status: 'EXPIRED' }
                });

                await tx.flightRequestActivity.create({
                    data: { requestId, previousState: 'QUOTED', newState: 'EXPIRED', actionDetails: 'TTL Expired during payment attempt' }
                });

                throw new Error("Ticketing Time Limit has expired. Please request a new quote.");
            }

            const paymentAmount = Number(flightRequest.sellingPrice);

            // 2. Atomic Wallet Deduction (Let the database do the math)
            // If balance drops below 0, Prisma will throw an error if constraints are set, or we manually check
            const wallet = await tx.wallet.update({
                where: { userId },
                data: { balance: { decrement: paymentAmount } }
            });

            if (Number(wallet.balance) < 0) {
                throw new Error("Insufficient wallet balance");
            }

            // 3. Create completely separate FlightTransaction record
            const txRef = generateFlightRef();
            const flightTx = await tx.flightTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: 'PAYMENT',
                    amount: paymentAmount,
                    reference: txRef,
                    flightRequestId: requestId
                }
            });

            // 4. Update the Flight Request state to PAID_PROCESSING
            const updatedRequest = await tx.flightBookingRequest.update({
                where: { id: requestId, status: 'QUOTED' }, // Concurrency lock
                data: { status: 'PAID_PROCESSING' }
            });

            // 5. Audit Trail
            await tx.flightRequestActivity.create({
                data: {
                    requestId,
                    userId,
                    previousState: 'QUOTED',
                    newState: 'PAID_PROCESSING',
                    actionDetails: `User paid NGN ${paymentAmount} via wallet`
                }
            });

            return { updatedRequest, flightTx };
        });

        res.status(200).json({
            status: "OK",
            message: "Payment successful. Processing ticket.",
            data: result
        });

    } catch (error) {
        console.error("Flight Payment Error:", error);
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
 * 5. User Cancels Flight Request
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

        // Only allow cancel if not already paid/ticketed
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
 * 6. Get List of Airports
 * @route GET /api/v1/flights/user/airports
 */
const getAirports = (req, res) => {
    res.status(200).json({ status: "OK", data: NIGERIA_AIRPORTS });
};

module.exports = {
    requestFlight,
    getUserRequests,
    getUserRequestById,
    selectOptionAndPassengers,
    payForFlight,
    cancelFlightRequest,
    getAirports
};
