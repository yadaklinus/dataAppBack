const prisma = require('./lib/prisma');

async function testTemplates() {
    console.log("--- Testing Flight Templates ---");
    
    // 1. Create a template
    const template = await prisma.savedFlightTemplate.create({
        data: {
            airlineName: "Test Air",
            origin: "LOS",
            destination: "ABV",
            basePrice: 50000,
            flightClass: "ECONOMY",
            notes: "Test Template"
        }
    });
    console.log("Template created:", template.id);

    // 2. Mock a flight request
    const user = await prisma.user.findFirst();
    if (!user) {
        console.log("No user found in DB to test with.");
        return;
    }

    const request = await prisma.flightBookingRequest.create({
        data: {
            userId: user.id,
            origin: "LOS",
            destination: "ABV",
            tripType: "ONE_WAY",
            targetDate: new Date(),
            adults: 1,
            children: 0,
            infants: 0,
            status: "FUTURE_HELD"
        }
    });
    console.log("Request created:", request.id);

    // 3. Test quote from template logic (Simulating the controller logic)
    const updatedRequest = await prisma.flightBookingRequest.update({
        where: { id: request.id },
        data: {
            status: 'QUOTED',
            airlineName: template.airlineName,
            pnr: "TESTPNR",
            ticketingTimeLimit: new Date(Date.now() + 3600000),
            netCost: template.basePrice,
            sellingPrice: template.basePrice + 1000, // Adjusted price
        }
    });
    console.log("Request status after template quote:", updatedRequest.status);
    console.log("Selling Price:", updatedRequest.sellingPrice);

    // 4. Test Select and Pay logic (Simulated)
    // Ensure user has balance
    let wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) {
        wallet = await prisma.wallet.create({ data: { userId: user.id, balance: 100000 } });
    } else if (Number(wallet.balance) < 60000) {
        await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: 100000 } });
    }

    const paymentAmount = Number(updatedRequest.sellingPrice);
    
    // Transactional flow
    await prisma.$transaction(async (tx) => {
        // Decrease balance
        await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { decrement: paymentAmount } }
        });

        // Add passenger
        await tx.passenger.create({
            data: {
                flightRequestId: request.id,
                title: "Mr",
                firstName: "Test",
                lastName: "User",
                dateOfBirth: new Date("1990-01-01"),
                gender: "MALE"
            }
        });

        // Update status
        await tx.flightBookingRequest.update({
            where: { id: request.id },
            data: { status: 'PAID_PROCESSING' }
        });
    });

    const finalRequest = await prisma.flightBookingRequest.findUnique({ where: { id: request.id } });
    console.log("Final Request Status:", finalRequest.status);

    // Cleanup
    await prisma.passenger.deleteMany({ where: { flightRequestId: request.id } });
    await prisma.flightBookingRequest.delete({ where: { id: request.id } });
    await prisma.savedFlightTemplate.delete({ where: { id: template.id } });
    console.log("Cleanup done.");
}

testTemplates()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
