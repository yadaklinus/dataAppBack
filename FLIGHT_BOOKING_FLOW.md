# Flight Booking Status Flow Documentation

This document explains the step-by-step lifecycle of a Flight Booking Request in the system. It outlines exactly what state the request is in, what data is required, and whose responsibility it is to move the request to the next state.

## 1. Request Initiated
**Status:** `FUTURE_HELD` (or `PENDING`)
- **Who Triggers This:** **User**
- **Action Required by User:** Submits the initial flight request.
- **Data Required from User:** Origin, Destination, Target Date, Return Date (if Round Trip), Trip Type, Flight Class, and Number of Passengers (Adults, Children, Infants).
- **Backend Route:** `POST /api/v1/flights/user/request`
- **What Happens:** The flight request is created in the database and sits waiting for a Ticketing Staff to review it.
- **Pending Action:** **Staff** must manually search for flight options on their GDS (Amadeus/Sabre/Etc).

## 2. Staff Provides Options
**Status transitions to:** `OPTIONS_PROVIDED`
- **Who Triggers This:** **Staff** (Ticketing Officer / Super Admin)
- **Action Required by Staff:** The staff reviews the user's origin/destination/dates, finds actual flight operations, and provides a list of selectable choices for the user.
- **Data Required from Staff:** An array of `flightOptions` containing: `id`, `airline`, `date`, `time`, and `estPrice` (Estimated Price).
- **Backend Route:** `POST /api/v1/flights/staff/:id/options`
- **What Happens:** The flight request state changes. The user can now see actual selectable options and estimated prices on their dashboard.
- **Pending Action:** **User** must choose one of the options and provide passenger info.

## 3. User Makes a Selection
**Status transitions to:** `SELECTION_MADE`
- **Who Triggers This:** **User**
- **Action Required by User:** The user selects one of the flight options provided by the staff and fills out the actual details of the people flying.
- **Data Required from User:** The `selectedOptionId` and an array of `passengers` including Title, First Name, Last Name, Date of Birth, and Gender for each pax.
- **Backend Route:** `POST /api/v1/flights/user/:id/select`
- **What Happens:** The flight option is locked-in, and the exact names/DOBs required to book the ticket are saved.
- **Pending Action:** **Staff** must go to their booking system, hold a real seat using the exact passenger details, and get a Booking Reference (PNR).

## 4. Staff Quotes the Seat
**Status transitions to:** `QUOTED`
- **Who Triggers This:** **Staff**
- **Action Required by Staff:** The staff places the actual booking on hold via their GDS. They get a PNR and the exact, final price from the airline.
- **Data Required from Staff:** `airlineName`, `pnr` (Booking Reference), `ticketingTimeLimit` (the exact date/time the airline will auto-cancel the unpaid booking), `netCost` (cost price), and `sellingPrice` (the final price the user must pay).
- **Backend Route:** `POST /api/v1/flights/staff/:id/quote`
- **What Happens:** The user is alerted with a flashing/urgent prompt that their seat is locked but must be paid for immediately before the `ticketingTimeLimit` (TTL).
- **Pending Action:** **User** must pay the `sellingPrice` from their wallet before the TTL expires.

## 5. User Pays for the Ticket
**Status transitions to:** `PAID_PROCESSING`
- **Who Triggers This:** **User**
- **Action Required by User:** Clicks "Pay with Wallet" to finalize the booking.
- **Data Required from User:** None directly on this endpoint—but they must have sufficient funds in their wallet.
- **Backend Route:** `POST /api/v1/flights/user/:id/pay`
- **What Happens:** The `sellingPrice` is securely deducted from the user's wallet. A Flight Transaction record is created. The status changes to `PAID_PROCESSING`.
- **Pending Action:** **Staff** must log back into the airline portal/GDS and hit "Issue Ticket" to finalize the paid purchase and generate the final e-ticket.

## 6. Staff Fulfills the Ticket
**Status transitions to:** `TICKETED`
- **Who Triggers This:** **Staff**
- **Action Required by Staff:** The staff issues the ticket on the GDS, downloads the PDF containing the ticket numbers, and uploads/links it for the user.
- **Data Required from Staff:** An `eTicketUrl` (or string of ticket details).
- **Backend Route:** `POST /api/v1/flights/staff/:id/fulfill`
- **What Happens:** The life-cycle is complete. The user can download their E-Ticket directly from their dashboard and travel.
- **Pending Action:** None. Final state.

---

### Alternative Error/Edge States

- **`EXPIRED`**: If the user fails to pay for a `QUOTED` flight before the `ticketingTimeLimit` passes, the payment endpoint will throw an error and automatically change the status to EXPIRED. The booking is dead, and the user must submit a completely new request.
- **`CANCELLED`**: Cancelled manually by the user or staff before payment.
- **`REFUNDED`**: If a flight was `TICKETED` or `PAID_PROCESSING` but needs to be cancelled and refunded manually by the Admin/Staff.
