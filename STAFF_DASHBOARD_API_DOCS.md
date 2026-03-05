# Staff Dashboard API Documentation

This endpoint provides the comprehensive data required to populate the Staff Dashboard, including user identification, status-based statistics, and recent flight requests.

- **Endpoint**: `GET /api/v1/flights/staff/dashboard`
- **Method**: `GET`
- **Authentication**: Required (Staff JWT)

---

## 🔑 Authentication
Include the Staff JWT in the header:
`Authorization: Bearer <your_staff_jwt>`

---

## 📦 Response Structure

### ✅ Success (200 OK)
The response returns a nested object containing everything needed for the dashboard state.

```json
{
  "status": "OK",
  "data": {
    "user": {
      "fullName": "John Doe",
      "role": "SUPER_ADMIN"
    },
    "stats": {
      "totalRequests": 150,
      "pending": 45,        // FUTURE_HELD
      "awaitingSelection": 30, // OPTIONS_PROVIDED
      "selectionMade": 15,
      "quoted": 20,
      "processing": 10,     // PAID_PROCESSING
      "completed": 25,      // TICKETED
      "cancelled": 5
    },
    "requests": [
      {
        "id": "uuid-string",
        "origin": "LOS",
        "destination": "LHR",
        "tripType": "ONE_WAY",
        "targetDate": "2026-05-15T10:00:00.000Z",
        "status": "FUTURE_HELD",
        "adults": 1,
        "children": 0,
        "infants": 0,
        "user": {
          "fullName": "User Name",
          "email": "user@example.com",
          "phoneNumber": "+234..."
        },
        "createdAt": "2026-03-03T23:00:00.000Z"
      }
    ]
  }
}
```

### 📋 Field Explanations

| Path | Description |
| :--- | :--- |
| `data.user` | The currently logged-in staff member's info. Use the `role` to show/hide the "Manage Staff" button. |
| `data.stats` | Counters for each status. Map these to your `StatsCards` component. |
| `data.requests` | An array of the 15 most recently created flight requests, including joined user details. |

---

## ❌ Error Responses

### 🔒 401 Unauthorized
Returned if the token is missing, expired, or doesn't belong to a staff member.
```json
{
  "status": "ERROR",
  "message": "Access denied. Not authorized as staff."
}
```

### ❌ 500 Internal Server Error
Returned if there is a database failure or unexpected error.
```json
{
  "status": "ERROR",
  "message": "Failed to fetch dashboard data"
}
```
