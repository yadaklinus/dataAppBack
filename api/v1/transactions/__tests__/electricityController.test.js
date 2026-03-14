const { purchaseElectricity } = require('../electricityController');
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

describe('Electricity Controller - purchaseElectricity', () => {
    let req, res;
    const userId = 'user-123';

    // Official VTPass Test Numbers
    const SUCCESS_PREPAID_METER = '1111111111111';

    beforeEach(() => {
        req = httpMocks.createRequest({
            method: 'POST',
            url: '/api/v1/transactions/electricity',
            user: { id: userId, phoneNumber: '08000000000' },
            body: {
                discoCode: 'ikeja-electric',
                meterNo: SUCCESS_PREPAID_METER,
                meterType: '01', // Prepaid
                amount: 5000,
                transactionPin: '1234'
            },
            headers: {}
        });
        res = httpMocks.createResponse();

        jest.clearAllMocks();

        vtpassProvider.verifyMeter.mockResolvedValue({
            customer_name: 'Test Customer',
            customer_address: '123 Test St',
            minAmount: 1000 // Ensure request amount > minAmount
        });

        bcrypt.compare.mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({ id: userId, transactionPin: 'hashedpin123', phoneNumber: '08000000000' });
        prisma.transaction.findFirst.mockResolvedValue(null);

        prisma.$transaction.mockImplementation(async (callback) => {
            return callback(prisma);
        });

        prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
        prisma.transaction.create.mockResolvedValue({ id: 'txn-123', metadata: {} });

        vtpassProvider.payElectricityBill.mockResolvedValue({
            isPending: false,
            status: 'SUCCESS',
            orderId: 'ext-ref-elec',
            token: '1234-5678-9012-3456-7890',
            units: '50.5'
        });
        prisma.transaction.update.mockResolvedValue({});
    });

    it('should successfully pay electricity bill and return a token', async () => {
        await purchaseElectricity(req, res);

        const responseData = res._getJSONData();
        expect(res.statusCode).toBe(200);
        expect(responseData.status).toBe('OK');
        expect(responseData.token).toBe('1234-5678-9012-3456-7890');

        expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
            where: { userId, balance: { gte: 5000 } },
            data: { balance: { decrement: 5000 }, totalSpent: { increment: 5000 } }
        });

        expect(vtpassProvider.payElectricityBill).toHaveBeenCalledWith(
            'ikeja-electric', 'prepaid', SUCCESS_PREPAID_METER, 5000, '08000000000', expect.any(String)
        );
    });

    it('should return 400 if amount is less than disco minimum', async () => {
        req.body.amount = 500; // Less than 1000 min

        await purchaseElectricity(req, res);

        expect(res.statusCode).toBe(400);
        expect(res._getJSONData().message).toContain('Minimum purchase amount is ₦1000');
        expect(vtpassProvider.payElectricityBill).not.toHaveBeenCalled();
    });

    it('should block explicit identically keyed requests (Header idempotency)', async () => {
        req.headers['x-idempotency-key'] = 'unique-elec-uuid';

        prisma.transaction.findFirst.mockResolvedValue({ id: 'txn-old-keyed' });

        await purchaseElectricity(req, res);

        expect(res.statusCode).toBe(409);
        expect(res._getJSONData().message).toContain('has already been processed');
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
