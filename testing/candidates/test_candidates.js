const http = require('http');

async function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: path,
        method: 'GET',
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => raw += c);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log("=== TEST 1: Valid Constituency (CON-01) ===");
  let r1 = await get('/candidates?constituency=CON-01');
  console.log("Status Code:", r1.status);
  console.log("Response Body:", JSON.stringify(r1.body, null, 2));
  
  console.log("\n=== TEST 2: Invalid/Unknown Constituency (INVALID-99) ===");
  let r2 = await get('/candidates?constituency=INVALID-99');
  console.log("Status Code:", r2.status);
  console.log("Response Body:", JSON.stringify(r2.body, null, 2));

  console.log("\n=== TEST 3: Missing Constituency Parameter ===");
  let r3 = await get('/candidates');
  console.log("Status Code:", r3.status);
  console.log("Response Body:", JSON.stringify(r3.body, null, 2));
}

runTests();
