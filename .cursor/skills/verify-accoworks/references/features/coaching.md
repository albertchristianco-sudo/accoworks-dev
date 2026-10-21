# Remote coaching application

`/coaching/` is an unlisted (noindex) page that describes Ac's remote coaching ($150 USD/month, 3-month commitment, "1 slot open") and carries an application form. On submit the page POSTs JSON to `/api/coaching`, a Pages Function that emails the application to Ac through Resend. On success the form hides and a focused "Received" box appears. On failure the status line shows the server's reason and the button comes back.

## Sub-features

- `coach-page` shows h1 "Remote coaching", the price box, the copy and `meta robots noindex`.
- `coach-validate` lets browser validation block an empty or invalid submit (Name, Email, Current training and Goal are `required`).
- `coach-fill` covers the Name, Email, Experience level (select, default Intermediate), Current training, Goal and Why me (optional) fields, plus a hidden honeypot "Company".
- `coach-submit-ok` hides the form after a 200 `{ok:true}`, then shows and focuses `[data-done]` "Received".
- `coach-submit-error` shows the server `error` text in `[data-status][data-tone=error]` after a 4xx `{error}` and re-enables the button.
- `coach-noscript` hides the form and shows the email fallback when JS is off.

## How to get to it (user POV)

- Click "Read about remote coaching" on `/about/` or in the home profile section.
- Visit `/coaching/` directly. It is not in the nav or the footer.

## Driving it with control-app

Preconditions:

- Baseline preconditions from the README hold.
- Nothing may reach the real `/api/coaching`: it sends an email to Ac. The drive always stubs it in the browser.

- **Open.** Run `control-app drive coaching-form`. Step `open-coaching` checks the h1, the `noindex` robots meta, and that `#intake-form` and the "Send my application" button are visible.
- **Empty submit.** Step `empty-submit` presses the button with everything empty. Expect no `/api/coaching` request, Name `:invalid`, and "Received" still hidden.
- **Fill.** Step `fill` fills each field by its label, using marked test values (`Verify Bot`, `verify-bot@example.invalid`, "Verification run: ..."), and selects `Advanced`. It reads every value back and checks the honeypot is empty. `coaching-filled-desktop.png` is a full-page shot of the filled form.
- **Submit, success (stubbed).** Step `submit-stubbed` presses the button. `POST /api/coaching` is fulfilled in the browser with `{ok:true}`. It checks for exactly one captured POST whose body matches every typed value (`company: ""`), a hidden form, and a visible and focused "Received" box. See `coaching-submitted-ok-desktop.png` and `captured` in the result JSON.
- **Submit, error (stubbed).** Run `control-app drive coaching-form --stub error`. The stub returns 400 `{error:"That email address does not look valid."}`. Expect that exact status text, an enabled button and a visible form. See `coaching-submitted-error-<viewport>.png`.
- **Fill only.** Run `control-app drive coaching-form --dry-run`. The submit button is never pressed. Check `captured: []` and `apiRequests: []` in the JSON.
- **Mobile.** Add `--viewport mobile` to any of the above.
- **Appearance.** Run `control-app shot /coaching/ --viewport desktop` and `--viewport mobile`. Add `--full` to include the form.

## Gotchas

- Do not submit the form against production or a Pages preview deploy with real secrets. Every real submission emails Ac and counts against a per-IP limit (5/hour in KV).
- The server-side rules (required name/email, email regex, training-or-goal, honeypot "pretend success", rate limit) live in `functions/api/coaching.js`. `tests/` covers them, not this drive. The browser only enforces the HTML `required` attributes.
- Without the stub, the local POST returns a 404 from preview. The page then shows the generic "Something went wrong..." message, which is not the server's validation.
- Field labels are the stable handles. "Why me" carries an "Optional" span, so it matches by substring, not exactly.
- The "Received" box is excluded from the reveal animation (`.sidebox:not(.coach__done)`), so it shows immediately.
