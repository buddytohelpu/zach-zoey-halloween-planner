# Zach & Zoey Halloween Party Planner

This is a small Vercel app. It uses the supplied site-plan image as the map, gates the board with the shared party password, and stores the working layout in a shared Upstash/Vercel KV document so every browser sees the same markers.

## Run locally

Open `index.html` directly for a local-only draft, or serve the folder so the image and scripts load consistently:

```powershell
py -3.12 -m http.server 4173
```

Then open `http://localhost:4173/`.

The local-only version accepts `ZachZoey` in the password screen and saves to that browser. Shared saving is provided by the Vercel functions after deployment.

## Deploy

The repository can be imported into Vercel with no build command or output directory. In the Vercel project, create an Upstash Redis/Vercel KV store and add these environment variables for Production and Preview:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `PLAN_PASSWORD` = `ZachZoey`
- `PLAN_SESSION_SECRET` = a long random value

The API accepts only the authenticated session cookie, and plan writes use a revision check plus an item merge when two browsers save close together.

Use the download icon in the header to export a JSON backup before changing storage settings or switching devices.
