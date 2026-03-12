const cron = require('node-cron');
const prisma = require('@/lib/prisma');

/**
 * 60-Day Flight Rule Background Job
 * Runs every 12 hours.
 * Finds all FUTURE_HELD flights that are now <= 60 days away.
 * Updates their status to PENDING (or notifies staff) so they can provide options.
 */
const startFlightStatusJob = () => {
    // 0 */12 * * * = Every 12 hours
    cron.schedule('0 */12 * * *', async () => {
        console.log('[System] Running 60-Day Flight Status Check...');

        try {
            const sixtyDaysFromNow = new Date();
            sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60);

            // Find requests in FUTURE_HELD where targetDate <= 60 days from now
            const eligibleFlights = await prisma.flightBookingRequest.findMany({
                where: {
                    status: 'FUTURE_HELD',
                    targetDate: { lte: sixtyDaysFromNow }
                },
                select: {
                    id: true,
                    targetDate: true,
                    status: true
                }
            });

            if (eligibleFlights.length === 0) {
                console.log('[System] No new flights entered the 60-day window.');
                return;
            }

            console.log(`[System] Found ${eligibleFlights.length} flights entering 60-day window. Unlocking for options...`);

            // Update to PENDING (so they show up in Staff Dashboard as needs options)
            for (const flight of eligibleFlights) {
                await prisma.flightBookingRequest.update({
                    where: { id: flight.id },
                    data: { status: 'PENDING' } // Using PENDING as the trigger state for staff to act
                });

                // Audit trail
                await prisma.flightRequestActivity.create({
                    data: {
                        requestId: flight.id,
                        previousState: 'FUTURE_HELD',
                        newState: 'PENDING',
                        actionDetails: 'System automatically unlocked flight because target date is within 60 days.'
                    }
                });
            }

            console.log(`[System] Successfully unlocked ${eligibleFlights.length} flights.`);

        } catch (error) {
            console.error('[System] Error in 60-Day Flight Status Check:', error);
        }
    });

    console.log('[System] 60-Day Flight Cron Job registered.');
};

module.exports = { startFlightStatusJob };
