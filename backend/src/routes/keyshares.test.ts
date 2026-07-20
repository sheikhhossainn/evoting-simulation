import http from 'http';

const ADMIN_SECRET = "4c279b96c48b0ca27ebafc1c8a00417d5badbed62d2f3b98f1404fc54dd16998";

function request(options: any, postData?: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function run() {
    console.log("1. Checking keyshares status...");
    const statusRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/keyshares/status?election_id=NATIONAL-2026-001',
        method: 'GET'
    });
    console.log("Keyshares status:", statusRes.data);

    console.log("\n2. Testing /keyshares/tally...");
    const tallyRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/keyshares/tally',
        method: 'POST',
        headers: { 
            'x-admin-secret': ADMIN_SECRET,
            'Content-Type': 'application/json'
        }
    }, JSON.stringify({ election_id: 'NATIONAL-2026-001' }));
    
    console.log("Tally Status Code:", tallyRes.status);
    if (tallyRes.data && tallyRes.data.results) {
        console.log("Tally Result Summary Data:");
        console.log(JSON.stringify(tallyRes.data.results, null, 2));
    } else {
        console.log("Tally Data:", tallyRes.data);
    }

    console.log("\n3. Testing Public Stats (Watchdog endpoint) /public/stats...");
    const publicRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/public/stats?election_id=NATIONAL-2026-001',
        method: 'GET'
    });
    console.log("Public Stats Response Status:", publicRes.status);
    console.log("Public Stats Data:");
    console.log(JSON.stringify(publicRes.data, null, 2));

    const candKeys = Object.keys(publicRes.data).some(key => {
        if (typeof publicRes.data[key] === 'object') {
             return JSON.stringify(publicRes.data[key]).includes('candidates');
        }
        return false;
    });
    console.log("\nAre per-candidate results exposed? ", candKeys || JSON.stringify(publicRes.data).includes('candidate'));
}

run();
