const { purchaseSubscription } = require('../cableController');
const httpMocks = require('node-mocks-http');
const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const bcrypt = require('bcryptjs');

jest.mock('@/lib/prisma');
jest.mock('@/services/vtpassProvider');
jest.mock('bcryptjs');
jest.mock('@/lib/redis', () => ({
    getCache: jest.fn(),
    setCache: jest.fn(),
    delCache: jest.fn(),
    redisClient: {
        quit: jest.fn(),
        isOpen: false
    }
}));

describe('Cable Controller - purchaseSubscription', () => {
    let req, res;
    const userId = 'user-123';

    // Official VTPass Test Numbers
    const SUCCESS_SMARTCARD = '1212121212';

    beforeEach(() => {
        req = httpMocks.createRequest({
            method: 'POST',
            url: '/api/v1/transactions/cable',
            user: { id: userId, phoneNumber: '08000000000' },
            body: {
                cableTV: 'dstv',
                packageCode: 'dstv-yanga',
                smartCardNo: SUCCESS_SMARTCARD,
                transactionPin: '1234'
            },
            headers: {}
        });
        res = httpMocks.createResponse();

        jest.clearAllMocks();

        vtpassProvider.verifySmartCard.mockResolvedValue({ customer_name: 'Test Customer' });
        vtpassProvider.fetchCablePackages.mockResolvedValue([
            { variation_code: 'dstv-yanga', variation_amount: 3500, name: 'DStv Yanga' }
        ]);

        bcrypt.compare.mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({ id: userId, transactionPin: 'hashedpin123', phoneNumber: '08000000000' });
        prisma.transaction.findFirst.mockResolvedValue(null);

        prisma.$transaction.mockImplementation(async (callback) => {
            return callback(prisma);
        });

        prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
        prisma.transaction.create.mockResolvedValue({ id: 'txn-123' });

        vtpassProvider.buyCableTV.mockResolvedValue({ isPending: false, status: 'SUCCESS', orderId: 'ext-ref-cable' });
        prisma.transaction.update.mockResolvedValue({});
    });

    it('should successfully purchase a cable subscription and deduct wallet', async () => {
        await purchaseSubscription(req, res);

        const responseData = res._getJSONData();
        expect(res.statusCode).toBe(200);
        expect(responseData.status).toBe('OK');

        expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
            where: { userId, balance: { gte: 3500 } },
            data: { balance: { decrement: 3500 }, totalSpent: { increment: 3500 } }
        });

        expect(vtpassProvider.buyCableTV).toHaveBeenCalledWith(
            'dstv', 'dstv-yanga', SUCCESS_SMARTCARD, '08000000000', 3500, expect.any(String)
        );
    });

    it('should return 404 if package code is invalid', async () => {
        req.body.packageCode = 'invalid-package';

        await purchaseSubscription(req, res);

        expect(res.statusCode).toBe(404);
        expect(res._getJSONData().message).toBe('Invalid package code');
        expect(vtpassProvider.buyCableTV).not.toHaveBeenCalled();
    });

    it('should block explicit identically keyed requests (Header idempotency)', async () => {
        req.headers['x-idempotency-key'] = 'unique-cable-uuid';

        prisma.transaction.findFirst.mockResolvedValue({ id: 'txn-old-keyed' });

        await purchaseSubscription(req, res);

        expect(res.statusCode).toBe(409);
        expect(res._getJSONData().message).toContain('has already been processed');
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
