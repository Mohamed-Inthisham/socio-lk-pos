# POS till setup — receipt printer and browser

How to set up a till so the POS terminal (`/pos`) prints its 80mm receipt with no print dialog and one cut per sale. Planning doc §8 P5-13, P5-16. The settings below were worked out on the shop's printer in October 2026; if they change, change them here.

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
