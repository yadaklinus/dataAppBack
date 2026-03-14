const { z } = require('zod');
const prisma = require('@/lib/prisma');

const crypto = require('crypto');
const sendEmail = require('@/lib/mailer');
const { generateFlightTicketEmailTemplate } = require('@/lib/emailTemplates');

/**
 * Validations
 */
const provideOptionsSchema = z.object({
    flightOptions: z.array(z.object({
        id: z.string().optional(),
        airline: z.string().min(1),
        date: z.string().min(1),
        departureTime: z.string().optional(),
        arrivalTime: z.string().optional(),
        time: z.string().optional(), // for backward compatibility
        estPrice: z.number().positive(),
        details: z.string().optional(),
        legs: z.array(z.object({
            airline: z.string().optional(),
            flightNumber: z.string().optional(),
            origin: z.string().optional(),
            destination: z.string().optional(),
            departureTime: z.string().optional(),
            arrivalTime: z.string().optional()
        })).optional()
    })).min(1)
});

const quoteFlightSchema = z.object({
    airlineName: z.string().min(1),
    pnr: z.string().min(1),
    ticketingTimeLimit: z.string().min(1), // HTML datetime-local excludes 'Z', so we parse it manually
    netCost: z.number().min(0),
    sellingPrice: z.number().min(0),
    departureTime: z.string().optional(),
    arrivalTime: z.string().optional(),
    legs: z.array(z.object({
        airline: z.string().optional(),
        flightNumber: z.string().optional(),
        origin: z.string().optional(),
        destination: z.string().optional(),
        departureTime: z.string().optional(),
        arrivalTime: z.string().optional()
    })).optional()
});

const fulfillTicketSchema = z.object({
    eTicketUrl: z.string().url().optional(),
    ticketDetails: z.string().optional(),
    pnr: z.string().optional()
});

/**
 * 1. Admin/Staff Provides Flight Options (Phase 2)
 * @route POST /api/v1/flights/staff/:id/options
 */
const provideOptions = async (req, res) => {
    try {
        const validation = provideOptionsSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ status: "ERROR", message: validation.error.issues[0].message });
        }

        const requestId = req.params.id;
        const staffId = req.user.id; // Assuming auth route attaches staff id

        const flightRequest = await prisma.flightBookingRequest.findUnique({ where: { id: requestId } });
        if (!flightRequest) return res.status(404).json({ status: "ERROR", message: "Request not found" });

        if (flightRequest.status !== 'FUTURE_HELD' && flightRequest.status !== 'PENDING') {
            return res.status(400).json({ status: "ERROR", message: `Cannot provide options in state: ${flightRequest.status}` });
        }

        // Generate unique IDs for options if not provided
        const optionsWithIds = validation.data.flightOptions.map(opt => ({
            ...opt,
            id: opt.id || crypto.randomUUID()
        }));

        const updatedRequest = await prisma.flightBookingRequest.update({
            where: { id: requestId },
            data: {
                status: 'OPTIONS_PROVIDED',
                flightOptions: optionsWithIds
            }
        });

        await prisma.flightRequestActivity.create({
            data: {
                requestId,
                staffId,
                previousState: flightRequest.status,
                newState: 'OPTIONS_PROVIDED',
                actionDetails: `Staff provided ${validation.data.flightOptions.length} flight options.`
            }
        });

        res.status(200).json({ status: "OK", message: "Options sent to user", data: updatedRequest });
    } catch (error) {
        console.error("Provide Options Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to provide options" });
    }
};

/**
 * 2. Staff Quotes a Specific Flight (Phase 3)
 * @route POST /api/v1/flights/staff/:id/quote
 */
const quoteFlight = async (req, res) => {
    try {
        const validation = quoteFlightSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ status: "ERROR", message: validation.error.issues[0].message });
        }

        const { airlineName, pnr, ticketingTimeLimit, netCost, sellingPrice } = validation.data;
        const requestId = req.params.id;
        const staffId = req.user.id;

        // Concurrency Lock: Ensure state is SELECTION_MADE
        const flightRequest = await prisma.flightBookingRequest.findFirst({
            where: { id: requestId, status: 'SELECTION_MADE' }
        });

        if (!flightRequest) {
            return res.status(400).json({
                status: "ERROR",
                message: "Flight must be in SELECTION_MADE state to be quoted. It may have already been quoted by another agent."
            });
        }

        const updatedRequest = await prisma.flightBookingRequest.update({
            where: { id: requestId, status: 'SELECTION_MADE' }, // Strict concurrency lock
            data: {
                status: 'QUOTED',
                airlineName: validation.data.airlineName,
                pnr: validation.data.pnr,
                ticketingTimeLimit: new Date(validation.data.ticketingTimeLimit),
                netCost: validation.data.netCost,
                sellingPrice: validation.data.sellingPrice,
                departureTime: validation.data.departureTime,
                arrivalTime: validation.data.arrivalTime,
                legs: validation.data.legs
            }
        });

        await prisma.flightRequestActivity.create({
            data: {
                requestId,
                staffId,
                previousState: 'SELECTION_MADE',
                newState: 'QUOTED',
                actionDetails: `Staff quoted PNR ${pnr} at NGN ${sellingPrice}. TTL: ${ticketingTimeLimit}`
            }
        });

        res.status(200).json({ status: "OK", message: "Flight quoted successfully", data: updatedRequest });
    } catch (error) {
        console.error("Quote Flight Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to quote flight" });
    }
};

/**
 * 3. Staff Fulfills Ticket After Payment (Phase 4)
 * @route POST /api/v1/flights/staff/:id/fulfill
 */
const fulfillTicket = async (req, res) => {
    try {
        const validation = fulfillTicketSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ status: "ERROR", message: validation.error.issues[0].message });
        }

        const requestId = req.params.id;
        const staffId = req.user.id;

        // Must be in PAID_PROCESSING
        const flightRequest = await prisma.flightBookingRequest.findFirst({
            where: { id: requestId, status: 'PAID_PROCESSING' },
            include: { user: { select: { fullName: true, email: true } } }
        });

        if (!flightRequest) {
            return res.status(400).json({
                status: "ERROR",
                message: "Flight must be in PAID_PROCESSING state to fulfill."
            });
        }

        const updatedRequest = await prisma.flightBookingRequest.update({
            where: { id: requestId, status: 'PAID_PROCESSING' }, // Strict concurrency lock
            data: {
                status: 'TICKETED',
                eTicketUrl: validation.data.eTicketUrl || null,
                pnr: validation.data.pnr || flightRequest.pnr // Update PNR if provided, else keep existing
            }
        });

        const actionDetailsText = validation.data.ticketDetails
            ? `Staff fulfilled ticket and uploaded E-Ticket. Details: ${validation.data.ticketDetails}`
            : `Staff fulfilled ticket and uploaded E-Ticket`;

        await prisma.flightRequestActivity.create({
            data: {
                requestId,
                staffId,
                previousState: 'PAID_PROCESSING',
                newState: 'TICKETED',
                actionDetails: actionDetailsText
            }
        });

        // 4. Send Ticket Email to User
        try {
            const emailHtml = generateFlightTicketEmailTemplate({
                userName: flightRequest.user?.fullName || 'Valued Customer',
                origin: flightRequest.origin,
                destination: flightRequest.destination,
                pnr: validation.data.pnr || flightRequest.pnr,
                airlineName: flightRequest.airlineName,
                departureTime: flightRequest.departureTime,
                arrivalTime: flightRequest.arrivalTime,
                tripType: flightRequest.tripType,
                eTicketUrl: updatedRequest.eTicketUrl,
                legs: flightRequest.legs
            });

            await sendEmail({
                to: flightRequest.user?.email,
                subject: `Your E-Ticket is Ready: ${flightRequest.origin} to ${flightRequest.destination}`,
                html: emailHtml,
                text: `Hello, your flight booking ref ${validation.data.pnr || flightRequest.pnr} has been ticketed. Download here: ${updatedRequest.eTicketUrl}`
            });
        } catch (emailErr) {
            console.error("Fulfill Ticket Email Error (Non-blocking):", emailErr);
        }

        res.status(200).json({ status: "OK", message: "Flight ticketed and email sent successfully", data: updatedRequest });
    } catch (error) {
        console.error("Fulfill Ticket Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fulfill ticket" });
    }
};

/**
 * 4. List All Flights (For Admin Dashboard)
 * @route GET /api/v1/flights/staff/requests
 */
const getAllRequests = async (req, res) => {
    try {
        const { status, days } = req.query;
        let where = {};

        if (status && status !== 'ALL') {
            where.status = status;
        }

        if (days) {
            const date = new Date();
            const daysNum = parseInt(days);
            if (!isNaN(daysNum)) {
                date.setDate(date.getDate() - daysNum);
                date.setHours(0, 0, 0, 0); // Start of the day
                where.createdAt = { gte: date };
            }
        }

        const requests = await prisma.flightBookingRequest.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { fullName: true, email: true, phoneNumber: true } }, passengers: true }
        });

        const mappedRequests = requests.map(r => ({ ...r, passengerDetails: r.passengers }));

        res.status(200).json({ status: "OK", data: mappedRequests });
    } catch (error) {
        console.error("Get All Requests Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch requests" });
    }
};

/**
 * 5. Get Staff Dashboard Data (Stats + Recent Requests)
 * @route GET /api/v1/flights/staff/dashboard
 */
const getDashboardData = async (req, res) => {
    console.log("Dashboard Hit");
    try {
        const staffId = req.user.id;

        console.log("Staff ID:", staffId);

        // 1. Get Staff Info
        const staff = await prisma.staff.findUnique({
            where: { id: staffId },
            select: { fullName: true, role: true }
        });

        if (!staff) return res.status(404).json({ status: "ERROR", message: "Staff not found" });

        // 2. Get Stats Aggragation
        const statusGroups = await prisma.flightBookingRequest.groupBy({
            by: ['status'],
            _count: { _all: true }
        });

        const statsMap = statusGroups.reduce((acc, curr) => {
            acc[curr.status] = curr._count._all;
            return acc;
        }, {});

        const stats = {
            totalRequests: statusGroups.reduce((acc, curr) => acc + curr._count._all, 0),
            pending: statsMap['FUTURE_HELD'] || 0,
            awaitingSelection: statsMap['OPTIONS_PROVIDED'] || 0,
            selectionMade: statsMap['SELECTION_MADE'] || 0,
            quoted: statsMap['QUOTED'] || 0,
            processing: statsMap['PAID_PROCESSING'] || 0,
            completed: statsMap['TICKETED'] || 0,
            cancelled: statsMap['CANCELLED'] || 0
        };

        // 3. Get Recent Requests
        const recentRequests = await prisma.flightBookingRequest.findMany({
            take: 15,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { fullName: true, email: true, phoneNumber: true } }, passengers: true }
        });

        const mappedRequests = recentRequests.map(r => ({ ...r, passengerDetails: r.passengers }));

        res.status(200).json({
            status: "OK",
            data: {
                user: staff,
                stats,
                requests: mappedRequests
            }
        });
    } catch (error) {
        console.error("Get Dashboard Data Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch dashboard data" });
    }
};

/**
 * 6. Get Audit History for a Request
 * @route GET /api/v1/flights/staff/:id/history
 */
const getRequestHistory = async (req, res) => {
    try {
        const { id } = req.params;
        const history = await prisma.flightRequestActivity.findMany({
            where: { requestId: id },
            orderBy: { createdAt: 'desc' },
            include: { user: true, staff: true }
        });

        const formattedHistory = history.map(h => ({
            id: h.id,
            action: h.actionDetails || 'Status Update',
            oldStatus: h.previousState,
            newStatus: h.newState,
            timestamp: h.createdAt,
            changedByUsername: h.staff ? h.staff.fullName : (h.user ? h.user.fullName : 'System')
        }));

        res.status(200).json({ status: "OK", data: formattedHistory });
    } catch (error) {
        console.error("Get History Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch request history" });
    }
};

/**
 * 7. Staff Cancels Flight Request
 * @route POST /api/v1/flights/staff/:id/cancel
 */
const cancelFlightRequest = async (req, res) => {
    try {
        const requestId = req.params.id;
        const staffId = req.user.id;

        const flightRequest = await prisma.flightBookingRequest.findUnique({
            where: { id: requestId }
        });

        if (!flightRequest) return res.status(404).json({ status: "ERROR", message: "Request not found" });

        // Only allow cancel if not already paid/ticketed/refunded
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
                staffId,
                previousState: flightRequest.status,
                newState: 'CANCELLED',
                actionDetails: 'Staff manually cancelled the request'
            }
        });

        res.status(200).json({ status: "OK", message: "Flight request cancelled successfully", data: updatedRequest });
    } catch (error) {
        console.error("Staff Cancel Flight Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to cancel flight request" });
    }
};

/**
 * 8. Staff Refunds a Paid/Ticketed Flight
 * @route POST /api/v1/flights/staff/:id/refund
 */
const refundFlightRequest = async (req, res) => {
    try {
        const requestId = req.params.id;
        const staffId = req.user.id;

        const result = await prisma.$transaction(async (tx) => {
            const flightRequest = await tx.flightBookingRequest.findUnique({
                where: { id: requestId }
            });

            if (!flightRequest) throw new Error("Request not found");

            // Must be PAID_PROCESSING or TICKETED to refund
            if (!['PAID_PROCESSING', 'TICKETED'].includes(flightRequest.status)) {
                throw new Error(`Cannot refund a request in ${flightRequest.status} state.`);
            }

            if (!flightRequest.sellingPrice) {
                throw new Error("No payment amount recorded to refund.");
            }

            const refundAmount = Number(flightRequest.sellingPrice);

            // Refund to user's wallet
            const wallet = await tx.wallet.update({
                where: { userId: flightRequest.userId },
                data: { balance: { increment: refundAmount } }
            });

            // Create Refund Transaction Record
            const txRef = `RFN-${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`;
            await tx.flightTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: 'REFUND',
                    amount: refundAmount,
                    reference: txRef,
                    flightRequestId: requestId
                }
            });

            const updatedRequest = await tx.flightBookingRequest.update({
                where: { id: requestId },
                data: { status: 'REFUNDED' }
            });

            await tx.flightRequestActivity.create({
                data: {
                    requestId,
                    staffId,
                    previousState: flightRequest.status,
                    newState: 'REFUNDED',
                    actionDetails: `Staff refunded NGN ${refundAmount} to the user's wallet`
                }
            });

            return updatedRequest;
        });

        res.status(200).json({ status: "OK", message: "Flight refunded successfully", data: result });
    } catch (error) {
        console.error("Staff Refund Flight Error:", error);
        res.status(400).json({ status: "ERROR", message: error.message || "Failed to refund flight request" });
    }
};

/**
 * 9. Get Global Flight Transactions List (Super Admin only)
 * @route GET /api/v1/flights/staff/transactions
 */
const getAllFlightTransactions = async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ status: "ERROR", message: "Unauthorized access" });
        }

        const transactions = await prisma.flightTransaction.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                wallet: {
                    include: {
                        user: { select: { fullName: true, email: true } }
                    }
                },
                flightRequest: {
                    select: {
                        origin: true,
                        destination: true,
                        airlineName: true,
                        pnr: true
                    }
                }
            }
        });

        res.status(200).json({ status: "OK", data: transactions });
    } catch (error) {
        console.error("Get All Transactions Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch transactions" });
    }
};

module.exports = {
    provideOptions,
    quoteFlight,
    fulfillTicket,
    getAllRequests,
    getDashboardData,
    getRequestHistory,
    cancelFlightRequest,
    refundFlightRequest,
    getAllFlightTransactions
};
