# Retention and learning rules
All numerical settings below are initial hypotheses.

## Five-question daily goal and rewards
A study day requires a server-finalized qualifying session containing five submitted items (a short lesson or equivalent quiz). An unfinished session does not earn it. An expired mock qualifies only if five items were actually answered; unanswered timeout items do not count as submitted work. Credit is independent of correctness. Correctness affects learning feedback, not permission to keep studying.

A first graded attempt on an unseen family earns 10 XP; a correct answer on that attempt adds 5. Completing a lesson for the first time in that enrollment adds 10. A scheduled repeated review can earn 2 XP per family per day. Arbitrary replay does not farm XP. Rewards use explicit idempotency keys. A five-question first lesson with 3 correct yields 50 + 15 + 10 = 75 XP.

Use first family exposure, not wording revision, for first-seen metrics. Presenting the answer in a learning explanation marks the family as exposed; a later wording variant is not an unseen concept. Mock items exposed before a form is started are not fresh.

## Streak dates
At completion, the server converts its timestamp to the effective IANA profile timezone, inserts daily_study_days(user_id, study_date) once, and stores that timezone snapshot. Same date: no streak increment. Adjacent credited date: +1. Gap: current streak becomes 1. Longest is max(longest,current). A day is not 24 hours around daylight saving changes.

Profile timezone changes apply prospectively after the next local-day boundary, are rate-limited, and never move historical credits. Store the pending effective change in profile settings when implemented. The reference schema stores the current effective timezone and each credit snapshot; a pending-timezone-change table is an implementation follow-up, not present in schema.sql. Reject invalid zones at the API. The reference pure-function tests cover same-day, gap, midnight and DST calculations.

Optional freezes are phase 2. Reserve/debit inventory with row locking; a used freeze protects a date but does not create a qualifying study day or circle score. Never imply a practiced day when only a freeze occurred. No freeze is implemented in the prototype.

## Review schedule
Initial schedule: 1, 3, 7, 14 local calendar days after successful concept review; a wrong answer returns the concept to stage 0, due tomorrow. Prefer a fresh scenario family within that objective. Repeated exact-question accuracy remains separate. A correct response moves only one step, not directly to “mastered.”

This is a transparent starting heuristic, not a validated adaptive memory model. A production scheduler should log the prior stage, graded response, selected family and next due date for reproducibility. Due review is always free. If inventory cannot provide a fresh scenario, label the repeat and do not count it as new-concept evidence.

## Learning evidence
Report:
- Objective coverage: objectives with meaningful graded practice / all active mapped objectives.
- New-family accuracy: correct first graded attempts / first graded attempts, with denominator.
- Review accuracy: repeated practice shown separately.
- Mock accuracy: raw correct / total, tied to exam version and form freshness.
- Streak and XP: activity only.

Coverage thresholds and “weakest” ranking require sufficient samples; start with a minimum of five unseen families per objective before ranking by accuracy. Otherwise recommend under-covered objectives and say why. Do not display a numeric pass likelihood.

## Reminder eligibility
Reminders are off until the learner explicitly opts in after receiving value. Store local desired time and quiet hours. Queue at most one daily study reminder, suppress if completed/paused/passed/deleted, and cancel pending jobs when qualifying study is recorded. A low-noise weekly circle summary is separately opt-in.

Quiet windows can cross midnight. Use local calendar logic for DST and skip times that do not exist, shifting to the next allowed local time. Suppress duplicate deliveries with a unique job key. A worker rechecks eligibility immediately before dispatch. Permission denial leaves the app fully usable. Prototype dialogs never schedule reminders.

## Social rules (phase 2)
A circle’s week, target and IANA timezone are snapshotted when the week opens. Score distinct circle-local dates of qualifying server-finalized sessions while the membership is active, maximum seven. Do not derive circle days from personal streak-date labels, since their timezones can differ. Free and paid users score identically. Invitations are deliberate; no external message is sent by this bundle.

## Healthy end state
After a real exam outcome, offer pause and graduation. Report retention among still-active exam candidates as well as all-signup cohorts. Do not remove graduates retroactively to inflate historic retention. Track successful outcomes separately from app activity.

