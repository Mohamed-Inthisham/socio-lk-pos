# POS till setup — receipt printer and browser

How to set up a till so the POS terminal (`/pos`) prints its 80mm receipt with no print dialog and one cut per sale. Section 6 covers going live with Phase 6.4 P6 (recent sales, reprints, voids with a manager's PIN); section 7 covers P7 (returns, refunds, return slips, phones to check). Planning doc §8 P5-13, P5-16. The settings below were worked out on the shop's printer in October 2026; if they change, change them here.

**Hardware:** Xprinter XP-80 (XP-80T), 80mm thermal paper, USB, Windows driver. No cash drawer.

**How the POS prints:** when a sale completes, the terminal renders the receipt into a hidden print-only area, sets the page to the receipt's exact size (`@page { size: 72mm <height>mm; margin: 0 }`, at least 90mm tall) and calls `window.print()`. Everything goes through the Windows driver; there is no ESC/POS or WebUSB. **Reprint receipt** (Sale complete panel) and **Last receipt** (Current sale card) print the same receipt again. The browser can't see printer errors (paper out, jam, cover open), so reprinting is how a cashier recovers.

## 1. Printer driver

1. Install the Xprinter driver for the XP-80 and connect the printer by USB.
2. **Settings → Bluetooth & devices → Printers & scanners:** turn off "Let Windows manage my default printer" and make **XP-80** the default printer. Chrome normally reuses the printer it last printed to; the Windows default is its fallback, so a wrong default can send a silent print (step 3) to the wrong printer.
3. **XP-80 → Printing preferences:**

   | Setting | Value |
   |---|---|
   | Paper size | **80(72)mm x 3276mm** |
   | Horizontal Offset | **0.0** |
   | Printing Scale | **None** |
   | Paper Saving | **Both** |
   | Cutter | **per page**, **partial cut** |
   | Feed after print | **15mm** |
   | Cash drawer | **None** |

   The Graphics Property tab can stay as installed.

Why these: the 3276mm paper is a long roll "page", and the POS sets each receipt's real length, so a receipt prints in one piece with one cut and little blank paper. The driver enlarges everything by about ×1.057 (203 / 192 dpi). The receipt is laid out for that: 64mm of content from a 1.2mm left margin on a 72mm page prints centred with about 6mm each side. Its Horizontal Offset is inverted (−1.0 moves the print right), so leave it at 0.

## 2. One manual print in the browser

Chrome (and Edge) keep their own print settings per profile, separate from the driver's. Set them once, with the dialog, before turning on kiosk printing:

1. Open the POS in **Chrome** at `/pos`, log in, and complete a small test sale (or use **Last receipt**). The print dialog opens.
2. Set:

   | Setting | Value |
   |---|---|
   | Destination | **XP-80** |
   | Paper size (under More settings) | **80(72)mm x 3276mm** — Chrome defaults to 80(72)x297mm, which shrinks a long receipt onto one 297mm page |
   | Margins | **Default** |
   | Scale | **Custom, 100** |
   | Headers and footers | **off** |
   | Background graphics | either (the receipt is black on white) |

3. Print. Check: centred, nothing clipped on the right, one piece, one cut.

Chrome remembers the destination and these settings for the next print in this profile.

## 3. Silent printing (`--kiosk-printing`)

With `--kiosk-printing`, Chrome skips the print dialog and prints straight away with the settings it remembered in step 2.

1. Close **every** Chrome window, and Chrome running in the background (tray icon → Exit, or turn off Settings → System → "Continue running background apps when Chrome is closed"). A flag only takes effect when Chrome starts fresh; if Chrome is already running, the shortcut just opens a window in that instance, without the flag.
2. Create a desktop shortcut, for example "SOCIO POS":

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://<pos-host>/pos
   ```

   Optional: add `--kiosk` for a full-screen till (Alt+F4 closes it). Use the same profile that step 2 was done in.
3. Use only this shortcut to open the till.

Edge takes the same flag (`msedge.exe --kiosk-printing …`) and has the same Paper size option; the settings above were measured in Chrome.

### Kiosk check (do once per till, and after a Chrome update or profile reset)

Passed on the shop's till on 2026-10-21 (Chrome, XP-80): all three steps below.

1. Open the till with the shortcut and complete a **short** sale (one item, cash). It prints with **no dialog**, on the XP-80, centred, one piece, one cut.
2. Complete a **long** sale (5+ lines, or a trade-in plus discounts). It prints **full size**, not shrunk, in one piece with one cut. This proves kiosk printing kept the **3276mm** paper size: on Chrome's 297mm default a long receipt comes out shrunk.
3. Press **Last receipt** on the Current sale card: the same receipt prints again with no dialog.

If any check fails, the remembered settings were lost: close Chrome completely, open it **without** the flag, repeat step 2 (manual print), close Chrome completely again, then reopen with the shortcut.

## 4. Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| A print dialog appears | Chrome was already running when the shortcut was used | Close all Chrome windows and background Chrome; reopen with the shortcut |
| Long receipt printed small | Chrome paper size is 80(72)x297mm | Step 2 again: paper size 80(72)mm x 3276mm |
| Right edge cut off | Scale not 100, or the paper size is 80mm instead of 80(72)mm | Step 2: Custom 100, 80(72)mm x 3276mm |
| Short slip printed sideways | A page shorter than it is wide | Shouldn't happen (the POS pads receipts to at least 90mm); report it with the sale number |
| Two cuts on one receipt | The receipt spilled onto a second page | Check the driver's paper size is 3276mm; report it with the sale number |
| Nothing prints, no error | Paper out, cover open, printer off or unplugged | Fix the printer, then **Reprint receipt** / **Last receipt** |
| Print shifted to one side | Driver Horizontal Offset not 0 | Set it to 0.0 (its sign is inverted) |

## 5. Receipt content (for maintainers)

- Shop name (as the logo image), tagline, terms and footer: `frontend/src/constants/receipt.js`. Logo: `frontend/src/assets/receipt/socio-logo-receipt.png` (1-bit, printed 60mm wide); its source is `socio-logo.webp` next to it.
- Branch name, address and phone: the sale's branch record (`PATCH /branches/:id`; there is no branch screen yet). A null address or phone is skipped.
- Per line: warranty "Warranty: 12 months (until 21 Oct 2027)", "Checking only" for Checking, nothing for No warranty (P5-18, P5-19); discount "Discount (20%)" or "Discount (160.00 each)" (P5-20).
- Layout numbers: `RECEIPT_LAYOUT` in `constants/receipt.js` (page 72mm, content 64mm, left margin 1.2mm, minimum height 90mm). Change them only after a test print on the real printer; Chrome's print preview → Save as PDF shows the page size but not the driver's ×1.057 enlargement.
- Markings (P6-7): a reprint from a sale's detail page prints **"REPRINT · <date, time printed>"** under the invoice number; a voided sale prints a **"VOIDED — NOT VALID"** block (voided time, reason) first on the paper and again above the footer, and no Change line. The Sale complete panel's Reprint and Last receipt print unmarked; Last receipt always re-reads the sale, so a sale voided since prints as voided.

## 6. Going live with P6 (recent sales, reprints, voids)

Planning doc §8 "P6 decision log" and "P6 as built"; backend: `docs/backend/sales.md`, `docs/backend/approvals.md`.

### 6.1 Before starting the new backend: run the two migrations

P6 adds two migrations. Run them **before** starting the new backend, which expects the new columns:

| Migration | What it does |
|---|---|
| `AddSalesBranchCompletedAtIndex` | An index on `sales (branch_id, completed_at)` for the recent-sales day list |
| `AddApprovalPinAndVoidRequestedBy` | The approval PIN columns on `users` (hash, set time, wrong-PIN count, lock), `sales.void_requested_by` (backfilled from `voided_by` on earlier voids) and their CHECK constraints |

1. Back up the database.
2. In `backend/`, with the production `.env`: `npm run migration:show` lists both as pending (`[ ]`).
3. `npm run migration:run`, then `npm run migration:show` again: both are now `[X]`.
4. Start the new backend.

Both migrations have a `down` (`npm run migration:revert` undoes the last one).

### 6.2 Before anyone needs to void: every manager and admin sets a PIN

**Every void needs a manager's or admin's approval PIN, on every session**, a manager's own included (P6-8). Until someone at a branch has a PIN, nobody there can void: the void dialog says "No manager has set an approval PIN yet."

Each manager and admin, once, signed in as themselves:

1. User menu (name, top right) → **Approval PIN**. It reads "Not set".
2. Current login password, then a **6-digit PIN** twice. One repeated digit (`111111`) and straight runs (`123456`, `654321`) are refused.
3. **Save PIN**. The menu now reads "Set on <date, time>".

Each person sets their own PIN; nobody can set someone else's. Cashiers have no PIN and don't see the menu item.

### 6.3 Voids and refunds at the till

- **Sales** (header button, or **Alt+R**) lists the day's sales; open one and press **V** (or **Void sale**). Pick a reason, choose the approver (on a manager's or admin's own session it is preselected), and the approver enters their PIN.
- **A void still records no refund** (returns do, from P7: section 7). The void dialog lists what to hand back first: cash, and each card, bank transfer, Koko or Mintpay payment to reverse (with its reference). A trade-in phone goes back to the customer: take it off the shelf. Items from another shop aren't added to our stock; return them to that shop.
- A void slip prints only on request: **Reprint** (P) on the voided sale.

### 6.4 A forgotten or locked PIN

- **Five wrong PINs in a row lock that approver's PIN for 15 minutes**; it unlocks by itself. Meanwhile another manager or an admin can approve. The lock doesn't affect logging in.
- **Forgotten, or locked and it can't wait:** an admin clears the PIN, then its owner sets a new one (§6.2). Until the Phase 6.8 user screens there is no screen for this. Outside production it is done through **Swagger** with `DELETE /users/:id/approval-pin`, which records the clear in the audit log (`APPROVAL_PIN_CLEARED`). On a **production** backend Swagger isn't served, so use the SQL fallback below.

Steps (Swagger, as an admin; backend not started with `NODE_ENV=production`):

1. Open `http://<backend-host>:<port>/api/docs`.
2. **POST /api/v1/auth/login** → Try it out → body `{ "email": "<admin email>", "password": "<admin password>" }` → Execute. 200; the browser now holds the admin's session for the following calls.
3. **GET /api/v1/branches** → Execute. Copy the `id` of the manager's branch.
4. **GET /api/v1/approvers** with `branchId` = that id → Execute. Copy the manager's `id` from the list. (A forgotten or locked PIN is still set, so the manager is listed.)
5. **DELETE /api/v1/users/{id}/approval-pin** with that `id` → Execute. **204** means cleared (also when no PIN was set).
6. **POST /api/v1/auth/logout** → Execute.
7. The manager signs in and sets a new PIN (§6.2).

**Swagger is only served when the backend is not started with `NODE_ENV=production`** (`backend/src/main.ts`), so on a production backend use the fallback below (FOLLOWUPS "No way to clear an approval PIN on a production backend").

**Production fallback (SQL, until the Phase 6.8 screens).** An admin with database access runs this on the **production** database, for one user, by email. It does what `DELETE /users/:id/approval-pin` does: clears the PIN, its set time, the wrong-PIN count and the lock.

```sql
BEGIN;

UPDATE users
   SET approval_pin_hash            = NULL,
       approval_pin_set_at          = NULL,
       approval_pin_failed_attempts = 0,
       approval_pin_locked_until    = NULL,
       updated_at                   = now()
 WHERE email = lower('manager@example.com')   -- the user whose PIN to clear
   AND deleted_at IS NULL
RETURNING email, full_name, role;

-- Exactly one row must come back. If it did: COMMIT;  otherwise: ROLLBACK;
COMMIT;
```

- Check the returned row is the right person before `COMMIT`. Emails are stored lower-case.
- **This bypasses the audit log**: no `APPROVAL_PIN_CLEARED` entry is written. Write it down by hand in the shop's log: who cleared it, for whom, when, and why.
- Then the user signs in and sets a new PIN (§6.2).

## 7. Going live with P7 (returns, refunds, phones to check)

Planning doc section 8 "P7 decision log" and "P7 as built"; backend: `docs/backend/returns.md`, `docs/backend/used-phones.md`.

### 7.1 Before starting the new backend: run the two migrations, in order

P7 adds two migrations. Run them **before** starting the new backend, which expects the new status, tables and columns. `migration:run` applies them in this order:

| Migration | What it does |
|---|---|
| `AddProductUnitInspectionStatus` | The `INSPECTION` status for a returned phone: the product-unit status CHECK, and the live-IMEI unique index (an `INSPECTION` phone is still in the shop) |
| `CreateSaleReturns` | `sale_returns`, `sale_return_lines`, `sale_refunds`, `sale_lines.returned_quantity`, and a `kind` on the sale-number counters so returns get their own `RET-YYYYMMDD-NNNN` numbers |

1. Back up the database.
2. In `backend/`, with the production `.env`: `npm run migration:show` lists both as pending (`[ ]`).
3. `npm run migration:run`, then `npm run migration:show` again: both are now `[X]`.
4. Start the new backend.

Both have a `down`, but each refuses (and changes nothing) while it would lose real records: `CreateSaleReturns` while any return or `RET-` counter exists, `AddProductUnitInspectionStatus` while any phone is in `INSPECTION`.

### 7.2 PINs

**Every return needs a manager's or admin's approval PIN, on every session**, exactly as voids do. Managers and admins who set a PIN for P6 need nothing new; anyone who hasn't, sets one now (section 6.2).

### 7.3 A return at the till

1. **Sales** (Alt+R), open the sale (search finds sale numbers, customers, phones, IMEIs and `RET-` numbers), then **Return items** (R).
2. **Items.** Pick how many of each line come back. For an item from our stock, choose **Back to stock** or **Damaged** (B / D). A phone says **Goes to inspection**; an item from another shop says **Not our stock** (return it to that shop yourself). Each line shows its warranty; Checking only, No warranty and an expired warranty are **outside warranty**.
3. **Refund.** The refund due is what the customer actually paid for those items. The refund starts the way the sale was paid: back to the card, bank transfer, Koko or Mintpay payment first (up to what is left of it), the rest in cash; a trade-in's share goes back as cash ("includes LKR X from a trade-in"; the trade-in phone stays with the shop). The refund can be **lowered, never raised**; a lower refund needs the reason's detail to say why.
4. **Outside warranty:** the manager gives an **override reason** as well as the normal reason.
5. **Approval:** the manager or admin picks themselves and enters their PIN. **Return items.**
6. If the till loses its connection while sending, it checks by itself whether the return went through; if not, it says so and **Try again** sends the same return again (never a second one).

### 7.4 The money goes back outside the system

The till **records** the refund; it doesn't move any money. Before pressing Return items: count out the cash; for a card, bank transfer, Koko or Mintpay refund, do the reversal on the card machine, in the banking app or on the provider's portal first, and type the reversal's reference into its row. The **Return recorded** panel then lists exactly what to hand over.

### 7.5 Return slips

- **Two copies print by themselves**, each cut separately: the **customer's copy**, then the **shop's copy**. When cash was refunded the shop's copy has "Received LKR X cash." and a **Customer signature** line: the customer signs it and the shop keeps it.
- If a slip didn't come out (paper, jam), **Print again** on the Return recorded panel prints both copies again, unmarked.
- Later: the sale's **Returns** tab, **Reprint slip** on that return. Both copies print marked "REPRINT · <date, time>".

### 7.6 Returned phones: Phones to check

- A returned phone goes to **inspection**: it can't be sold, traded in or bought back until it is checked.
- Managers and admins see **Phones to check** in the terminal header, with the number waiting (cashiers don't see it). It lists each phone, oldest first, with its IMEI, the return and sale it came from, and how long it has waited (amber from 8 days).
- **No fault:** **Passed: back to stock** (or P), then confirm (Tab, Enter; Cancel has the focus). The phone is back in stock and can be sold again.
- **Faulty:** leave it on the list and **set it aside physically, labelled with its IMEI**. Returning faulty phones to their supplier comes with supplier receiving; until then it stays in inspection.

### 7.7 Voids after a return

A sale with a return **can't be voided**: Sale detail shows "Sales with returns can't be voided." instead of the Void button. A return is final; a mistaken return is put right with a new sale.
