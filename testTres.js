import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// ─────────────────────────────────────────
// Custom Metrics
// ─────────────────────────────────────────
const loginSuccess = new Rate('login_success_rate');
const purchaseFail = new Counter('purchase_failures');
const walletFundTime = new Trend('wallet_fund_duration');
const txDuration = new Trend('transaction_duration');

// ─────────────────────────────────────────
// Test Configuration
// ─────────────────────────────────────────
export const options = {
    scenarios: {
        // Scenario 1: Ramp up and sustain load (auth-heavy flow)
        auth_flow: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 20 }, // ramp up to 20 concurrent users
                { duration: '1m', target: 50 }, // sustain 50 users for 1 minute
                { duration: '30s', target: 100 }, // push to 100 users
                { duration: '1m', target: 100 }, // sustain peak
                { duration: '30s', target: 0 }, // ramp down
            ],
            exec: 'authFlowScenario',
        },

        // Scenario 2: Spike test for transactions
        transaction_spike: {
            executor: 'ramping-arrival-rate',
            startRate: 5,
            timeUnit: '1s',
            preAllocatedVUs: 50,
            maxVUs: 200,
            stages: [
                { duration: '30s', target: 10 }, // 10 req/s
                { duration: '30s', target: 50 }, // spike to 50 req/s
                { duration: '30s', target: 5 }, // recover
            ],
            exec: 'transactionScenario',
            startTime: '3m', // start after auth scenario has warmed up
        },
    },

    thresholds: {
        // 95% of all requests must complete under 2s
        http_req_duration: ['p(95)<2000'],
        // Login endpoint must be fast
        'http_req_duration{name:login}': ['p(95)<800'],
        // Transaction endpoints under 3s (provider calls are slow)
        'http_req_duration{name:buy_airtime}': ['p(95)<3000'],
        'http_req_duration{name:buy_data}': ['p(95)<3000'],
        'http_req_duration{name:buy_electricity}': ['p(95)<3000'],
        // Error rate under 5%
        http_req_failed: ['rate<0.05'],
        // Custom metrics
        login_success_rate: ['rate>0.95'],
        transaction_duration: ['p(90)<3500'],
    },
};

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────
const BASE_URL = 'https://api.muftipay.com';
const API = `${BASE_URL}/api/v1`;

// Nigerian phone numbers for testing (realistic format)
const TEST_PHONES = [
    '08011111111', '08022222222', '08033333333',
    '08044444444', '08055555555', '08066666666',
];

// Idempotency helper — unique per VU per iteration
function idempotencyKey() {
    return `k6-${__VU}-${__ITER}-${Date.now()}`;
}

function randomPhone() {
    return TEST_PHONES[Math.floor(Math.random() * TEST_PHONES.length)];
}

function randomNetwork() {
    return ['MTN', 'GLO', 'AIRTEL', '9MOBILE'][Math.floor(Math.random() * 4)];
}

const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'x-load-test-key': __ENV.LOAD_TEST_KEY || 'k6-secret-key',
};

function authHeaders(token) {
    return {
        ...JSON_HEADERS,
        'Authorization': `Bearer ${token}`,
    };
}

// ─────────────────────────────────────────
// Auth Helpers
// ─────────────────────────────────────────

/**
 * Register a virtual user unique to this VU + iteration.
 * Returns { email, password } or null on failure.
 */
function registerUser() {
    const username = `k6_vu${__VU}_it${__ITER}`;
    const password = 'K6Test@12345!';
    const email = `${username}@k6test.com`;
    const payload = JSON.stringify({
        userName: username,
        email: email,
        phoneNumber: `0803${String(__VU).padStart(3, '0')}${String(__ITER % 9999).padStart(4, '0')}`,
        password: password,
        transactionPin: '1234',
    });

    const res = http.post(`${API}/auth/register`, payload, {
        headers: JSON_HEADERS,
        tags: { name: 'register' },
    });

    // Handle 201 Created or 409 Conflict (already exists)
    const ok = check(res, {
        'register: success or conflict': (r) => [201, 409].includes(r.status),
    });

    if (!ok) {
        console.error(`Register failed: ${res.status} ${res.body}`);
        return null;
    }

    return { email, password };
}

/**
 * Login and return the access token, or null on failure.
 */
function login(email, password) {
    const res = http.post(`${API}/auth/login`, JSON.stringify({ email, password }), {
        headers: JSON_HEADERS,
        tags: { name: 'login' },
    });

    const ok = check(res, {
        'login: status 200': (r) => r.status === 200,
        'login: returns accessToken': (r) => {
            try { return r.json('accessToken') !== undefined; } catch (e) { return false; }
        },
    });

    loginSuccess.add(ok ? 1 : 0);
    if (!ok) {
        console.error(`Login failed for ${email}: ${res.status} ${res.body}`);
        return null;
    }
    return res.json('accessToken');
}

/**
 * Refresh session tokens.
 */
function refreshToken(refreshTok) {
    const res = http.post(`${API}/auth/refresh`, JSON.stringify({ refreshToken: refreshTok }), {
        headers: JSON_HEADERS,
        tags: { name: 'refresh_token' },
    });
    check(res, { 'refresh: status 200': (r) => r.status === 200 });
    return res.json('accessToken');
}

// ─────────────────────────────────────────
// User / Dashboard Helpers
// ─────────────────────────────────────────

function getProfile(token) {
    const res = http.get(`${API}/user/profile`, {
        headers: authHeaders(token),
        tags: { name: 'get_profile' },
    });
    check(res, {
        'profile: status 200': (r) => r.status === 200,
        'profile: has walletBalance': (r) => r.json('data.walletBalance') !== undefined,
    });
    return res;
}

function getDashboard(token) {
    const res = http.get(`${API}/user/dashboard`, {
        headers: authHeaders(token),
        tags: { name: 'get_dashboard' },
    });
    check(res, { 'dashboard: status 200': (r) => r.status === 200 });
    return res;
}

function getTransactionHistory(token) {
    const res = http.get(`${API}/user/transactions?page=1&limit=10`, {
        headers: authHeaders(token),
        tags: { name: 'transaction_history' },
    });
    check(res, { 'txn history: status 200': (r) => r.status === 200 });
    return res;
}

// ─────────────────────────────────────────
// Transaction Helpers
// ─────────────────────────────────────────

function buyAirtime(token) {
    const start = Date.now();
    const network = randomNetwork();
    const phone = randomPhone();

    const res = http.post(`${API}/vtu/airtime`, JSON.stringify({
        network,
        amount: 100,
        phoneNumber: phone,
        transactionPin: '1234',
    }), {
        headers: {
            ...authHeaders(token),
            'x-idempotency-key': idempotencyKey(),
        },
        tags: { name: 'buy_airtime' },
    });

    txDuration.add(Date.now() - start);

    const ok = check(res, {
        'airtime: no 500': (r) => r.status !== 500,
        'airtime: 200 or 202': (r) => [200, 202, 402, 409].includes(r.status),
        'airtime: returns status': (r) => r.json('status') !== undefined,
    });

    if (!ok) purchaseFail.add(1);
    return res;
}

function buyData(token) {
    const start = Date.now();
    const network = randomNetwork();

    // Map network to a valid plan ID per vtpassProvider DATA_SERVICE_IDS
    const planMap = {
        MTN: 'mtn-10mb-100',
        GLO: 'glo-sme-5mb',
        AIRTEL: 'airtel-100mb',
        '9MOBILE': 'etisalat-500mb',
    };

    const res = http.post(`${API}/vtu/data`, JSON.stringify({
        network,
        planId: planMap[network] || 'mtn-10mb-100',
        phoneNumber: randomPhone(),
        transactionPin: '1234',
    }), {
        headers: {
            ...authHeaders(token),
            'x-idempotency-key': idempotencyKey(),
        },
        tags: { name: 'buy_data' },
    });

    txDuration.add(Date.now() - start);

    const ok = check(res, {
        'data: no 500': (r) => r.status !== 500,
        'data: expected status': (r) => [200, 202, 402, 404, 409].includes(r.status),
    });

    if (!ok) purchaseFail.add(1);
    return res;
}

function getDataPlans(token) {
    const res = http.get(`${API}/vtu/data/plans`, {
        headers: authHeaders(token),
        tags: { name: 'get_data_plans' },
    });
    check(res, { 'data plans: status 200': (r) => r.status === 200 });
    return res;
}

function getCablePackages() {
    // Public endpoint, no auth needed
    const res = http.get(`${API}/cable/packages`, {
        tags: { name: 'get_cable_packages' },
    });
    check(res, { 'cable packages: status 200': (r) => r.status === 200 });
    return res;
}

function getElectricityDiscos() {
    const res = http.get(`${API}/electricity/disco`, {
        tags: { name: 'get_discos' },
    });
    check(res, { 'discos: status 200': (r) => r.status === 200 });
    return res;
}

function buyElectricity(token) {
    const start = Date.now();

    const res = http.post(`${API}/electricity/pay`, JSON.stringify({
        discoCode: '02',  // Ikeja Electric (IKEDC)
        meterNo: '1111111111111',  // VTPass test meter
        meterType: '01',  // prepaid
        amount: 5000,
        transactionPin: '1234',
    }), {
        headers: {
            ...authHeaders(token),
            'x-idempotency-key': idempotencyKey(),
        },
        tags: { name: 'buy_electricity' },
    });

    txDuration.add(Date.now() - start);

    const ok = check(res, {
        'electricity: no 500': (r) => r.status !== 500,
        'electricity: expected status': (r) => [200, 202, 402, 409].includes(r.status),
    });

    if (!ok) purchaseFail.add(1);
    return res;
}

function initWalletFunding(token) {
    const start = Date.now();

    const res = http.post(`${API}/payment/fund/init`, JSON.stringify({ amount: 5000 }), {
        headers: authHeaders(token),
        tags: { name: 'init_wallet_fund' },
    });

    walletFundTime.add(Date.now() - start);

    check(res, {
        'wallet fund: status 200': (r) => r.status === 200,
        'wallet fund: has account': (r) => r.json('accountNumber') !== undefined,
    });

    return res;
}

// ─────────────────────────────────────────
// Idempotency Abuse Test
// Verifies the API correctly returns 409 on duplicate within 60s
// ─────────────────────────────────────────
function testIdempotency(token) {
    const key = `idem-test-${__VU}-${__ITER}`;
    const body = JSON.stringify({
        network: 'MTN',
        amount: 100,
        phoneNumber: '08011111111',
        transactionPin: '1234',
    });

    // First request
    const r1 = http.post(`${API}/vtu/airtime`, body, {
        headers: { ...authHeaders(token), 'x-idempotency-key': key },
        tags: { name: 'idempotency_first' },
    });

    // Immediate duplicate — should be 409
    const r2 = http.post(`${API}/vtu/airtime`, body, {
        headers: { ...authHeaders(token), 'x-idempotency-key': key },
        tags: { name: 'idempotency_duplicate' },
    });

    check(r2, {
        'idempotency: duplicate returns 409': (r) => r.status === 409,
    });
}

// ─────────────────────────────────────────
// Token Rotation Test
// Verifies concurrent refresh calls are handled gracefully
// ─────────────────────────────────────────
function testTokenRotation(accessToken, refreshTok) {
    // Fire 3 concurrent refresh requests (simulates multi-tab scenario)
    const responses = http.batch([
        ['POST', `${API}/auth/refresh`, JSON.stringify({ refreshToken: refreshTok }), { headers: JSON_HEADERS, tags: { name: 'concurrent_refresh' } }],
        ['POST', `${API}/auth/refresh`, JSON.stringify({ refreshToken: refreshTok }), { headers: JSON_HEADERS, tags: { name: 'concurrent_refresh' } }],
        ['POST', `${API}/auth/refresh`, JSON.stringify({ refreshToken: refreshTok }), { headers: JSON_HEADERS, tags: { name: 'concurrent_refresh' } }],
    ]);

    const successCount = responses.filter(r => r.status === 200).length;

    // At least one should succeed (grace period logic in refresh.js allows this)
    check(responses[0], {
        'token rotation: at least one succeeds': () => successCount >= 1,
        'token rotation: no hard failures': () => responses.every(r => r.status !== 500),
    });
}

// ─────────────────────────────────────────
// SCENARIO 1: Full Auth + Browse + Transact
// ─────────────────────────────────────────
export function authFlowScenario() {
    group('Registration & Login', () => {
        const creds = registerUser();
        if (!creds) return;
        sleep(0.5);

        const token = login(creds.email, creds.password);
        if (!token) return;
        sleep(0.3);

        group('Dashboard Browsing', () => {
            getProfile(token);
            sleep(0.2);
            getDashboard(token);
            sleep(0.2);
            getTransactionHistory(token);
            sleep(0.2);

            // Public catalog fetches (cached by Redis, very fast)
            getDataPlans(token);
            getCablePackages();
            getElectricityDiscos();
            sleep(0.3);
        });

        group('Wallet Funding Init', () => {
            initWalletFunding(token);
            sleep(0.5);
        });

        group('VTU Transactions', () => {
            // Light transaction sampling — not every VU buys everything
            const roll = Math.random();
            if (roll < 0.4) {
                buyAirtime(token);
                sleep(1);
            } else if (roll < 0.7) {
                buyData(token);
                sleep(1);
            } else if (roll < 0.9) {
                buyElectricity(token);
                sleep(1);
            }
        });
    });

    sleep(1); // Think time between iterations
}

// ─────────────────────────────────────────
// SCENARIO 2: Transaction Spike (assumes pre-seeded tokens)
// For a real spike test, set PRE_SEEDED_TOKEN env var to skip registration.
// ─────────────────────────────────────────
export function transactionScenario() {
    const preseededToken = __ENV.PRE_SEEDED_TOKEN;
    let token = preseededToken;

    if (!token) {
        const creds = registerUser();
        if (!creds) { sleep(1); return; }
        token = login(creds.email, creds.password);
        if (!token) { sleep(1); return; }
    }

    // During spike: randomly distribute load across transaction types
    const roll = Math.random();
    if (roll < 0.5) {
        buyAirtime(token);
    } else if (roll < 0.75) {
        buyData(token);
    } else if (roll < 0.9) {
        buyElectricity(token);
    } else {
        // Test idempotency under load
        testIdempotency(token);
    }

    sleep(0.5);
}

// ─────────────────────────────────────────
// SCENARIO 3: Smoke Test (single VU sanity check)
// Run with: k6 run --env SCENARIO=smoke muftipay_load_test.js
// ─────────────────────────────────────────
export default function smokeTest() {
    if (__ENV.SCENARIO === 'smoke') {
        group('Smoke: Full happy path', () => {
            const creds = registerUser();
            if (!creds) {
                console.error("Smoke test failed: registration failed");
                return;
            }

            const loginRes = http.post(`${API}/auth/login`, JSON.stringify({
                email: creds.email, password: creds.password,
            }), { headers: JSON_HEADERS, tags: { name: 'login' } });

            const loginOk = check(loginRes, { 'smoke login ok': r => r.status === 200 });
            if (!loginOk) {
                console.error(`Smoke test failed: login status ${loginRes.status}`);
                return;
            }

            let token, refreshTok;
            try {
                token = loginRes.json('accessToken');
                refreshTok = loginRes.json('refreshToken');
            } catch (e) {
                console.error("Smoke test failed: could not parse tokens");
                return;
            }

            getProfile(token);
            getDashboard(token);
            getDataPlans(token);
            getCablePackages();
            getElectricityDiscos();
            initWalletFunding(token);

            // Token rotation sanity
            if (refreshTok) testTokenRotation(token, refreshTok);
        });
    }
}