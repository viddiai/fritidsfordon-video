# Fritidscenter – fordonsvideor

Gör automatiskt korta säljvideor (9:16 och 16:9) av varje husbil och husvagn på
[fritidscenter.se](https://fritidscenter.se), med svensk speakerröst och Såld-skylt när fordonet sålts.

```
fritidscenter.se ──synk var 30:e min──▶ databas ──kö──▶ manus (Claude) ──▶ röst (ElevenLabs) ──▶ Remotion 9:16 + 16:9
                                                                                                    │
                                                    granskningsvy  ◀──────────────────────────────────┘
                                                    (godkänn / underkänn / gör om)  ──▶  /api/videos (för publicering)
```

## Så funkar det

| Del | Fil | Kommentar |
|---|---|---|
| Hämtning | `src/lib/scrape.ts` | Läser sajtens öppna Empori-API: `/dsoApi/v1/objects` (alla fordon) och `/dsoApi/v1/object/{guid}` (säljtext, utrustning). Ingen browser behövs. Bilar (typ 3) ignoreras. |
| Synk | `src/lib/sync.ts` | Nya fordon läggs in och får video. Ändrat pris eller nya bilder ger ny video. Fordon som markeras sålda eller försvinner från sajten får en **Såld-version**. |
| Manus | `src/lib/script.ts` | Claude tittar på bilderna och läser annonsen, väljer 4–6 säljpunkter med passande bild och skriver speakertext. **Pris och månadskostnad skrivs aldrig av Claude** – de kommer direkt ur datan och läses upp med tal i ord. |
| Röst | `src/lib/voice.ts` | ElevenLabs, en replik per scen. Scenlängden anpassas efter repliken så att bild och ljud går i takt. |
| Mall | `src/video/VehicleVideo.tsx` | Remotion-mallen från PoC:n, nu datadriven: intro → säljpunkter → fakta → pris/kontakt. Såld-band i hörnet + "SÅLD" i slutet för sålda. |
| Kö | `src/lib/worker.ts` | Tabellen `videos` är kön (`FOR UPDATE SKIP LOCKED`). 3 försök per video. |
| Granskning | `src/server/app.ts` | Lista, spela upp båda formaten, godkänn/underkänn/gör om. `AUTO_APPROVE=true` hoppar över granskningen. |

## Kom igång lokalt

```bash
npm install
cp .env.example .env     # fyll i nycklar (allt är valfritt för ett första test)
npm run render-one 54103 # synkar sajten och renderar ett fordon
npm start                # granskningsvy på http://localhost:3000 + kö + schemalagd synk
```

Utan nycklar fungerar allt ändå: lokal databas (PGlite i `.data/`), reservmanus i stället för Claude och video utan röst.
Färdiga filer hamnar i `storage/videos/{fordons-id}/`.

Kommandon: `npm run sync`, `npm run worker`, `npm run server`, `npm run studio` (Remotion Studio för att justera mallen).

## Miljövariabler

Se `.env.example`. De viktigaste:

- `DATABASE_URL` – Supabase-anslutning (Project Settings → Database → Connection string, "Session pooler"). Schemat skapas automatiskt (`supabase/schema.sql`).
- `ANTHROPIC_API_KEY` – för manus och bildval.
- `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` (standard `4xkUqaR9MYOJHoaC1Nak`). Byt röst-id när Fritidscenters egen klonade röst finns.
- `ADMIN_PASSWORD` – lösenord till granskningsvyn (användare `admin`).
- `AUTO_APPROVE` – `true` när videor ska godkännas utan manuell granskning.
- `BACKFILL_LIMIT` – hur många av de nyaste fordonen som får video vid allra första synken (standard 10). Resten köas med en knapp under **Fordon**.

## Drift

`Dockerfile` kör allt i en container (`npm start`). Rendering kräver Chrome, så det behövs en vanlig server/container
(t.ex. Railway, Fly.io, Render eller en liten VPS) – inte serverless. Montera en volym på `/data` för videofilerna.
En 35-sekundersvideo i båda formaten tar några minuter på 2 vCPU.

## Senare

- Publicering till sajten, Instagram och Facebook: `GET /api/videos?status=approved` ger godkända videor med länkar.
- Brand kit (typsnitt, färger) läggs in i `src/video/VehicleVideo.tsx` (konstanten `BRAND`).
- Bakgrundsmusik.
