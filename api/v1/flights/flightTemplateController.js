const { z } = require('zod');
const prisma = require('@/lib/prisma');

const flightTemplateSchema = z.object({
    airlineName: z.string().min(1),
    flightNumber: z.string().optional(),
    origin: z.string().min(1),
    destination: z.string().min(1),
    flightDate: z.string().datetime().optional(),
    departureTime: z.string().optional(),
    arrivalTime: z.string().optional(),
    flightClass: z.string().default('ECONOMY'),
    basePrice: z.number().positive(),
    notes: z.string().optional(),
    legs: z.array(z.object({
        airline: z.string().optional(),
        flightNumber: z.string().optional(),
        origin: z.string().optional(),
        destination: z.string().optional(),
        departureTime: z.string().optional(),
        arrivalTime: z.string().optional()
    })).optional()
});

/**
 * 1. staff saves a flight template
 * @route POST /api/v1/flights/staff/templates
 */
const saveTemplate = async (req, res) => {
    try {
        const validation = flightTemplateSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ status: "ERROR", message: validation.error.issues[0].message });
        }

        const template = await prisma.savedFlightTemplate.create({
            data: {
                ...validation.data,
                flightDate: validation.data.flightDate ? new Date(validation.data.flightDate) : null
            }
        });

        res.status(201).json({ status: "OK", message: "Template saved successfully", data: template });
    } catch (error) {
        console.error("Save Template Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to save template" });
    }
};

/**
 * 2. List all templates
 * @route GET /api/v1/flights/staff/templates
 */
const getTemplates = async (req, res) => {
    try {
        const templates = await prisma.savedFlightTemplate.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ status: "OK", data: templates });
    } catch (error) {
        console.error("Get Templates Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch templates" });
    }
};

/**
 * 3. Delete a template
 * @route DELETE /api/v1/flights/staff/templates/:id
 */
const deleteTemplate = async (req, res) => {
    try {
        await prisma.savedFlightTemplate.delete({
            where: { id: req.params.id }
        });
        res.status(200).json({ status: "OK", message: "Template deleted" });
    } catch (error) {
        console.error("Delete Template Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to delete template" });
    }
};

/**
 * 4. Apply template to request (Special Quoting)
 * @route POST /api/v1/flights/staff/request/:requestId/quote-from-template
 */
const quoteFromTemplate = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { templateId, adjustedPrice, pnr, ticketingTimeLimit } = req.body;
        const staffId = req.user.id;

        const template = await prisma.savedFlightTemplate.findUnique({ where: { id: templateId } });
        if (!template) return res.status(404).json({ status: "ERROR", message: "Template not found" });

        const flightRequest = await prisma.flightBookingRequest.findUnique({ where: { id: requestId } });
        if (!flightRequest) return res.status(404).json({ status: "ERROR", message: "Request not found" });

        // Update request directly to QUOTED
        const updatedRequest = await prisma.flightBookingRequest.update({
            where: { id: requestId },
            data: {
                status: 'QUOTED',
                airlineName: template.airlineName,
                pnr: pnr,
                ticketingTimeLimit: new Date(ticketingTimeLimit),
                netCost: template.basePrice,
                sellingPrice: adjustedPrice || template.basePrice,
                // We could also store other template info in metadata if needed
            }
        });

        await prisma.flightRequestActivity.create({
            data: {
                requestId,
                staffId,
                previousState: flightRequest.status,
                newState: 'QUOTED',
                actionDetails: `Staff quoted from template ${template.airlineName} (Price: ${adjustedPrice || template.basePrice})`
            }
        });

        res.status(200).json({ status: "OK", message: "Quote applied successfully", data: updatedRequest });
    } catch (error) {
        console.error("Quote from Template Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to apply template quote" });
    }
};

module.exports = {
    saveTemplate,
    getTemplates,
    deleteTemplate,
    quoteFromTemplate
};
