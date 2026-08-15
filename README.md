# peetukeskinen.github.io

Personal academic website of Peetu Keskinen — economist and doctoral researcher.

**Live at:** <https://peetukeskinen.github.io>

Plain static HTML and one CSS file. No framework, no build step, no dependencies,
no JavaScript. Editing a page means editing that page.

## Structure

```text
.
├── index.html          Home — name, role, research interests
├── research.html       Doctoral research projects; code and tools
├── publications.html   Bibliography by category
├── cv.html             Positions, teaching, funding; CV PDF goes here
├── contact.html        Email and profiles
├── css/style.css       All styling; numbered sections with comments
├── assets/             Images and the favicon
├── papers/             PDFs (working papers, appendices, CV)
├── .nojekyll           Serve files as-is, skipping Jekyll processing
└── README.md
```

## Editing content

Each page is self-contained. The header, navigation and footer are repeated in every
file; when a nav item changes, update it in all five pages.

Mark the current page in the nav with `aria-current="page"` — that attribute is what
styles the active link, so keep exactly one per page.

Two reusable patterns are documented as HTML comments in the files themselves:

- **Research entry** — see the template comment in `research.html`. A block takes a
  title, coauthors, status, abstract, and a list of links (PDF, code, supplementary
  material, replication files). Every part below the title is optional.
- **Bibliography entry** — see the template comment in `publications.html`. Each `<li>`
  is three lines: title and year, then coauthors and outlet, then links, with a
  hairline rule between entries. Keep the coauthor and outlet spans adjacent — CSS
  inserts the separating `·` only when both are present.

For a resource that is announced but does not exist yet, use
`<span class="pending">Draft not yet available</span>` instead of an anchor, so no
link points at a missing file.

### Adding the portrait

Save a square photo as `assets/portrait.jpg` (about 400×400 is plenty) and it
appears on the homepage automatically. Until that file exists the figure hides
itself, so the page never shows a broken image.

### Adding a PDF

Put the file in `papers/` and link it relatively, e.g.
`<a href="papers/my-paper.pdf">PDF</a>`.

To publish the CV, add `papers/peetu-keskinen-cv.pdf` and replace the placeholder
note in `cv.html` with a link to it (the required markup is in a comment there).

## Previewing locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. A plain server is enough — the site uses only
relative paths, so what you see locally is what GitHub Pages serves.

## Deployment

GitHub Pages builds from the **`main` branch, root (`/`)**. Pushing to `main`
publishes the site; it usually goes live within a minute.

```bash
git add -A
git commit -m "Update content"
git push
```

There is no GitHub Actions workflow — none is needed for a static site.
