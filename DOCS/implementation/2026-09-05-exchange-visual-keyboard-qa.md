# Exchange visual and keyboard refinement

Added bold, flat direction cards with subtle currency illustrations, stronger selected payout options, and scroll-to-top transitions between form steps. No decorative shadows were added. The app-wide KeyboardVisibilityGuard reveals focused fields inside scrollable forms after keyboard viewport changes. Bottom navigation hides while typing; Scaffold keeps native keyboard resizing without duplicate inset padding.

Verification: eight Exchange widget tests and one keyboard viewport test passed. Selected Dart analysis passed. A fresh simulator build launched successfully. Computer use confirmed the direction cards, amount entry with software keyboard visible and Continue unobstructed, and keyboard dismissal when advancing to payout selection. No financial order was submitted.

The shared behavior is installed across the app, but every individual form has not yet received simulator keyboard verification. Cedis-to-naira remains visibly disabled on the current live backend pending reverse-direction deployment and configuration.
