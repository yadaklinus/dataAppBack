const { purchaseData } = require('../dataController');
const httpMocks = require('node-mocks-http');
const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const bcrypt = require('bcryptjs');

// Mock external dependencies
jest.mock('@/lib/prisma');
jest.mock('@/services/vtpassProvider');
jest.mock('bcryptjs');

describe('Data Controller - purchaseData', () => {
    let req, res;
    const userId = 'user-123';

    beforeEach(() => {
        req = httpMocks.createRequest({
            method: 'POST',
            url: '/api/v1/transactions/data',
            user: { id: userId },
            body: {
                network: 'MTN',
                planId: 'mtn-100mb',
                phoneNumber: '08031234567',
                transactionPin: '1234'
            },
            headers: {}
        });
        res = httpMocks.createResponse();

        // Reset mocks
        jest.clearAllMocks();

        // Setup default mock behaviors
        vtpassProvider.fetchDataPlans.mockResolvedValue([
            { variation_code: 'mtn-100mb', SELLING_PRICE: 100, name: '100MB 1Day' }
        ]);

        bcrypt.compare.mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({ id: userId, transactionPin: 'hashedpin123' });

        // By default, assume no recent duplicate transaction
        prisma.transaction.findFirst.mockResolvedValue(null);

        // Mock the prisma.$transaction block to immediately call and return the callback
        prisma.$transaction.mockImplementation(async (callback) => {
            // we pass `prisma` itself as the `tx` object for simplicity in this unit test
            return callback(prisma);
        });

        prisma.wallet.updateMany.mockResolvedValue({ count: 1 }); // Wallet deduction success
        prisma.transaction.create.mockResolvedValue({ id: 'txn-123' }); // Transaction row created

        // Mock provider response
        vtpassProvider.buyData.mockResolvedValue({ isPending: false, status: 'SUCCESS', transactionid: 'ext-ref-1' });
        prisma.transaction.update.mockResolvedValue({});
    });

    it('should successfully purchase data and deduct wallet', async () => {
        await purchaseData(req, res);

        const responseData = res._getJSONData();
        expect(res.statusCode).toBe(200);
        expect(responseData.status).toBe('OK');

        // Ensure atomic transaction was used
        expect(prisma.$transaction).toHaveBeenCalled();

        // Verify that wallet update was attempted
        expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
            where: {
                userId,
                balance: { gte: 100 }
            },
            data: {
                balance: { decrement: 100 },
                totalSpent: { increment: 100 }
            }
        });

        // Verify provider was called
        expect(vtpassProvider.buyData).toHaveBeenCalledWith('MTN', 'mtn-100mb', '08031234567', expect.any(String));
    });

    it('should return 402 if wallet balance is insufficient', async () => {
        prisma.wallet.updateMany.mockResolvedValue({ count: 0 }); // Simulate insufficient balance

        await purchaseData(req, res);

        expect(res.statusCode).toBe(402);
        expect(res._getJSONData().message).toBe('Insufficient wallet balance');
        expect(vtpassProvider.buyData).not.toHaveBeenCalled();
    });

    it('should block duplicate requests within 60 seconds (Time-based idempotency)', async () => {
        // Simulate a duplicate transaction found
        prisma.transaction.findFirst.mockResolvedValue({
            id: 'txn-old',
            metadata: { network: 'MTN', planId: 'mtn-100mb' } // Matching details
        });

        await purchaseData(req, res);

        expect(res.statusCode).toBe(409);
        expect(res._getJSONData().message).toContain('Identical transaction detected');
        expect(prisma.$transaction).not.toHaveBeenCalled(); // No money deducted
    });

    it('should immediately block repeated explicitly keyed requests (Header idempotency)', async () => {
        req.headers['x-idempotency-key'] = 'unique-ui-uuid-999';

        // Simulate finding the key in the database
        prisma.transaction.findFirst.mockResolvedValue({
            id: 'txn-old-keyed'
        });

        await purchaseData(req, res);

        expect(res.statusCode).toBe(409);
        expect(res._getJSONData().message).toContain('has already been processed');
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
