# Live Test Checklist

## TASK 1 — Share Button Permission
1. Login as VIEWER role
2. Open any report
3. Confirm Share button is NOT visible
   (viewer doesn't have reports:share)
4. Login as RADIOLOGIST role
5. Open same report
6. Confirm Share button IS visible
7. Click Share — confirm it works

**PASS criteria:** Button hidden for viewer, visible and working for radiologist

---

## TASK 2 — STAT Priority Badge
1. Login as ADMIN
2. Create a new order with priority STAT
3. Login as RADIOGRAPHER
4. Open worklist
5. Confirm STAT order shows RED badge
6. Confirm STAT order is sorted to TOP
7. Click STAT filter button
8. Confirm only STAT orders show

**PASS criteria:** Red badge visible, sorted to top, filter works

---

## TASK 3 — Audit Dashboard
1. Login as ADMIN or SUPER ADMIN
2. Go to Admin Dashboard
3. Click Audit Log tab
4. Confirm table shows entries with:
   - Timestamp
   - User name
   - Action
   - Patient (if any)
5. Try date filter
6. Try role filter

**PASS criteria:** Real audit entries visible, filters work

---

## TASK 4 — TAT Per Radiologist
1. Login as ADMIN
2. Go to Admin Dashboard
3. Click Radiologist Performance tab
4. Confirm table shows:
   - Radiologist names
   - Assigned count
   - Completed count
   - Average TAT in hours
   - Color coding (green/orange/red)

**PASS criteria:** Table shows real data, colors show correctly

---

## TASK 5 — Overdue Payments
1. Login as BILLING role
2. Go to Billing Dashboard
3. Click Overdue tab
4. Confirm table shows invoices older than 30 days
5. Click Send Reminder on one invoice
6. Confirm success message

**PASS criteria:** Overdue tab visible, reminder button works

---

## TASK 6 — Critical Findings Alert
1. Login as RADIOLOGIST
2. Open any study report
3. Set priority to CRITICAL
4. Save the report
5. Check bell icon in top navbar
6. Confirm red badge appears
7. Click bell icon
8. Confirm notification shows:
   "Critical Finding — Patient X"
9. Click notification
10. Confirm it opens the correct report
11. Login as ADMIN
12. Confirm admin also sees the notification

**PASS criteria:** Bell shows badge, notification appears for both radiologist and admin

---

## Firestore Index Note
The required composite indexes (notifications by target_roles+created_at, audit log by userId/action/resourceType/severity/tenantId + timestamp) are now predefined in `packages/reporting-app/backend/firestore.indexes.json`. Deploy them ahead of time with:
```
firebase deploy --only firestore:indexes --project ris-pacs-client
```
If Task 6 still throws an error about "requires an index" — copy the URL from the error message, open it in browser, click Create Index, wait 2 minutes, then retry.
