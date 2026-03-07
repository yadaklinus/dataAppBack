// Mock for vtpassProvider.js

module.exports = {
    fetchDataPlans: jest.fn(),
    fetchAllDataPlansMapped: jest.fn(),
    buyData: jest.fn(),
    queryTransaction: jest.fn(),

    // You can add mocks for other services (airtime, cable, etc.) as needed:
    buyAirtime: jest.fn(),
    verifySmartCard: jest.fn(),
    fetchCablePackages: jest.fn(),
    buyCableTV: jest.fn(),
    verifyMeter: jest.fn(),
    payElectricityBill: jest.fn()
};
