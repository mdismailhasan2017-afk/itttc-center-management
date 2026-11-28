# Security Specification — ITTC Center Management System

## 1. Data Invariants
1. All workspace documents and subcollections belong to a parent `/centers/{centerId}` with an immutable `ownerId` matching the authenticated creator's UID (`request.auth.uid`).
2. Every subcollection document (`students`, `jobs`, `outs`, `staff`, `companies`, `store`, `prices`, `returns`, `cash`, `docs`) enforces the Master Gate via `get(/databases/$(database)/documents/centers/$(centerId)).data.ownerId == request.auth.uid` on single-document operations (`get`, `create`, `update`, `delete`), and enforces `resource.data.ownerId == request.auth.uid` on `list` queries without `get()` or `exists()` calls inside `allow list`.
3. Every user must have `request.auth != null && request.auth.token.email_verified == true` for writes and reads.
4. All document IDs (`centerId`, `studentId`, `jobId`, etc.) must match `^[a-zA-Z0-9_\-]+$` and be at most 128 characters.
5. `createdAt` and `updatedAt` timestamps must match `request.time`; `createdAt` and `ownerId` are immutable on update.
6. User PII (`email`) is isolated in `/users/{userId}/private/info` and restricted strictly to the owner (`userId == request.auth.uid`) or verified admin.
7. Non-admin users cannot self-assign `role: "admin"` on `/users/{userId}` or write to `/admins/{userId}`.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Student Read/Write**: Unauthenticated client attempts to read/create `/centers/center_1/students/stu_1` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Signed-in user with `email: "mdismailhasan2017@gmail.com"` and `email_verified: false` attempts admin/center write -> `PERMISSION_DENIED`.
3. **Cross-Tenant Student Creation**: Attacker `uid: "attacker"` creates `/centers/victim_center/students/stu_1` with `ownerId: "attacker"` -> `PERMISSION_DENIED` (Master Gate checks `centers/victim_center.ownerId`).
4. **Cross-Tenant List Scraping**: Attacker calls `list` on `/centers/victim_center/students` without `where('ownerId', '==', 'attacker')` -> `PERMISSION_DENIED` (`resource.data.ownerId == request.auth.uid` fails).
5. **Shadow / Ghost Field Injection**: Owner creates a student with an extra undocumented key `{ ..., isApproved: true }` -> `PERMISSION_DENIED` (`keys().hasOnly(...)` rejects shadow keys).
6. **Privilege Escalation in User Profile**: User creates `/users/{uid}` with `role: "admin"` -> `PERMISSION_DENIED`.
7. **Admin Collection Tampering**: Non-admin user writes `/admins/{uid}` -> `PERMISSION_DENIED`.
8. **ID Poisoning (1.5KB / Invalid Chars)**: User creates `/centers/center_1/jobs/../../etc` or 200-char ID -> `PERMISSION_DENIED` (`isValidId` rejects).
9. **Value Poisoning / Type Mismatch**: Owner updates student `contract` with a string `"free"` or negative number `-500` -> `PERMISSION_DENIED` (`isValidStudent` rejects).
10. **Immutable Owner Swap**: Owner attempts to update `ownerId` on an existing `JobEntry` -> `PERMISSION_DENIED` (`incoming().ownerId == existing().ownerId`).
11. **Timestamp Forgery**: Owner creates a `CashEntry` with `createdAt` set to a client-chosen past timestamp instead of `serverTimestamp()` -> `PERMISSION_DENIED` (`incoming().createdAt == request.time`).
12. **PII Cross-User Read**: Authenticated user B attempts `get` on `/users/userA/private/info` -> `PERMISSION_DENIED`.
