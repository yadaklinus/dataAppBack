const { purchaseAirtime } = require('../airtimeController');
const httpMocks = require('node-mocks-http');
const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const bcrypt = require('bcryptjs');

jest.mock('@/lib/prisma');
jest.mock('@/services/vtpassProvider');
jest.mock('bcryptjs');

describe('Airtime Controller - purchaseAirtime', () => {
    let req, res;
    const userId = 'user-123';

    // Official VTPass Test Numbers
    const SUCCESS_PHONE = '08011111111';

    beforeEach(() => {
        req = httpMocks.createRequest({
            method: 'POST',
            url: '/api/v1/transactions/airtime',
            user: { id: userId },
            body: {
                network: 'MTN',
                amount: 500,
                phoneNumber: SUCCESS_PHONE,
                transactionPin: '1234'
            },
            headers: {}
        });
        res = httpMocks.createResponse();

        jest.clearAllMocks();

        bcrypt.compare.mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({ id: userId, transactionPin: 'hashedpin123' });
        prisma.transaction.findFirst.mockResolvedValue(null);

        prisma.$transaction.mockImplementation(async (callback) => {
            return callback(prisma);
        });

        prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
        prisma.transaction.create.mockResolvedValue({ id: 'txn-123' });

        vtpassProvider.buyAirtime.mockResolvedValue({ isPending: false, status: 'SUCCESS', transactionid: 'ext-ref-airtime' });
        prisma.transaction.update.mockResolvedValue({});
    });

    it('should successfully purchase airtime and deduct wallet', async () => {
        await purchaseAirtime(req, res);

        const responseData = res._getJSONData();
        expect(res.statusCode).toBe(200);
        expect(responseData.status).toBe('OK');

        expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
            where: { userId, balance: { gte: 500 } },
            data: { balance: { decrement: 500 }, totalSpent: { increment: 500 } }
        });

        expect(vtpassProvider.buyAirtime).toHaveBeenCalledWith('MTN', 500, SUCCESS_PHONE, expect.any(String));
    });

    it('should return 400 if minimum amount is not met', async () => {
        req.body.amount = 40; // Less than minimum 50

        await purchaseAirtime(req, res);

        expect(res.statusCode).toBe(400);
        expect(res._getJSONData().message).toBe('Minimum airtime is ₦50');
        expect(vtpassProvider.buyAirtime).not.toHaveBeenCalled();
    });

    it('should block duplicate airtime requests within 60 seconds (Time-based idempotency)', async () => {
        prisma.transaction.findFirst.mockResolvedValue({
            id: 'txn-old',
            metadata: { network: 'MTN' }
        });

        await purchaseAirtime(req, res);

        expect(res.statusCode).toBe(409);
        expect(res._getJSONData().message).toContain('Identical transaction detected');
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
