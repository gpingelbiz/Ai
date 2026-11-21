# GHL: seat expiration, deposits and the price lock

Draft 2026-11-21. Build these in GoHighLevel. n8n handles the attendance data pull.

The job: every build client's team gets 90 days of Closer Room. The renewal is decided by the team's own numbers, shown on day 60 and sold on day 75.

---

## Setup

**Custom fields (contact = the coach)**
- `build_start_date` (date)
- `seat_count` (number)
- `seat_end_date` (date, = build_start_date + 90 days)
- `seat_attendance_pct` (number, written by n8n)
- `team_close_rate_start` / `team_close_rate_now` (number)
- `team_show_rate_start` / `team_show_rate_now` (number)
- `renewal_status` (dropdown: open, booked, renewed team, renewed partial, expired)

**Custom fields (contact = each seat holder)**
- `seat_owner_coach` (contact lookup or coach email)
- `seat_type` (build seat, paid seat)
- `sessions_attended_30d` (number, written by n8n)

**Tags:** `build-seats-active`, `seat-holder`, `seat-inactive`, `renewal-call-booked`, `seats-renewed`, `seats-expired`, `price-lock`

**Pipeline: Seat Renewal**
Stages: Seats active → Day 60 report sent → Renewal call booked → Renewal offer sent → Renewed / Expired

**Membership:** Closer Room product with an offer called "Build seats (90 day)": $0, access set to end on `seat_end_date`.

**n8n job (weekly, Mondays):** pulls live session attendance and community logins for every seat holder, writes `sessions_attended_30d` per seat and `seat_attendance_pct` per coach, then tags any seat with 0 sessions in 14 days as `seat-inactive`.

---

## Workflow A: Seat activation (trigger: build payment received)

1. Set `build_start_date` = today, `seat_end_date` = today + 90, `seat_count` from the scope.
2. Add tag `build-seats-active`. Create an opportunity in Seat Renewal → Seats active.
3. Email the coach: seat invite link + "send this to your closers and setters."
4. When each seat holder signs up through the link: tag `seat-holder`, set `seat_owner_coach`, grant the 90 day offer.

**Email to the coach (day 0)**
> Subject: Your team's Closer Room seats
>
> [First name], your build comes with [seat_count] Closer Room seats for 90 days.
>
> Send this link to your closers and setters: [link]
>
> Every week they get a live call review and a roleplay block. Their calls get better while we build the system under them.
>
> Seats run through [seat_end_date]. Get them in this week so they don't miss the first review.
>
> Greg

**Email to each seat holder (on signup)**
> Subject: You're in
>
> Live call review is [day, time]. Bring a recording.
>
> Roleplay is [day, time]. Bring the objection that cost you a deal this week.
>
> Your first job: post your daily floor in the group. Calls, follow-ups, conversations.

---

## Workflow B: Seat engagement (runs for 90 days)

| Day | Action |
|---|---|
| 7 | If a seat isn't signed up: text the coach. "[x] of your [seat_count] seats are still empty. Want me to resend the link?" |
| 14, 28, 42 | For seats tagged `seat-inactive`: text the seat holder. "Missed you on review this week. Bring one call Thursday." |
| 30 | Email the coach the day 30 report (attendance + first numbers). |
| 45 | If `seat_attendance_pct` < 40: task for Greg. Call the coach and get the team back in. A seat nobody uses won't renew. |

---

## Workflow C: Renewal (the money part)

**Day 60: report**
- Generate the day 60 report: attendance per seat, close rate and show rate now vs start, the 3 calls that improved most.
- Email it with a booking link for the renewal call. Move to → Day 60 report sent.

> Subject: Your team at day 60
>
> [First name], here's where your team is.
>
> Close rate: [team_close_rate_start] → [team_close_rate_now]
> Show rate: [team_show_rate_start] → [team_show_rate_now]
> Live sessions attended: [seat_attendance_pct]%
>
> Seats end [seat_end_date]. Book 20 minutes and we'll decide what's next for the team: [link]

**Days 63 and 68: follow-up if not booked**
- Day 63 text: "Got your team's day 60 numbers in your inbox. 20 minutes this week? [link]"
- Day 68: task for Greg to call.

**Day 75: renewal call** (booked → tag `renewal-call-booked`, stage → Renewal call booked)
Three options on the call, in this order:
1. Managed System, [$3,000/mo], team seats included
2. Team rate, [$997/mo] for up to 5 seats
3. Single seats, [$297/mo] each

**Day 76: offer email** (stage → Renewal offer sent) with checkout links for all three, each with the price-lock line.

**Day 85: 5 day notice** (email to the coach, text to each seat holder)
> Coach: "[seat_count] seats end [seat_end_date]. Keep them here: [link]"
>
> Seat holder: "Your Closer Room seat ends [seat_end_date]. Tell your coach if you want to keep it, or keep it yourself at $297: [link]"

Note the seat holder option: reps who value it can keep their own seat even if the coach doesn't renew.

**Day 90: convert or expire**
- Paid → tag `seats-renewed`, `price-lock`, stage → Renewed, swap the 90 day offer for the paid one.
- Not paid → access ends, tag `seats-expired`, stage → Expired.

**Day 97: win-back** (expired only)
> "Your team's seats ended last week. If you want them back in at the same rate for the next 14 days: [link]. After that it's the current price."

---

## Workflow D: Build deposit

1. Trigger: deposit paid ([$1,000]). Tag `deposit-held`, set `deposit_date`.
2. Day 0: email with the booking link for the next cohort kickoff.
3. Day 14 and 25: reminder. "Your slot in the [month] cohort is held until [deposit_date + 30]."
4. Build paid within 30 days → apply the deposit as a [$1,000] coupon on the build invoice.
5. Day 30 with no build → grant [3] months of a Closer Room seat (or [$1,000] account credit). Email:
> "Your 30 days are up, so your full $1,000 is now Closer Room credit. That's [3] months of a seat. Here's your access: [link]. When you're ready to build, book here: [link]."

---

## Workflow E: Price lock

- Every membership checkout sets tag `price-lock` and the field `locked_rate`.
- Cancellation → remove `price-lock`. Rejoin checkout uses the current price.
- Price changes for new buyers: email existing locked members "Your rate is staying at [locked_rate]." That email is a retention touch on its own.

---

## Workflow F: Cancel (required for the subscription terms)

- Self-serve cancel link in the member portal and in every billing receipt.
- On cancel: confirmation email within 1 hour with the access end date. Access runs through the paid period.
- Keep the cancel button as easy to reach as the signup button. California's auto-renewal law requires online cancellation when the signup happened online.
