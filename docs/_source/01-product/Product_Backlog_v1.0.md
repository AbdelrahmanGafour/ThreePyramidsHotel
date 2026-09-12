---
project: Hotel Reservation System
title: Product Backlog
document_id: PROD-001
version: "1.0"
status: Active
owner: Product
updated: 2026-09-13
toc: true
---

# Document control

| Version | Date | Change | Author |
|---|---|---|---|
| 1.0 | 2026-09-13 | Initial ordered Product Backlog established for V1 and Sprint 1 | Product & Engineering |

# Backlog purpose and operating rules

This document contains the **single ordered Product Backlog** for the Hotel Reservation System. The ordering reflects value, risk, dependency, and learning. It is a living artifact and is expected to change as the team learns; it is not a frozen requirements baseline.

Product Backlog Items (PBIs) represent product outcomes or meaningful capabilities. Implementation tasks such as database setup, API wiring, UI components, tests, and CI work belong in the Sprint Backlog when needed to make a selected PBI Done; they are not separate product backlogs.

Relative sizes use **S / M / L** only where enough information exists. They are not a substitute for team capacity or historical velocity. Sprint 1 has no historical velocity.

## Status vocabulary

- **Draft** - coarse item that is intentionally not ready for near-term selection.
- **Needs Refinement** - important information or acceptance detail is still missing.
- **Ready** - sufficiently understood for Sprint Planning, subject to capacity.
- **In Sprint** - selected into the current Sprint forecast.
- **In Progress** - actively being implemented.
- **Blocked** - cannot proceed without an external dependency or decision.
- **Done** - satisfies the project Definition of Done.

## Readiness vocabulary

- **Ready for Sprint Planning** - acceptance behavior and key constraints are sufficiently clear.
- **Needs Refinement** - more product/technical clarification is needed before selection.
- **Blocked / Decision Required** - an unresolved dependency prevents responsible planning.
- **Later** - intentionally coarse until it approaches implementation.

# Ordered backlog summary

| Order | PBI | Capability / outcome | Priority | Size | Readiness | Status |
|---:|---|---|---|---|---|---|
| 1 | PBI-001 | Guest can browse room types and room details | Critical | M | Ready for Sprint Planning | In Sprint |
| 2 | PBI-002 | Guest can search real room-type availability | Critical | L | Ready for Sprint Planning | In Sprint |
| 3 | PBI-003 | Guest can create a conflict-safe room reservation | Critical | L | Ready for Sprint Planning | In Sprint |
| 4 | PBI-004 | Guest receives a safe booking confirmation view | Critical | S | Ready for Sprint Planning | In Sprint |
| 5 | PBI-005 | Staff can securely sign in and inspect reservations | Critical | L | Ready for Sprint Planning | Ready |
| 6 | PBI-006 | Guest receives reservation confirmation email | High | M | Needs Refinement | Needs Refinement |
| 7 | PBI-007 | Staff can update booking and payment status | High | M | Needs Refinement | Needs Refinement |
| 8 | PBI-008 | Staff can manage room types, rooms, price and capacity | High | L | Ready for Sprint Planning | Ready |
| 9 | PBI-009 | Staff can block a physical room for a date range | High | M | Ready for Sprint Planning | Ready |
| 10 | PBI-010 | Guest can use the public hotel discovery experience | High | L | Needs Refinement | Needs Refinement |
| 11 | PBI-011 | Guest can browse accommodation packages | High | M | Needs Refinement | Needs Refinement |
| 12 | PBI-012 | Staff can manage packages and eligible room types | High | M | Needs Refinement | Needs Refinement |
| 13 | PBI-013 | Guest can reserve an accommodation package | High | L | Needs Refinement | Needs Refinement |
| 14 | PBI-014 | Hotel media is stored durably and managed safely | High | M | Blocked / Decision Required | Blocked |
| 15 | PBI-015 | Production hotel content and policies are loaded | High | M | Blocked / Decision Required | Blocked |
| 16 | PBI-016 | V1 production launch readiness is verified | Critical before launch | M | Later | Draft |

# Detailed Product Backlog Items

## PBI-001 - Room catalogue and room details

**Capability / user outcome:** A guest can browse active room types and open a room-detail experience before choosing a stay.

**Description:** Present bookable room-type information from the backend, including name, description, amenities, maximum capacity, current EGP nightly price, and room imagery when durable media is available. Public behavior must describe room types, not expose physical room numbers.

**Priority:** Critical  
**Relative size:** M  
**Dependencies:** Initial `RoomType` / `Room` persistence and representative seed data.  
**Readiness:** Ready for Sprint Planning  
**Status:** In Sprint

### Acceptance criteria

- Active room types are returned and rendered to public users.
- Each room type can display name, description, amenities, maximum guest capacity, current EGP nightly price, and available imagery/placeholder content.
- Inactive room types are not presented as bookable.
- Public responses do not expose internal physical room numbers/codes.
- Room catalogue and details work at desktop, tablet, and mobile widths for the implemented slice.
- Backend data, not duplicated frontend constants, is the source of room catalogue data.

### Business rules

- Guests book a **room type**, not a physical room.
- Base pricing is one current nightly price per room type in V1.
- Currency is EGP.

### Security considerations

- Do not expose internal room-allocation details.
- Validate identifiers and inputs on the server.
- Do not leak database or stack errors to public responses.

### Testing considerations

- Active/inactive filtering.
- Correct room-type detail retrieval.
- Price/capacity rendering.
- Responsive behavior and empty/error states appropriate to the implemented UI.

---

## PBI-002 - Availability search

**Capability / user outcome:** A guest can enter check-in, check-out, and number of guests and receive room types that can accommodate the full stay.

**Description:** The backend calculates real availability from physical room inventory, active reservations, room blocks when introduced, and room-type capacity. The frontend displays only the server-authoritative result.

**Priority:** Critical  
**Relative size:** L  
**Dependencies:** PBI-001 domain foundation; physical rooms associated with room types.  
**Readiness:** Ready for Sprint Planning  
**Status:** In Sprint

### Acceptance criteria

- Search accepts check-in date, check-out date, and guest count.
- Backend rejects invalid date ranges, including `check_out <= check_in`.
- Backend applies the agreed policy for past dates.
- A room type is returned only when guest count is within capacity and at least one eligible physical room is available for the entire requested interval.
- Reservation intervals use **[check-in, check-out)**; checkout-day turnover is allowed.
- Partial, complete, and enclosing overlaps make the affected physical room unavailable.
- The frontend does not treat cached or client-calculated availability as authoritative.

### Business rules

- Physical rooms are internal inventory belonging to a room type.
- Pending and other inventory-consuming reservation states exclude the allocated physical room from overlapping searches.
- One reservation consumes one physical room.

### Security considerations

- Validate and normalize all query/request inputs server-side.
- Avoid exposing internal room numbers while reporting room-type availability.
- Apply reasonable request-size and error-handling protections as the API foundation matures.

### Testing considerations

- Valid availability.
- Partial overlap.
- Complete overlap.
- Enclosing overlap.
- Same-day checkout/check-in.
- Guest capacity boundaries.
- Invalid and past dates.
- Multiple physical rooms in one room type.

---

## PBI-003 - Conflict-safe reservation creation

**Capability / user outcome:** A guest can reserve one available room type and receive a successful reservation only when the backend can atomically allocate real inventory.

**Description:** Reservation creation revalidates the request and inventory, selects an eligible physical room internally, calculates price server-side, persists a price/contact snapshot and Pending reservation, generates a booking reference, and prevents overlapping active allocations at the database level.

**Priority:** Critical  
**Relative size:** L  
**Dependencies:** PBI-002; reservation persistence; database-level overlap protection.  
**Readiness:** Ready for Sprint Planning  
**Status:** In Sprint

### Acceptance criteria

- Guest submits room type, stay dates, guest count, and required contact data; client-supplied physical room IDs are not trusted.
- Backend validates room-type capacity and stay dates.
- Backend rechecks availability during reservation creation.
- An eligible physical room is allocated internally.
- Allocation is protected inside a database transaction or equivalent atomic persistence strategy.
- Database-level constraints/locking prevent two active overlapping reservations from consuming the same physical room.
- Exactly one of two competing requests for the only available room over overlapping dates succeeds.
- Number of nights is calculated server-side from `[check-in, check-out)`.
- Accepted nightly price, nights, EGP currency, and total are stored as a historical snapshot.
- Reservation is created with status Pending and payment status Unpaid / Pay at Hotel.
- A unique booking reference is persisted.
- Pending immediately consumes inventory.
- Public response contains guest-safe confirmation data and never exposes the internal physical room number.

### Business rules

- One reservation = one room.
- Payment method is Pay at Hotel / Cash on Arrival.
- Future changes to the current room-type price do not change an existing reservation total.

### Security considerations

- Never trust price, total, room allocation, or stale availability submitted by the browser.
- Validate and minimize guest PII.
- Avoid logging guest PII in normal application logs.
- Public errors must not expose database internals.

### Testing considerations

- All PBI-002 overlap/date/capacity tests.
- Correct number-of-nights calculation.
- Server-side price calculation.
- Historical price snapshot after room-type price change.
- Pending reservation consumes inventory.
- Concurrency test with exactly one successful competing reservation.
- Transaction rollback on persistence failure.

---

## PBI-004 - Booking confirmation

**Capability / user outcome:** After a successful booking, the guest receives a clear confirmation with the reference and accepted booking details.

**Description:** Provide a confirmation experience based only on successfully persisted reservation data. The confirmation shows guest-safe information and Pay-at-Hotel terms.

**Priority:** Critical  
**Relative size:** S  
**Dependencies:** PBI-003.  
**Readiness:** Ready for Sprint Planning  
**Status:** In Sprint

### Acceptance criteria

- Confirmation is shown only after successful reservation creation.
- Confirmation includes booking reference, room type, check-in, check-out, guest count, number of nights, EGP total, and Pay at Hotel / Cash on Arrival.
- Internal physical room number/code is never shown to the guest.
- Failed booking creation never produces a false-success confirmation.
- Refresh/navigation behavior does not expose another guest's reservation details through a guessable or unsafe lookup mechanism.

### Security considerations

- Treat confirmation data as guest PII-bearing information.
- Avoid insecure direct-object reference patterns if confirmation data can be refetched.

### Testing considerations

- Successful reservation-to-confirmation flow.
- Failure path does not render success.
- Guest-safe field set only.

---

## PBI-005 - Secure staff sign-in and reservation inspection

**Capability / user outcome:** Authorized hotel staff can securely enter the admin experience and inspect reservations needed for hotel operations.

**Description:** Introduce one V1 staff permission level, secure credential handling, protected admin APIs/routes, reservation list/detail views, and access to internally assigned room information that is not public.

**Priority:** Critical  
**Relative size:** L  
**Dependencies:** PBI-003; admin authentication persistence.  
**Readiness:** Ready for Sprint Planning  
**Status:** Ready - Sprint 1 pull-in candidate only after the core booking flow is safe.

### Acceptance criteria

- Staff credentials are securely hashed and never stored in plaintext.
- Protected admin endpoints reject unauthenticated requests.
- Authenticated staff can view reservation list/detail information required for operations.
- Admin detail can show the internally allocated physical room.
- Public routes remain separate from protected admin behavior.

### Security considerations

- Secure authentication cookies/session/token handling; avoid sensitive token storage in browser `localStorage`.
- Rate-limiting/brute-force protections should be considered when authentication is exposed publicly.
- Do not expose password hashes or authentication secrets.

### Testing considerations

- Valid/invalid authentication.
- Unauthorized access rejection.
- Reservation data visible only through authorized paths.

---

## PBI-006 - Reservation confirmation email

**Capability / user outcome:** A guest receives an email copy of the successful reservation confirmation.

**Description:** After a reservation commits successfully, the system sends a transactional email containing the agreed booking fields. Email delivery failure must not erase or roll back an otherwise valid reservation.

**Priority:** High  
**Relative size:** M  
**Dependencies:** PBI-003; transactional email provider selection/configuration.  
**Readiness:** Needs Refinement  
**Status:** Needs Refinement

### Acceptance criteria

- Email contains booking reference, guest name, room type, dates, guest count, total EGP amount, and Pay at Hotel terms.
- Email is triggered only for a successfully created reservation.
- Email-provider failure is observable and does not invalidate the committed booking.

### Security/testing considerations

- Provider credentials remain server-side.
- Avoid leaking guest details into logs.
- Test successful send, provider failure, malformed address handling, and duplicate-send behavior as appropriate.

---

## PBI-007 - Reservation and payment status management

**Capability / user outcome:** Staff can keep the reservation record aligned with real hotel operations.

**Description:** Staff can update booking status and payment status through protected admin behavior. Inventory is released when a reservation is cancelled/rejected or otherwise explicitly released according to the final state model.

**Priority:** High  
**Relative size:** M  
**Dependencies:** PBI-005.  
**Readiness:** Needs Refinement  
**Status:** Needs Refinement

### Acceptance criteria

- Supported booking statuses include Pending, Confirmed, Checked In, Checked Out, Cancelled, and No Show.
- Payment status supports Unpaid / Pay at Hotel and Paid.
- API validates allowed transitions once the transition policy is finalized.
- Cancelling/releasing inventory affects future availability correctly without corrupting history.

### Risks / unknowns

- Exact status-transition matrix and whether No Show/Checked Out continue to occupy historical intervals only need final refinement before implementation.

---

## PBI-008 - Room inventory administration

**Capability / user outcome:** Staff can manage the hotel inventory that drives public room discovery and availability.

**Description:** Protected admin capability for room types, physical rooms, capacity, active state, amenities, and current base nightly price.

**Priority:** High  
**Relative size:** L  
**Dependencies:** PBI-005.  
**Readiness:** Ready for Sprint Planning with minor UX refinement  
**Status:** Ready

### Acceptance criteria

- Staff can create/edit/deactivate room types and physical rooms.
- Staff can manage current base nightly price and capacity.
- Referenced historical reservation data is protected from destructive changes.
- Deactivated inventory is excluded from new public booking searches as appropriate.

### Security/testing considerations

- All mutations require authorized staff access.
- Validate monetary, capacity, and identifier fields server-side.
- Test deactivation and referential-integrity behavior.

---

## PBI-009 - Room blocking

**Capability / user outcome:** Staff can remove a physical room from sale for operational reasons over a defined date interval.

**Description:** Create and remove date-range room blocks that participate in the same availability calculation as reservations.

**Priority:** High  
**Relative size:** M  
**Dependencies:** PBI-008; availability engine.  
**Readiness:** Ready for Sprint Planning  
**Status:** Ready

### Acceptance criteria

- Staff can create a valid `[start, end)` block for a physical room.
- Blocked inventory is excluded from overlapping availability searches.
- Removing a block restores availability when no other reservation/block prevents it.
- Creating a block cannot silently invalidate an existing overlapping reservation.

### Testing considerations

- Same overlap boundary matrix used for reservations.
- Existing-reservation conflict behavior.

---

## PBI-010 - Public hotel discovery experience

**Capability / user outcome:** Prospective guests can understand the hotel, facilities, gallery, contact information, and location before booking.

**Description:** Deliver the broader responsive, SEO-friendly public site around the core booking flow: Home, About, Facilities/Services, Gallery, and Contact/Location, using client-provided content and assets.

**Priority:** High  
**Relative size:** L  
**Dependencies:** Client content/assets; media strategy for final imagery.  
**Readiness:** Needs Refinement  
**Status:** Needs Refinement

### Acceptance criteria

- Required pages are responsive and semantically structured.
- Important public pages include appropriate SEO metadata.
- Final content/assets are loaded before release.
- Basic accessibility expectations are met for navigation, images, forms, and content structure.

### Risks / unknowns

- Production completion depends on client content and imagery.

---

## PBI-011 - Package catalogue and detail

**Capability / user outcome:** Guests can discover active accommodation packages and understand price, duration, inclusions, and eligible room types.

**Priority:** High  
**Relative size:** M  
**Dependencies:** Package business content.  
**Readiness:** Needs Refinement  
**Status:** Needs Refinement

### Acceptance criteria

- Active packages show name, description, images, fixed package price, number of nights/duration, inclusions, and eligible room types.
- Disabled packages are not presented as bookable.
- Currency is EGP.

---

## PBI-012 - Package administration

**Capability / user outcome:** Staff can create and maintain accommodation packages offered by the hotel.

**Priority:** High  
**Relative size:** M  
**Dependencies:** PBI-005, PBI-008.  
**Readiness:** Needs Refinement  
**Status:** Needs Refinement

### Acceptance criteria

- Authorized staff can create/edit/enable/disable packages.
- Package price, duration, inclusions, and eligible room types can be maintained.
- Historical package reservations preserve the accepted package price/terms required for the booking record.

---

## PBI-013 - Accommodation package reservation

**Capability / user outcome:** A guest can reserve an accommodation package without creating a separate inventory system.

**Priority:** High  
**Relative size:** L  
**Dependencies:** PBI-002, PBI-003, PBI-011, PBI-012.  
**Readiness:** Needs Refinement  
**Status:** Needs Refinement

### Acceptance criteria

- Package booking validates an enabled package and eligible room type.
- Package duration determines checkout from the selected arrival date unless later business rules change this.
- Capacity is validated.
- Same atomic physical-room allocation/inventory protection used by standard room reservations is reused.
- Accepted package price is stored as a historical snapshot.
- Pay at Hotel applies.

### Security/testing considerations

- Never maintain a parallel availability source for packages.
- Run the same overlap/concurrency tests as standard reservation creation.

---

## PBI-014 - Durable media storage

**Capability / user outcome:** Hotel, room, package, and gallery images survive deployments and can be managed safely.

**Priority:** High  
**Relative size:** M  
**Dependencies:** Persistent media provider selection.  
**Readiness:** Blocked / Decision Required  
**Status:** Blocked

### Acceptance criteria

- Uploaded assets are stored outside ephemeral application filesystem storage.
- Supported file types and size limits are enforced.
- Application stores durable media identifiers/URLs.
- Delete/update behavior does not create obvious orphaning or broken references.

### Security considerations

- Validate file content/type/size.
- Avoid public upload credentials and unsafe executable uploads.

---

## PBI-015 - Production hotel content and policies

**Capability / user outcome:** The production site represents the actual hotel rather than development fixtures.

**Priority:** High  
**Relative size:** M  
**Dependencies:** Client-provided hotel information, room descriptions/photos/amenities/prices, package details, policies, gallery, contact, and location information.  
**Readiness:** Blocked / Decision Required  
**Status:** Blocked

### Acceptance criteria

- Development placeholders are replaced with approved hotel content.
- Room/package prices and policy text match client-approved values.
- Contact/location information is verified before launch.

---

## PBI-016 - Production launch readiness

**Capability / user outcome:** The hotel can safely operate the V1 system in production.

**Priority:** Critical before launch  
**Relative size:** M  
**Dependencies:** All release-scope PBIs.  
**Readiness:** Later  
**Status:** Draft

### Acceptance criteria

- Production domain and HTTPS are verified.
- Production environment variables/secrets are complete and not stored in source control.
- Database backup/recovery procedure is understood and tested at an appropriate level.
- Required migrations run safely.
- Transactional email is configured and smoke-tested.
- Logging/monitoring can surface operational failures.
- Release smoke tests cover the critical booking journey.
- Critical/blocking defects are resolved.
- SEO basics and final production content are verified.
- A practical rollback/recovery approach exists.

# Backlog refinement notes

The next refinement focus after Sprint 1 starts should be limited to work approaching implementation. PBI-005 is the only current capacity-based pull-in candidate. PBI-006 and PBI-007 can be refined after the core booking transaction is stable. Package and marketing PBIs should not distract Sprint 1 from reservation integrity.
