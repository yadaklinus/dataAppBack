const { printPins } = require('../pinController');
const httpMocks = require('node-mocks-http');
const prisma = require('@/lib/prisma');
const pinProvider = require('@/services/pinProvider');

jest.mock('@/lib/prisma');
jest.mock('@/services/pinProvider');

describe('PIN Controller - printPins', () => {
    let req, res;
    const userId = 'user-123';

    beforeEach(() => {
        req = httpMocks.createRequest({
            method: 'POST',
            url: '/api/v1/transactions/pins',
            user: { id: userId },
            body: {
                network: 'MTN',
                value: '100', // String enum
                quantity: 5 // number
            },
            headers: {}
        });
        res = httpMocks.createResponse();

        jest.clearAllMocks();

        prisma.transaction.findFirst.mockResolvedValue(null);

        prisma.$transaction.mockImplementation(async (callback) => {
            return callback(prisma);
        });

        prisma.wallet.findUnique.mockResolvedValue({
            userId, balance: 1000 // User has 1000, trying to buy 5 * 100 = 500
        });

        prisma.wallet.update.mockResolvedValue({ count: 1 });
        prisma.transaction.create.mockResolvedValue({ id: 'txn-123', transaction: { id: 'txn-123' } });

        pinProvider.buyEpin.mockResolvedValue({
            pins: [
                { pin: '1111-2222-3333-4444', sno: 'SN001', amount: 100 },
                { pin: '5555-6666-7777-8888', sno: 'SN002', amount: 100 },
                { pin: '9999-0000-1111-2222', sno: 'SN003', amount: 100 },
                { pin: '3333-4444-5555-6666', sno: 'SN004', amount: 100 },
                { pin: '7777-8888-9999-0000', sno: 'SN005', amount: 100 }
            ]
        });

        prisma.rechargePin.createMany.mockResolvedValue({ count: 5 });
        prisma.transaction.update.mockResolvedValue({});
    });

    it('should successfully buy PINs and deduct correct wallet amount', async () => {
        await printPins(req, res);

        const responseData = res._getJSONData();
        expect(res.statusCode).toBe(200);
        expect(responseData.status).toBe('OK');

        // Ensure wallet update used the dynamically calculated totalCost (5 * 100 = 500)
        expect(prisma.wallet.update).toHaveBeenCalledWith({
            where: { userId },
            data: { balance: { decrement: 500 }, totalSpent: { increment: 500 } }
        });

        expect(pinProvider.buyEpin).toHaveBeenCalledWith('MTN', '100', 5, expect.any(String));
        // Verify PINs are sent to db
        expect(prisma.rechargePin.createMany).toHaveBeenCalled();
    });

    it('should return 402 if wallet balance is insufficient for total batch quantity', async () => {
        prisma.wallet.findUnique.mockResolvedValue({
            userId, balance: 400 // Has 400, needs 500
        });

        await printPins(req, res);

        expect(res.statusCode).toBe(402);
        expect(res._getJSONData().message).toBe('Insufficient wallet balance');
        expect(pinProvider.buyEpin).not.toHaveBeenCalled();
    });

    it('should return 400 if value is unsupported (e.g. 300)', async () => {
        req.body.value = '300';

        await printPins(req, res);

        expect(res.statusCode).toBe(400);
        // Assuming your schema allows this through, fallback to logical check
        // If Zod catches it, it will return validation error.
    });
});
