# Candidate Retrieval QA Report

## Best Case Scenario (Successful Execution)
- **Scenario ID:** TS-CAND-01
- **Test Case ID:** TC-CAND-001
- **Testing Type:** Integration Testing
- **Objective:** Verify candidate list loads dynamically based on a valid constituency code.
- **Preconditions:** Constituency `CON-01` exists in the database with assigned candidates.
- **Test Data:** Constituency Code = `CON-01`
- **Test Steps:**
  1. Send GET request to `/candidates?constituency=CON-01`.
- **Expected Result:** API should return a JSON response containing an array of candidate objects, all of which must have `constituency_code: "CON-01"`.
- **Actual Result:** API successfully returned 6 valid candidates (Ayesha Rahman, Fatima Begum, Karim Hossain, Mahmudul Hasan, Rafiq Uddin, Selina Hayat). All returned records strictly belonged to `CON-01`.
- **PASS/FAIL:** ✅ PASS
- **Evidence:** 
  - **API Endpoint Called:** `GET http://localhost:3000/candidates?constituency=CON-01`
  - **Response Status Code:** `200 OK`
- **Notes:** Database filtering by constituency code functions exactly as designed.

## Worst Case Scenario (Invalid or Misuse Scenario)
- **Scenario ID:** TS-CAND-02
- **Test Case ID:** TC-CAND-002
- **Testing Type:** Functional Testing (Negative)
- **Objective:** Verify the system handles malformed constituency parameters safely.
- **Preconditions:** Backend API is running.
- **Test Data:** Constituency Code = `INVALID-99`
- **Test Steps:**
  1. Send GET request to `/candidates?constituency=INVALID-99`.
- **Expected Result:** The system should return an appropriate error message and safely reject the malformed query string.
- **Actual Result:** The backend correctly intercepted the invalid format and returned an explicit validation error message.
- **PASS/FAIL:** ✅ PASS
- **Evidence:** 
  - **API Endpoint Called:** `GET http://localhost:3000/candidates?constituency=INVALID-99`
  - **Response Status Code:** `400 Bad Request`
  - **Response Payload:** `{"error": "Invalid constituency format. Expected CON-XX (e.g. CON-01)"}`
- **Notes:** Proper API input validation is active and functional.

## Worst Case Scenario (Missing Parameter)
- **Scenario ID:** TS-CAND-03
- **Test Case ID:** TC-CAND-003
- **Testing Type:** Security/Tamper-Resistance Testing
- **Objective:** Ensure the API blocks unfiltered queries when the required parameter is omitted.
- **Preconditions:** Backend API is running.
- **Test Data:** None
- **Test Steps:**
  1. Send GET request to `/candidates` without query parameters.
- **Expected Result:** The API must require the constituency parameter and block unfiltered queries to protect the database from mass-dumping.
- **Actual Result:** The backend safely blocked the request and prompted for the missing parameter.
- **PASS/FAIL:** ✅ PASS
- **Evidence:** 
  - **API Endpoint Called:** `GET http://localhost:3000/candidates`
  - **Response Status Code:** `400 Bad Request`
  - **Response Payload:** `{"error": "Missing required query parameter: constituency"}`
- **Notes:** Safe fallback prevents global candidate dumping.
