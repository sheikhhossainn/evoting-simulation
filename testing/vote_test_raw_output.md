# Section 4 & 5 Adversarial Test Report

## 4. Vote Casting Adversarial Tests

### Unregistered Voter
- **Expected**: 404
- **Actual**: 404
- **Evidence**: `{"error":"Voter not registered"}`
- **Status**: ✅ PASS

### Ineligible Voter
- **Expected**: 403
- **Actual**: 403
- **Evidence**: `{"error":"Voter is not eligible to vote"}`
- **Status**: ✅ PASS

### Malformed Payload
- **Expected**: 400
- **Actual**: 400
- **Evidence**: `{"error":[{"expected":"string","code":"invalid_type","path":["encrypted_vote","c2"],"message":"Invalid input: expected string, received undefined"}]}`
- **Status**: ✅ PASS

### Concurrent Double-Cast
- **Expected**: Exactly one success (201), exactly one rejection (409/403)
- **Race 1 Actual**: 201 - `{"status":"queued","vote_id":"a89ed31b-99f2-44d2-8656-19594c628070"}`
- **Race 2 Actual**: 409 - `{"error":"You have already voted"}`
- **Vote Row Count**: 1 (Expected exactly 1)
- **Status**: ✅ PASS

### Direct SQL UPDATE Immutability
- **Expected**: Error from trigger
- **Actual Error**: `{"code":"P0001","details":null,"hint":null,"message":"encrypted_vote is immutable after insertion"}`
- **Status**: ✅ PASS

## 5. Nullifier Redesign Checks

### Client-Side Nullifier Formula vs Server
- **Old Formula (SHA256(nid+electionId))**: `94acdaf62e6e75f039d05ee24d05cbaf1e89b1385192cc42f95e92a884c4903f`
- **New Server-Side (with salt)**: `953013a6416ef35230b6ed5674868dd587132070bd6b705fe4ee30d77c011f69`
- **Match Status**: They do NOT match
- **Status**: ✅ PASS

### Raw `nid_hash` column absence
- **Columns from query**: id, encrypted_vote, zkp_proof, tx_hash, status, created_at, updated_at, nullifier_hash, constituency_code
- **Contains raw nid_hash?**: false
- **Status**: ✅ PASS

