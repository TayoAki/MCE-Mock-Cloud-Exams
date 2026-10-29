# Visual direction and prototype brief
Working title: CertPath. Original visual language inspired by playful habit-building and clear exam practice. No copied owl, mascot, logo, screen assets or claims of affiliation.

## The desired feel
Warm, encouraging, focused. Rounded surfaces and tactile violet buttons make a short session approachable. Technical accuracy comes from the reviewed content and explicit sources. A small original cube companion celebrates effort without taking attention from scenario text.

## Design system
The machine-readable source is design_tokens.json. Background #F7F6FB; ink #24243A; primary #6750EE; primary pressed #4D37CE; muted #6F7085; mint #DDF6EB; success #137B60; coral #E15D64; border #E9E7F3. Base spacing 4/8/12/16/24/32. Cards use a 20px radius, buttons 15px. Native touch targets at least 44pt. Body copy 15–16pt; supporting copy at least 12pt in production. System fonts support offline review.

The AI concept boards contain illustrative typography and geometry. Exact copy, tokens and screen behavior are defined by the prototype and written specification; do not use image-generated pixels as engineering measurements.

## Navigation
Learn: current daily path and lesson.
Practice: modes, due review, mock exams.
Progress: objective coverage, new-family accuracy and mock history.
Friends: optional phase-2 circle. Ship the pilot with three tabs if circles are deferred.

An account/settings entry in the native header holds exam switch, goal, timezone, reminder preferences, restore purchase, privacy and deletion. The prototype uses the left screen list as a review tool; that list is not a proposed mobile product feature.

## Screen behavior and core copy
| Screen | Primary action | Key copy / expectation |
|---|---|---|
| S01 Exam | Continue | “What are you working toward?” Planned banks are disabled |
| S02 Goal | Build my path | “A little practice. Every day.” Date optional |
| S03 Learn | Start lesson | Topic and five-question commitment; completion unlocks, not mastery |
| S04 Question | Check answer | Disable until selection; no hearts; one committed answer |
| S05 Feedback | Got it — continue | “A useful one to review” or “You got it!” plus source |
| S06 Complete | Back to my path | XP, correct count, daily streak and optional reminder |
| S07 Practice | Quick 5 | Clear alternate modes, full mock size and due review |
| S08 Review | Start review | Due concepts and meaningful empty state |
| S09 Mock setup | Start mock | Format, timing, guide version, no feedback until end |
| S10 Mock result | Practice this topic | “Practice score · not a pass prediction” |
| S11 Progress | Focus weak topic | Unseen-family denominators and objective coverage |
| S12 Friends | Invite a friend | “One study day counts once. No XP race.” Phase 2 |
| S13 Plus | Start free preview | No card; no automatic renewal; free plan remains |

## States required for native implementation
| Surface | Loading / empty | Error / recovery |
|---|---|---|
| Path | Skeleton / no published path | Retry; keep last synced lesson visible |
| Question | Assigned-item placeholder | Restore pending selection; retry identical submission |
| Feedback | Grading indicator | Never invent a grade; explanation help can fail independently |
| Review | “You’re caught up” | Practice a new lesson; retry queue refresh |
| Mock | Admission check / no eligible fresh form | Explain inventory limitation; offer clearly labeled practice |
| Result | Finalizing / no completed mock | Resume polling same result ID; do not duplicate completion |
| Progress | “Not enough practice yet” | Hide invalid percentage; preserve prior sample size |
| Circle | Invitation empty state | Expired/revoked invite; leave/report controls |
| Entitlement | Verifying / free state | Retry/restore purchase; store cancellation remains store-owned |

## Motion and accessibility
Use a short node pop, a visible progress advance and a restrained completion celebration. Reduced motion removes transforms/confetti. Question feedback has both text and color. Buttons and links have visible keyboard focus in the prototype. Test native VoiceOver/TalkBack, 200% text scaling, contrast, one-hand reach and long scenario wrapping before release.

## Delivered prototypes versus future behavior
The offline HTML supports onboarding, an answer/feedback/complete loop, five-item sample mock, navigation, preview fixture and helper modals. It has no authentication, store, notification permission, live AI, real circle or calibrated scheduler. Full-bank scores and due counts are labeled fictional. Prototype answer keys are visible in its JavaScript because it is a local design demo; production delivery must use the server-only grading boundary.

