# TfL Status Page

Live bus and rail departures for **Latchmere Lane**, **Kingston**, and **Norbiton**, published on GitHub Pages.

**Live site:** [https://danielnguyen15555.github.io/](https://danielnguyen15555.github.io/)

## What it shows

- Live TfL bus arrivals at Latchmere Lane (westbound)
- South Western Railway departures from Kingston (KNG) and Norbiton (NBT) toward Waterloo
- Delay / cancellation awareness from the live rail feed
- Multilingual welcome screen and optional spoken announcements UI

## Project layout

| Path | Role |
| --- | --- |
| `index.html` | Page structure |
| `css/style.css` | Styles |
| `js/script.js` | Live feeds, UI, and i18n |

## Data sources

- Bus predictions: [TfL Unified API](https://api.tfl.gov.uk/) (`StopPoint` arrivals)
- Rail departures: [Rail Info UK](https://api.railinfo.uk/) station boards

No API keys are required for the public endpoints used here.

## Local preview

Serve the repo root over HTTP (file:// will block some fetches):

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open [http://127.0.0.1:8000/](http://127.0.0.1:8000/).

## Deploy

Push to `main` on this repository. GitHub Pages serves the site from the root of `main`.
