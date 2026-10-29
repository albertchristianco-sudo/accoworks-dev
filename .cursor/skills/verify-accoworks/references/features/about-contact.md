# About, contact and projects

Three single-section edition pages reuse the home sections at heading level 1. `/about/` holds the profile: bio, credentials, "Off the clock" and a link to remote coaching. `/contact/` holds the colophon: an email link plus Instagram, Facebook, LinkedIn and GitHub. `/projects/` holds the projects feature: the power tracker as the lead, then Character Forge (D&D builder), this site, Cortex Orchestrator, Life Dashboard and the business systems (`src/data/projects.ts`).

## Sub-features

- `about-profile` renders an h1 profile with photo, credentials and the "Read about remote coaching" link to `/coaching/`.
- `contact-colophon` renders an h1 colophon with `mailto:ac@accoworks.dev` and the social links (`rel="me"`).
- `projects-feature` renders an h1 ("Things I build") projects list. Only public projects carry a link (`Check your barangay`, `Open Character Forge`, `View the source`); private and internal ones are unlinked on purpose.

## How to get to it (user POV)

- Click `About`, `Contact` or `Projects` in the Main nav.
- Click `See what I build` on home, or `Projects` in the footer.

## Driving it with control-app

Preconditions:

- Baseline preconditions from the README hold.

- **About.** Run `control-app drive about-contact`. Step `about` opens `/about/`, reads the h1 and takes `about-desktop.png`. It then clicks "Read about remote coaching" and expects `/coaching/`.
- **Contact.** Step `contact` opens `/contact/` and checks that the h1 exists and that the `ac@accoworks.dev` link's href is `mailto:ac@accoworks.dev`. It does not click the link. See `contact-desktop.png`.
- **Projects.** Step `projects` opens `/projects/` and checks for an h1 and at least one link in `main` (3 at time of writing, reported as `links`). See `projects-desktop.png`.
- **Appearance.** Run `control-app shot /about/ --viewport mobile --full` (and the same for `/contact/` and `/projects/`).

## Gotchas

- Clicking a `mailto:` link would hand off to the OS mail client. Check the href instead.
- Project links that point at external sites (`https://forge.accoworks.dev/`, the GitHub repo; see `src/data/projects.ts`) are blocked by the network guard. Check them by href only.
- The about copy changes often (see git log). Assert structure (h1, the coaching link), not prose.
