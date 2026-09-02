# GoGlobal UAE — lead intake

Static site plus a single POST controller that takes the contact form, sends
the lead as JSON to the **tglk webhook**, and emails the visitor a confirmation.

## Layout

| Path | What it is |
|---|---|
| [ambassador.html](ambassador.html) | The page with the contact form |
| [lib/ambassador-client.js](lib/ambassador-client.js) | Reads the ambassador name from the URL, remembers it 30 days |
| [lib/payload.js](lib/payload.js) | Validation + the exact JSON envelope that is sent |
| [lib/webhook.js](lib/webhook.js) | Posts the envelope to the webhook, with retries |
| [lib/mailer.js](lib/mailer.js) | Confirmation email via SMTP |
| [netlify/functions/data.js](netlify/functions/data.js) | The `POST /api/data` controller |
| [test/local-server.js](test/local-server.js) | Runs the site and the function locally |
| [test/post-test.js](test/post-test.js) | 26 checks over the whole flow |

## Run it

```bash
npm install
cp .env.example .env      # fill in WEBHOOK_URL + SMTP
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

That exact object is POSTed to `WEBHOOK_URL`. The webhook is the only
destination — nothing talks to the amoCRM API directly; the hook handles
everything on the CRM side.

A transient failure is retried twice with a short backoff, since a duplicate
lead costs less than a lost one. A 4xx other than 429 is not retried, and every
failed attempt is logged.

## Deploy

Netlify, `publish = "."`. Set `WEBHOOK_URL` and the `SMTP_*` vars from
`.env.example` in Site settings → Environment variables. `netlify.toml` maps `/api/data` to the
function and `/ambassador/*` to the page.
