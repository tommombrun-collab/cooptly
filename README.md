# Cooptly

[![Tests and demo](https://github.com/tommombrun-collab/cooptly/actions/workflows/demo.yml/badge.svg)](https://github.com/tommombrun-collab/cooptly/actions/workflows/demo.yml)

**Recruitment platform for student associations**: candidates apply and book their interview online, staff members share their availability, interview panels are assigned automatically, and the board centralises evaluations, ranking and final deliberations.

A solo project, from needs analysis to production (AI-assisted development), built for the student associations of emlyon business school. Put into production for the recruitment campaign of the Bureau des Arts (BDA, the school's arts society) in September 2026.

### ▶ [Try the live demo](https://tommombrun-collab.github.io/cooptly/)

Interactive, no sign-up: one click on **“Enter as the board”**, or try the public flows (apply and book a slot, share your availability, public schedule). The example is based on the BDA, with made-up people and answers. Everything stays in your browser, and a button resets the demo.

> The application's interface is in **French**: it was built for French-speaking student associations.
>
> This is a showcase repository: no Firebase configuration is included (see [Running the project](#running-the-project)). The demo swaps Firebase for a simulated backend without changing a single line of the application (see [How the demo works](#how-the-demo-works)).

---

## What the platform does

**For candidates, no account needed**
- Application form configured by each association (reorderable questions; text, choice, phone, date fields…).
- Slot booking in a days × hours calendar, computed live from staff availability and the interviews already booked.
- Personal tracking page (token link), rescheduling without re-typing anything, add-to-calendar (Google / `.ics`).

**For staff, no account needed**
- Hour-by-hour availability grid.
- Interview evaluation through a panel link.
- Read-only public schedule, and a one-click copy of a day's interviews to share with the team.

**For the board**
- Dashboard, candidate list, evaluation form with a normalised score, ranking, and a full-screen deliberation mode (drag and drop, cut-off line).
- Internal schedule: availability heatmap, manual placement, simultaneous interviews side by side.
- Settings: interview period, slot length and step, break between interviews, minimum booking notice, panel size, group interviews, invite codes, staff list.
- Recycle bin: every deletion can be undone for 30 days.

**Multi-association**: one account can belong to several boards, and each association's data is strictly isolated.

---

## Product approach

### The problem
Every September, association boards recruit dozens of new members in a few weeks. Before Cooptly, everything went through online forms, shared spreadsheets and group chats: double-booked slots, panels put together by hand, scattered notes, and deliberations run on a file nobody had up to date.

### The users
| Who | What they need | Constraint |
|---|---|---|
| **Candidate** | Apply and book a slot in two minutes, on a phone | No account to create |
| **Staff member** (interviewer) | Say when they're free, know when they're interviewing | No account either |
| **Board** (secretary general, president) | See, schedule, evaluate, deliberate | Other associations must never see their data |
| **Platform admin** | Create associations, grant access | |

Two design decisions follow: **everything public works without an account** (access is carried by links and tokens), and **security relies entirely on Firestore security rules**, since the client can't be trusted.

### Method: short iterations, driven by real usage
Not Scrum by the book (a solo project, no team and no ceremonies), but the same principles:
- **Short, shippable increments**: every change goes to production as soon as it's tested (131 releases in 15 weeks, from 15 June to 27 September 2026).
- **A backlog fed by users**: board members report an issue (often with a screenshot), and it's prioritised by its impact on the ongoing campaign.
- **“Audit then fix” cycles** as retrospectives: a security audit, an algorithm audit and a cascading-deletion audit, each followed by a batch of fixes and tests that lock the behaviour in.
- **Definition of done**: the fix is tested (automated tests wherever the logic allows it), deployed, and documented (user help page and technical notes).

### Iterations
| Period | Goal | Delivered |
|---|---|---|
| **June** | MVP, then simplification | Public application form, booking, schedule. Then simplification: the “member” area is removed in favour of public, account-free links, and direct booking becomes the main flow instead of the placement algorithm. |
| **July** | Quality and user experience | Security fixes (XSS, access rules), a one-day timezone shift fixed, a design system with dark mode, loading and empty states, mobile layout. |
| **Late August** | Features for the new school year | Two booking modes, full-screen deliberations, group interviews, one account across several boards, strict isolation between associations. |
| **Early September** | Hardening before the campaign | First 36 security-rule tests, an audit (12 bugs fixed), cascading deletions, an algorithm audit (5 bugs fixed), interviewer continuity. |
| **Campaign week** (21–27 Sept.) | A daily feedback loop | **37 releases in 7 days**, each one triggered by feedback from the board during the live campaign (examples below). |

### Feedback handled during the campaign
| What the board reported | Root cause | Fix |
|---|---|---|
| “Why does this slot say *Full*?” | The calculation removed two interviewers for every nearby interview, even when those interviewers weren't available for that slot. | Only the people actually busy are removed. A test replays the exact case. |
| “I can't delete a candidate” | A query didn't filter by association: denied by the security rules for board members but allowed for the admin, so the bug never showed up in manual testing. | Filter added everywhere, plus a test that replays the deletion with a board account. |
| “Some people show up twice in the staff list” | A member invited by email who then signs in ends up with two records. | Records are grouped per person, and every action applies to all of them. |
| “The form link doesn't work” | The link had been copied along with the rest of the message (`%0A%0AViens…`). | Anything after the identifier is ignored, on every page. |
| “The CSV export makes no sense” | Unquoted headers (a comma shifted every column), and a separator Excel doesn't expect in French locales. | Export rewritten, empty columns removed. |
| “Two interviews overlap on the schedule” | Each card took the full height of its cell. | Simultaneous interviews side by side, with a wider column for that day. |

### Continuous quality
- **171 automated tests** in the production version (164 in this showcase), run on every push by continuous integration: security rules on the Firestore emulator, plus pure logic (interviewer assignment, slot capacity, scoring, form questions).
- **Every campaign bug becomes a test**: the real case is replayed so it can't come back.
- **Safety nets in production**: a 30-day recycle bin on every deletion, and deletion protection on the database.

### Next steps
Backlog prioritised after the campaign:
1. Automatic backups and point-in-time restore (requires Firebase's paid plan).
2. Notifications (interview confirmation and reminder by email), currently blocked by the school's email filtering.
3. End-to-end tests of the candidate flow in a real browser.
4. Campaign statistics for the board (slot fill rate, interviewer workload).

---

## Technical highlights

- **Security through Firestore rules** (`firestore.rules`): isolation per association (`ownsOrg`, `isSecge`); anonymous writes that are *bounded* rather than forbidden (a candidate can move their status forward, never back, and can't invent one); role creation that requires verifiable proof (an invite code, or the promotion of an existing membership).
- **Interviewer assignment** (`public/js/jury.js`): excludes interviewers already booked on an overlapping slot (breaks included), favours continuity (those who just finished an interview), balances the workload, and forces a hand-over after a set number of back-to-back interviews.
- **Slot capacity** (`public/js/capacite.js`): an interviewer only counts as free if they are free for the whole interview; a slot is only “full” once the people actually busy are removed, not a flat amount per interview.
- **Automatic placement** (`public/js/algo.js`): chronological greedy first-fit, idempotent, and aware of interviews that already took place.
- **Atomic operations**: moving to the recycle bin and deleting happen in a single Firestore batch (all or nothing); restoring is limited to the expected collections.
- **Performance**: independent reads run in parallel, the SDK is preloaded, and the navigation bar is rendered before any network call.
- **Accessibility**: keyboard navigation, `aria-*` attributes, WCAG AA contrast, light and dark themes.

## How the demo works

The demo site is built from `public/` by `scripts/build-demo.mjs`, **without modifying the application**:
- an *import map* points the Firebase modules to simulated versions (`demo/firebase/`): Firestore, Auth and Storage are emulated for the functions the app actually uses, with a database kept in the visitor's `localStorage`;
- `demo/seed.js` generates a consistent dataset (association, staff, availability, candidates, interviews, evaluations), dated relative to the day of the visit;
- paths are rewritten for GitHub Pages, which serves the site under `/cooptly/`.

The `.github/workflows/demo.yml` workflow runs the tests, then builds and publishes the demo on every push to `main`.

```bash
node scripts/build-demo.mjs /cooptly    # output in _site/
```

## Stack

- HTML5 + JavaScript (ES modules), no framework and no build step for the application.
- Firebase: Hosting, Firestore, Authentication (SDK v10 from a CDN).
- In-house design system (CSS custom properties, `public/css/main.css`).

## Tests

164 tests using `node:test`, run on every push by continuous integration:
- **Security rules** on the Firestore emulator (`@firebase/rules-unit-testing`): isolation between associations, account-free public flows, cascading deletions, recycle bin.
- **Pure logic**: interviewer assignment, slot capacity, scoring and ranking, question order, URL parameters.

```bash
cd tests
npm install
npm test          # starts the Firestore emulator and runs the tests serially
```

Requirements: Node 22+, Java (for the emulator) and `firebase-tools`.

---

## Running the project

1. Create a Firebase project with **Hosting**, **Firestore** and **Authentication** (email and password).
2. Paste the web app configuration into `public/js/firebase-config.js`.
3. Deploy:

```bash
firebase use --add            # pick the project
firebase deploy               # hosting + rules + indexes
```

4. Create a first account, then add it to the `platform_admins` collection to access the admin area.

## Project structure

```
public/
  index.html              sign in / sign up
  postuler.html           application form and booking          (public)
  dispos-publique.html    staff availability                    (public)
  evaluer-publique.html   panel evaluation                      (public)
  planning-public.html    read-only schedule                    (public)
  candidat.html           application tracking                  (public)
  planning.html           internal schedule for the board
  parametres.html         association settings
  secge/                  dashboard, candidates, evaluation form
  admin/                  platform administration
  js/                     shared logic (auth, panels, capacity, algorithm…)
firestore.rules           security rules
tests/                    rule and logic tests
demo/                     simulated Firebase and demo data
scripts/build-demo.mjs    builds the demo for GitHub Pages
```

## Author

Tom Mombrun
