# Customer journeys
Primary persona hypothesis: an employed technical professional with limited daily study time and an exam goal. Names and situations below are illustrative.

## Journey A: curious visitor → first useful lesson
| Step / screen | Customer intent | Product response | Data written | Failure / recovery |
|---|---|---|---|---|
| Short-form video / referral | “Can I fit this into my day?” | Show an actual question, correction and short path; no pass promise | Anonymous acquisition event | Campaign deep link opens supported exam or a catalog fallback |
| S01 Choose exam | Find the right certification | One supported pilot; clear Planned badges | Guest selection; enrollment after identity | Retired guide suggests current version; no automatic destructive migration |
| S02 Daily goal | Choose a realistic pace | 5/10/15 minutes; optional exam date | Profile goal/date | Skip date; edit goal later |
| S03 Daily path | Know what to do first | One current lesson; optional placement later | Lesson start / session selection | Loading skeleton; retry; no bank available gives honest empty state |
| S04–S05 Question / feedback | Test myself and understand | Answer → reviewed correction → optional alternate explanation | Attempt + choice + exposure + review update | Network retry is idempotent; AI failure leaves reviewed explanation |
| S06 Complete | Feel progress | Activity XP, one study-day credit, next review | Rewards + study day + progress transaction | Reopen shows the saved result, with no duplicate reward |
| Post-completion prompt | Keep progress | Optional account save and opt-in reminder | Account merge / notification preferences | Deny notifications and continue freely |

First value is a completed question with an understood correction. Activation is a completed first five-item lesson, measured separately.

## Journey B: regular learner → sustainable return
At the chosen local time, an eligible opted-in learner can receive one reminder. Opening goes to the current lesson or due review. A completed qualifying session earns a study-day credit once; additional sessions can improve practice without extending that day’s streak again. Missed concepts schedule a later review. A fresh scenario shows whether the correction transferred.

If a learner misses a day, welcome them back with the next useful task. Show an honest restarted streak if necessary. Avoid guilt copy. A paused enrollment cancels study reminders. Personal study dates use the profile timezone recorded when credit is earned.

## Journey C: weak-topic learner → full exam rehearsal
| Step | Desired result | Interface and logic |
|---|---|---|
| S07 Practice | Choose a useful mode | Quick 5, Missed, Weakest, Timed, Custom or Mock |
| S08 Review | Fix repeat errors | Group by objective, then select a due concept and preferably a fresh family |
| S09 Mock setup | Know the commitment | Exam version, size, server deadline and no-pause behavior are visible |
| In-progress mock | Stay focused | Resume assigned items after backgrounding; deadline continues |
| S10 Results | Understand performance | Raw score and domain denominators; no pass prediction |
| Focused next lesson | Improve a real gap | Offer targeted work based on adequate unseen-item evidence |
| S11 Progress | Decide next action | Show coverage and practice evidence with sample sizes |

In the offline prototype only five sample questions are available. A live full mock must not reuse the same tiny bank and imply coverage.

## Journey D: active learner → Plus preview → informed choice
After the first completed lesson, offer a one-time 14-day no-card preview. It starts only on the learner’s explicit action. Before activation, show the start/end date and included features. It ends automatically without charging and restores free access. Attempts, corrections and history stay.

If a learner explicitly chooses a recurring paid plan, show the store’s localized total, billing interval, auto-renewal, cancellation and restore options before the native purchase sheet. Verify purchases server-side. An interrupted purchase remains pending; a rejected purchase does not grant entitlement. No store implementation is included in this prototype.

If the preview expires mid-mock, an already assigned mock remains available to submit and read its results; premium inventory access applies to the next session. Snapshot admission entitlement on the session.

## Journey E: learner → optional accountability circle (phase 2)
After demonstrated study value, offer a private circle. Use a revocable, expiring invite link with a hashed token. Joining requires explicit consent. Do not import contacts. The circle shows a small weekly study-day goal; each circle-local day counts once, with a maximum of seven per week. XP spending or paid access cannot improve the score.

Personal streak timezone and circle week timezone may differ. Snapshot the circle’s week timezone and target at week creation, and compute participation only while the member is active. Leaving hides the member from the current roster; deleted users appear as removed identities in permitted historical totals. Owner transfer or archiving is required before the last owner leaves.

## Journey F: exam candidate → graduation / retry
Record Passed, Failed or Postponed. Passed/Failed create a dated exam outcome; Postponed updates exam date and is not a result. Default to pausing study reminders after a real exam outcome. Let learners choose a review plan after a failed exam or a new certification after passing. Self-reported outcomes stay labeled. Do not treat healthy graduation as product failure or manufacture endless study.

## Returning, interrupted and accessibility journeys
- Network lost during answer: keep the pending submission ID and selected choice; retry the same payload.
- App closes during lesson: reopen server-assigned items and submitted states.
- App closes during mock: server deadline remains authoritative; expired form finalizes exactly once.
- New phone: sign in and restore progress; store restoration is separate from login.
- Question disputed: “Report an issue,” keep the attempt record, and exclude invalidated items from scored aggregates through audit repair.
- Text enlarged or screen reader used: content scrolls, options have clear labels, feedback announces in words, celebrations respect reduced motion.
- Account deletion: stop reminders immediately; remove private profile/progress according to the published deletion policy and required billing retention. Never expose exam evidence through social screens.

