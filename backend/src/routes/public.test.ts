import http from 'http';

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
    console.log("Testing Public Stats (Watchdog endpoint) /public/stats...");
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
