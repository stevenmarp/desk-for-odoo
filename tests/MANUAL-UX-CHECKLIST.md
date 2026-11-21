# Desk for Odoo + Odoo Doctor manual UX checklist

Use this checklist for the final browser and desktop review. It intentionally keeps visual approval manual.

## Shared identity

- [ ] Odoo Doctor and Desk for Odoo use the same Inter body typeface.
- [ ] Marketing headings use the same Caveat 700 treatment as Odoo Doctor.
- [ ] Light mode uses `#fffafd` background, `#714b67` primary, warm purple borders, and white cards.
- [ ] Dark mode uses `#201721` background, `#2b1f2d` cards, `#caa6bf` primary, and translucent borders.
- [ ] Buttons, inputs, cards, badges, focus rings, shadows, and 8px base radius feel like one product family.
- [ ] Teal is reserved for technical/running states; red remains destructive; amber remains warning.

## Appearance modes

- [ ] Website header cycles **System → Light → Dark → System**.
- [ ] Website choice survives reload.
- [ ] System mode follows an OS theme change.
- [ ] Desktop Settings shows **System**, **Light**, and **Dark**.
- [ ] Saving each desktop mode updates the full window and persists after restart.
- [ ] No flash of the wrong website theme is visible during reload.

## Odoo Doctor integration

- [ ] Desktop navigation shows **Desk for Odoo**.
- [ ] Mobile menu shows **Desk for Odoo**.
- [ ] Both links open `https://stevenmarp.github.io/desk-for-odoo/` in a new tab.
- [ ] External link styling feels native to Odoo Doctor and does not dominate primary tools.
- [ ] Desk for Odoo sidebar shows **Odoo Doctor** and opens `https://odoo-doctor.com` externally.
- [ ] Desk website navbar and footer show **Odoo Doctor** and open the correct site.

## Responsive and accessibility

- [ ] Check website at 375px, 768px, 1280px, and 1440px widths.
- [ ] Check desktop app at 960×600 and its normal window size.
- [ ] No horizontal scrolling, clipped controls, or overlapping navigation.
- [ ] All interactive controls have a visible keyboard focus state.
- [ ] Theme control has an accurate accessible label for the active mode.
- [ ] Text remains readable in light and dark mode, including the dark support section.
- [ ] Reduced-motion preference disables decorative animations.
