# GoGlobal UAE — lead intake

Static site plus a single POST controller that takes the contact form,
pushes the lead into **amoCRM**, and emails the visitor a confirmation.

## Layout

| Path | What it is |
|---|---|
| [ambassador.html](ambassador.html) | The page with the contact form |
| [lib/ambassador-client.js](lib/ambassador-client.js) | Reads the ambassador name from the URL, remembers it 30 days |
| [lib/payload.js](lib/payload.js) | Validation + the exact JSON envelope sent to the CRM |
| [lib/amocrm.js](lib/amocrm.js) | amoCRM v4 client (lead + contact + note) |
| [lib/mailer.js](lib/mailer.js) | Confirmation email via SMTP |
| [netlify/functions/data.js](netlify/functions/data.js) | The `POST /api/data` controller |
| [test/local-server.js](test/local-server.js) | Runs the site and the function locally |
| [test/post-test.js](test/post-test.js) | 25 checks over the whole flow |

## Run it

```bash
npm install
cp .env.example .env      # fill in amoCRM + SMTP
npm test                  # no credentials needed
node --env-file=.env test/local-server.js
```

Then open <http://localhost:8888/ambassador/Sergey> and submit the form.

## Ambassador links

All three forms are recognised and produce the same CRM `URL` value:

```
goglobal-uae.com/ambassador/Sergey
goglobal-uae.com/ambassador?=Sergey
goglobal-uae.com/ambassador.html?ref=Sergey
```

→ `"URL": "goglobal-uae.com/ambassador?=Sergey"`

The name is stored in `localStorage` for 30 days, so a visitor who arrives via
an ambassador link, browses, and submits later is still credited correctly.

## The payload

```json
{
  "ip": "3.17.184.97",
  "method": "POST",
  "URL": "goglobal-uae.com/ambassador?=Sergey",
  "user_agent": "axios/1.13.2",
  "get": {},
  "post": {
    "title": "Новый клиент",
    "name": "Salim",
    "email": "salimshorahmonov26@gmail.com",
    "phone": "+992300005588",
    "interest": "Other programs",
    "comment": "..."
  }
}
```

It goes to amoCRM as a lead (`POST /api/v4/leads/complex`) with an embedded
contact, and the full envelope is attached to the lead as a note so nothing is
lost even if a custom field id is missing.

## amoCRM credentials

amoCRM retired the old user-hash API key, so the "API key" here is a
**long-lived access token**: amoCRM → Settings → Integrations → your
integration → *Long-lived token*. Put it in `AMOCRM_TOKEN` and your account URL
in `AMOCRM_BASE_URL`. Field ids are optional — without them the lead is still
created, and every value survives in the note.

## Deploy

Netlify, `publish = "."`. Set every var from `.env.example` in
Site settings → Environment variables. `netlify.toml` maps `/api/data` to the
function and `/ambassador/*` to the page.
