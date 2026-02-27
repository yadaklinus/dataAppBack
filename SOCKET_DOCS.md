# Real-Time WebSocket Documentation (Socket.io)

This document outlines how the frontend application should connect to the Socket.io server and the events it should listen for to provide real-time updates for wallet funding and transactions.

## 1. Connection Setup

To establish a WebSocket connection, the frontend client must utilize `socket.io-client` and provide a valid user JWT token for authentication during the initial handshake.

**Connection Endpoint:** `<your-backend-url>`
**Transports:** `websocket`, `polling`

### Frontend Implementation Example:

```javascript
import { io } from "socket.io-client";

// Get token from your storage (localStorage, cookies, generic state, etc.)
const token = "YOUR_JWT_TOKEN"; 

const socket = io("https://your-backend-url.com", {
  auth: {
    token: `Bearer ${token}` // The backend accepts both plain and 'Bearer ' prefixed tokens
  }
});

socket.on("connect", () => {
  console.log("Connected to WebSocket Server:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("Connection failed:", err.message);
  // Example messages: "Authentication Error: Token missing" or "Authentication Error: Invalid or expired token"
});

socket.on("disconnect", () => {
  console.log("Disconnected from WebSocket Server");
});
```

## 2. Rooms & Namespaces

Upon successful authentication, the backend automatically joins the socket connection into a private room named after the verified `userId`. 
**No action is needed from the frontend** for this; it ensures that the user only receives events explicitly intended for them.

---

## 3. Events Emitted by Server (Listen on Frontend)

The backend pushes real-time updates for asynchronous operations via two primary events.

### A. `wallet_funded`
Emitted by the webhook systems (e.g., Paystack hook) when a user's wallet is successfully funded. This typically happens when the user transfers money to their dedicated virtual account (DVA) or pays via card.

**Payload Structure:**
```typescript
{
  amount: number;       // The amount credited to the user's wallet balance
  method: string;       // The payment channel used (e.g., 'paystack', 'bank_transfer')
  reference: string;    // The transaction reference ID for verification
}
```

**Frontend Example:**
```javascript
socket.on("wallet_funded", (data) => {
  console.log(`Wallet credited with ₦${data.amount} via ${data.method}`);
  
  // UI Actions:
  // - Show success toast notification
  // - Trigger a refetch of the user's wallet balance
});
```

### B. `transaction_update`
Emitted automatically when the status of a pending transaction (Airtime, Data, Electricity, Cable, Education Pins) is updated and marked as complete by the provider.

**Payload Structure:**
```typescript
{
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  type: 'DATA' | 'AIRTIME' | 'ELECTRICITY' | 'CABLE' | 'EDUCATION';
  amount: number;       // The cost of the transaction
  reference: string;    // The reference ID matching the original transaction
  metadata?: any;       // Additional data passed down (e.g., planName, tokens, etc.)
}
```

**Frontend Example:**
```javascript
socket.on("transaction_update", (data) => {
  if (data.status === 'SUCCESS') {
    console.log(`${data.type} purchase of ₦${data.amount} was successful!`);
    
    // Check if it's electricity to extract token (example depending on your metadata structure)
    if (data.type === 'ELECTRICITY' && data.metadata?.token) {
       console.log("Meter Token:", data.metadata.token);
    }
    
    // UI Actions:
    // - Show success toast notification
    // - Refresh recent transaction list
  } else if (data.status === 'FAILED') {
    console.error(`Transaction ${data.reference} failed.`);
    // UI Actions: Show error toast indicating refund.
  }
});
```

## 4. Disconnection & Cleanup
When the user logs out or closes the app, ensure the WebSocket connection is disconnected securely.

```javascript
const handleLogout = () => {
  socket.disconnect();
  // ... clear local storage, cookies, etc.
}
```
