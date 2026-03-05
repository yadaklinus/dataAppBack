# Detailed Staff Authentication Documentation

This document provides the full technical specification for the Staff Login and Mandatory Password Reset endpoints.

---

## 1. Staff Login
Authenticates a staff member and checks if they need to reset their password.

- **Endpoint**: `POST /api/v1/auth/staff/login`
- **Authentication**: None (Public)

### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `email` | String | Yes | Valid email address of the staff member. |
| `password` | String | Yes | Minimum 6 characters. |

### Possible Responses

#### ✅ 200 OK: Login Successful
Returned when the user provides correct credentials and has already changed their default password.
```json
{
  "status": "OK",
  "message": "Login successful",
  "data": {
    "token": "JWT_ACCESS_TOKEN_HERE",
    "user": {
      "id": "uuid-string",
      "email": "staff@example.com",
      "fullName": "John Doe",
      "role": "TICKETING_OFFICER"
    }
  }
}
```

#### 🔒 403 Forbidden: Force Reset Required
Returned when the credentials are correct, but the staff member is logging in for the first time with a default password.
```json
{
  "status": "FORCE_RESET_REQUIRED",
  "message": "This is your first login. You must change your default password.",
  "data": {
    "email": "staff@example.com"
  }
}
```

#### ❌ 401 Unauthorized: Invalid Credentials
Returned if the email/password combination is wrong or the account is marked as inactive.
```json
{
  "status": "ERROR",
  "message": "Invalid credentials or inactive account."
}
```

#### ⚠️ 400 Bad Request: Validation Error
Returned if the input does not match the required format (e.g., invalid email).
```json
{
  "status": "ERROR",
  "message": "Invalid email format"
}
```

---

## 2. Force Password Reset
Required for new staff members to set their own secure password before accessing the system.

- **Endpoint**: `POST /api/v1/auth/staff/force-reset`
- **Authentication**: None (Requires previous temporary password)

### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `email` | String | Yes | Valid email address. |
| `oldPassword` | String | Yes | The current temporary/default password. |
| `newPassword` | String | Yes | Minimum 8 characters. Must be different from the old password. |

### Possible Responses

#### ✅ 200 OK: Password Changed
The password has been updated, the `requiresPasswordChange` flag is cleared, and a session token is issued.
```json
{
  "status": "OK",
  "message": "Password changed successfully. You are now logged in.",
  "data": {
    "token": "JWT_ACCESS_TOKEN_HERE",
    "user": {
      "id": "uuid-string",
      "email": "staff@example.com",
      "fullName": "John Doe",
      "role": "TICKETING_OFFICER"
    }
  }
}
```

#### ❌ 400 Bad Request: Reset Already Done
Returned if the user tries to call this endpoint after they have already successfully reset their password.
```json
{
  "status": "ERROR",
  "message": "Password has already been reset."
}
```

#### ❌ 400 Bad Request: Passwords Match
Returned if the user tries to set their new password the same as their old/temporary one.
```json
{
  "status": "ERROR",
  "message": "New password cannot be the same as the default password."
}
```

#### ❌ 401 Unauthorized: Invalid Old Password
Returned if the `oldPassword` provided does not match the one in the database.
```json
{
  "status": "ERROR",
  "message": "Invalid old password."
}
```

#### ❌ 401 Unauthorized: Account Not Found
Returned if the email provided does not exist in the staff table.
```json
{
  "status": "ERROR",
  "message": "Account not found."
}
```

#### ⚠️ 400 Bad Request: Validation Error
Returned if the new password is too short (less than 8 characters).
```json
{
  "status": "ERROR",
  "message": "New password must be at least 8 characters"
}
```
