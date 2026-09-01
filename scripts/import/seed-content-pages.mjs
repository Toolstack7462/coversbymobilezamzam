/**
 * The merchant's content pages.
 *
 * `pages` and `page_translations` have been in the schema since the first
 * migration with nothing reading or writing them, so the shop had a catalogue
 * and nothing else: no About, no contact page, no guides. This seeds the set a
 * shop of this kind needs, in both locales.
 *
 * ── The rule every word here follows ─────────────────────────────────────────
 *
 * Nothing is claimed that the shop's own settings do not support.
 *
 * `shipping.enabled` and `pickup.enabled` are both FALSE, so there is no
 * delivery page and no returns policy here — writing one would be inventing a
 * commercial commitment on a real business's behalf, and the customer would
 * find out it was false after paying. Those pages belong to the merchant, once
 * they decide what they offer.
 *
 * What IS written: the shop, where it is, when it is open, how to reach it, and
 * how to choose between accessories. The last of those is general technical
 * knowledge — watts, connectors, glass — not a promise, so it can be written
 * honestly by anyone who knows the subject.
 *
 * Legal pages are deliberately absent: `legal_documents` and its admin screen
 * already own privacy and terms, and those must be the merchant's own words
 * reviewed by someone qualified, never seeded text that merely looks official.
 *
 *   node scripts/import/seed-content-pages.mjs --env preview --remote
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const ENVIRONMENT = args.indexOf("--env") >= 0 ? args[args.indexOf("--env") + 1] : null;
const REMOTE = args.includes("--remote");

const PAGES = [
  {
    slug: "chi-siamo",
    order: 1,
    it: {
      title: "Chi siamo",
      excerpt:
        "Un negozio a Sulmona dove l'accessorio giusto si sceglie guardando il telefono che hai in mano.",
      body: [
        "Covers by Mobile è un negozio di accessori per smartphone a Sulmona. Vendiamo cover, pellicole, caricatori, cavi e power bank, montiamo la protezione dello schermo al banco e ci occupiamo di riparazioni.",
        "",
        "## Perché esistiamo",
        "Comprare un accessorio online è facile. Comprare quello giusto, no. La misura sbagliata di una cover, un caricatore che eroga meno watt di quanti il telefono ne accetti, una pellicola tagliata per un modello simile ma non identico: sono errori che si scoprono dopo, quando il pacco è già arrivato.",
        "",
        "Qui il modello del telefono è il punto di partenza, non un dettaglio nella descrizione. Ogni prodotto dichiara per quali dispositivi è compatibile, e la compatibilità è un dato registrato, non una parola nel titolo.",
        "",
        "## Il banco",
        "La differenza tra un negozio e un magazzino è che al banco si può guardare. Portaci il telefono: la pellicola la applichiamo noi, la cover la provi prima di pagarla, e se un accessorio non è adatto te lo diciamo invece di vendertelo.",
        "",
        "## Dove siamo",
        "Viale della Repubblica 8a, dentro il Centro Il Nuovo Borgo, negozio 6, a Sulmona. Siamo aperti tutti i giorni dalle 09:00 alle 20:00.",
      ].join("\n"),
    },
    en: {
      title: "About us",
      excerpt:
        "A shop in Sulmona where the right accessory is chosen by looking at the phone in your hand.",
      body: [
        "Covers by Mobile is a mobile phone accessory shop in Sulmona, Italy. We sell cases, screen protection, chargers, cables and power banks, we fit screen protection over the counter, and we handle repairs.",
        "",
        "## Why we exist",
        "Buying an accessory online is easy. Buying the right one is not. A case in the wrong size, a charger that delivers fewer watts than the phone will accept, a protector cut for a similar but not identical model: these are mistakes you discover afterwards, once the parcel has arrived.",
        "",
        "Here the phone model is the starting point, not a detail in the description. Every product states which devices it fits, and that compatibility is recorded data rather than a word in a title.",
        "",
        "## The counter",
        "The difference between a shop and a warehouse is that at a counter you can look first. Bring us the phone: we fit the protector, you try the case before paying for it, and if an accessory is not right for your phone we say so instead of selling it to you.",
        "",
        "## Where we are",
        "Viale della Repubblica 8a, inside Centro Il Nuovo Borgo, unit 6, Sulmona. Open every day from 09:00 to 20:00.",
      ].join("\n"),
    },
  },
  {
    slug: "contatti",
    order: 2,
    it: {
      title: "Contatti",
      excerpt: "Telefono, WhatsApp e l'indirizzo del negozio.",
      body: [
        "Il modo più veloce per sapere se abbiamo quello che ti serve è chiedercelo, con il modello del telefono alla mano.",
        "",
        "## Negozio",
        "Viale della Repubblica 8a, Centro Il Nuovo Borgo, negozio 6 — 67039 Sulmona (AQ)",
        "",
        "## Orari",
        "Tutti i giorni, dalle 09:00 alle 20:00.",
        "",
        "## Telefono e WhatsApp",
        "+39 350 881 6173",
        "",
        "Su WhatsApp puoi mandarci direttamente il modello del telefono, o una foto del retro se non sei sicuro di quale sia.",
        "",
        "## Cosa portare in negozio",
        "- Il telefono, non solo il nome del modello",
        "- La cover che usi adesso, se cerchi qualcosa di simile",
        "- Il caricatore attuale, se il problema è la velocità di ricarica",
      ].join("\n"),
    },
    en: {
      title: "Contact",
      excerpt: "Phone, WhatsApp and the shop address.",
      body: [
        "The fastest way to find out whether we have what you need is to ask us, with the phone model to hand.",
        "",
        "## Shop",
        "Viale della Repubblica 8a, Centro Il Nuovo Borgo, unit 6 — 67039 Sulmona (AQ), Italy",
        "",
        "## Opening hours",
        "Every day, 09:00 to 20:00.",
        "",
        "## Phone and WhatsApp",
        "+39 350 881 6173",
        "",
        "On WhatsApp you can send us the phone model directly, or a photo of the back if you are not sure which one it is.",
        "",
        "## What to bring",
        "- The phone itself, not just the model name",
        "- The case you use now, if you want something similar",
        "- Your current charger, if the problem is charging speed",
      ].join("\n"),
    },
  },
  {
    slug: "come-scegliere-il-caricatore",
    order: 3,
    it: {
      title: "Come scegliere il caricatore",
      excerpt: "Cosa vogliono dire i watt, e perché il numero più alto non è sempre quello giusto.",
      body: [
        'Un caricatore non "spinge" corrente dentro il telefono. È il telefono a chiedere quanta ne vuole, e il caricatore risponde fino al massimo che sa erogare. Per questo un caricatore da 65 W non danneggia un telefono che ne accetta 25: gliene eroga 25.',
        "",
        "## Il numero che conta è quello del telefono",
        "Ogni telefono ha una potenza massima di ricarica. Superarla non serve: un caricatore più potente non lo ricarica più in fretta del suo limite. Quello che cambia è che lo stesso caricatore potrà ricaricare anche un tablet o un portatile.",
        "",
        "## Il cavo fa parte del caricatore",
        "È la parte che quasi tutti dimenticano. Un cavo economico può limitare la ricarica anche con un ottimo alimentatore, perché la potenza che passa dipende anche da lui. Se la ricarica è lenta e l'alimentatore è giusto, il sospetto numero uno è il cavo.",
        "",
        "## Le sigle",
        "- USB-C PD (Power Delivery) è lo standard che quasi tutti i telefoni recenti usano",
        "- Alcune marche Android usano protocolli propri per raggiungere la velocità massima",
        "- Un caricatore senza PD funziona, ma alla velocità più bassa",
        "",
        "## In pratica",
        "Dicci quale telefono hai. La potenza che accetta è un dato del modello, non un'opinione, e su ogni prodotto trovi indicati i watt e il connettore.",
      ].join("\n"),
    },
    en: {
      title: "How to choose a charger",
      excerpt: "What the watts mean, and why the biggest number is not always the right one.",
      body: [
        "A charger does not push power into a phone. The phone asks for how much it wants, and the charger answers up to the maximum it can supply. That is why a 65 W charger does not damage a phone that accepts 25 W: it supplies 25 W.",
        "",
        "## The number that matters is the phone's",
        "Every phone has a maximum charging power. Going above it achieves nothing — a more powerful charger will not charge it faster than its own limit. What changes is that the same charger can also charge a tablet or a laptop.",
        "",
        "## The cable is part of the charger",
        "This is the part almost everyone forgets. A cheap cable can limit charging even with an excellent power adapter, because the power that gets through depends on it too. If charging is slow and the adapter is right, the cable is the first suspect.",
        "",
        "## The acronyms",
        "- USB-C PD (Power Delivery) is the standard nearly all recent phones use",
        "- Some Android manufacturers use their own protocols to reach top speed",
        "- A charger without PD works, but at the slowest speed",
        "",
        "## In practice",
        "Tell us which phone you have. The power it accepts is a fact about the model, not an opinion, and every product states its wattage and connector.",
      ].join("\n"),
    },
  },
  {
    slug: "come-scegliere-la-protezione",
    order: 4,
    it: {
      title: "Come scegliere la protezione",
      excerpt: "Cover e pellicole: da cosa proteggono davvero, e da cosa no.",
      body: [
        "Le cadute non sono tutte uguali, e nessun accessorio protegge da tutte. Vale la pena sapere da cosa ti stai proteggendo prima di scegliere.",
        "",
        "## La pellicola protegge dai graffi, la cover dagli urti",
        "Un vetro temperato assorbe l'impatto sullo schermo e si rompe al posto suo. Non impedisce alla scocca di ammaccarsi. Una cover con i bordi rialzati tiene lo schermo sollevato dal tavolo: è la ragione per cui i bordi sono rialzati.",
        "",
        "## La misura è del modello, non della famiglia",
        "Due telefoni della stessa serie possono avere le fotocamere in posizione diversa. Una pellicola tagliata per il modello sbagliato lascia scoperto un angolo, e l'angolo scoperto è dove parte la crepa.",
        "",
        "## Materiali",
        "- TPU morbido: assorbe bene, tende a ingiallire col tempo",
        "- Policarbonato rigido: resta trasparente, trasmette più urto",
        "- Silicone: buona presa in mano, attira la polvere",
        "- MagSafe e magnetici: magneti integrati, per attacco e ricarica",
        "",
        "## L'applicazione",
        "Una pellicola applicata storta, o con una bolla sotto, protegge quanto una applicata bene ma si vede tutti i giorni. Se la acquisti da noi te la montiamo al banco.",
      ].join("\n"),
    },
    en: {
      title: "How to choose protection",
      excerpt:
        "Cases and screen protection: what they actually protect against, and what they do not.",
      body: [
        "Not all drops are the same, and no accessory protects against all of them. It is worth knowing what you are protecting against before choosing.",
        "",
        "## Screen protection stops scratches, a case stops impacts",
        "Tempered glass absorbs an impact on the screen and breaks instead of it. It does not stop the body of the phone denting. A case with a raised lip holds the screen off the table — that is what the lip is for.",
        "",
        "## The fit belongs to the model, not the family",
        "Two phones in the same series can have cameras in different places. A protector cut for the wrong model leaves a corner exposed, and the exposed corner is where the crack starts.",
        "",
        "## Materials",
        "- Soft TPU: absorbs well, tends to yellow over time",
        "- Hard polycarbonate: stays clear, transmits more shock",
        "- Silicone: good grip, attracts dust",
        "- MagSafe and magnetic: built-in magnets, for attaching and charging",
        "",
        "## Fitting",
        "A protector fitted crooked, or with a bubble under it, protects as well as one fitted properly but you see it every day. If you buy it from us we fit it over the counter.",
      ].join("\n"),
    },
  },
  {
    slug: "compatibilita",
    order: 5,
    it: {
      title: "Come verifichiamo la compatibilità",
      excerpt: "Perché qui la compatibilità è un dato, non una parola nel titolo.",
      body: [
        "La maggior parte dei negozi online scrive il modello nel titolo del prodotto e lascia al cliente il compito di controllare. Funziona finché i nomi sono chiari, e i nomi non sono chiari.",
        "",
        "## Cosa facciamo invece",
        "Ogni prodotto è collegato ai modelli con cui è compatibile, uno per uno. Quando scegli il tuo telefono, il catalogo mostra solo quello che gli va bene, perché sta leggendo quel collegamento e non il titolo.",
        "",
        "## I tre casi",
        "- Compatibile: verificato su quel modello esatto",
        "- Universale: non dipende dal modello, come molti cavi e caricatori",
        "- Non compatibile: te lo diciamo, invece di lasciartelo scoprire",
        "",
        "## Se il tuo modello non c'è",
        "Vuol dire che non lo abbiamo ancora registrato, non che non abbiamo niente per te. Scrivici il modello su WhatsApp e lo guardiamo insieme.",
      ].join("\n"),
    },
    en: {
      title: "How we check compatibility",
      excerpt: "Why compatibility here is recorded data, not a word in a title.",
      body: [
        "Most online shops put the model in the product title and leave the checking to the customer. That works as long as the names are clear, and the names are not clear.",
        "",
        "## What we do instead",
        "Every product is linked to the models it fits, one by one. When you pick your phone, the catalogue shows only what suits it, because it is reading that link rather than the title.",
        "",
        "## The three cases",
        "- Compatible: verified on that exact model",
        "- Universal: does not depend on the model, as with most cables and chargers",
        "- Not compatible: we tell you, rather than letting you find out",
        "",
        "## If your model is not listed",
        "It means we have not registered it yet, not that we have nothing for you. Send us the model on WhatsApp and we will look at it together.",
      ].join("\n"),
    },
  },
];

const esc = (v) => String(v).replace(/'/g, "''");
const now = Date.now();
const work = mkdtempSync(join(tmpdir(), "ita-pages-"));

const statements = [];
for (const page of PAGES) {
  const id = `page_${page.slug.replace(/-/g, "_")}`;
  statements.push(
    `INSERT INTO pages (id, slug, status, page_type, sort_order, created_at, updated_at)
     VALUES ('${id}', '${page.slug}', 'published', 'page', ${page.order}, ${now}, ${now})
     ON CONFLICT(slug) DO UPDATE SET status = 'published', sort_order = ${page.order}, updated_at = ${now};`,
  );
  for (const [locale, copy] of [
    ["it", page.it],
    ["en", page.en],
  ]) {
    statements.push(
      `INSERT INTO page_translations (id, page_id, locale, title, excerpt, body, seo_title, seo_description)
       VALUES ('${id}_${locale}', '${id}', '${locale}', '${esc(copy.title)}', '${esc(copy.excerpt)}',
               '${esc(copy.body)}', '${esc(copy.title)}', '${esc(copy.excerpt)}')
       ON CONFLICT(page_id, locale) DO UPDATE SET
         title = excluded.title, excerpt = excluded.excerpt, body = excluded.body,
         seo_title = excluded.seo_title, seo_description = excluded.seo_description;`,
    );
  }
}

/*
 * Written to a file rather than passed as `--command`.
 *
 * Windows caps a command line at about 32k characters and these bodies are
 * comfortably past it. The failure mode is `spawnSync ENAMETOOLONG`, which says
 * nothing about the actual problem — it has already cost this project an
 * afternoon once.
 */
const file = join(work, "pages.sql");
writeFileSync(file, statements.join("\n"), "utf8");

execFileSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "DB",
    ...(ENVIRONMENT ? ["--env", ENVIRONMENT] : []),
    REMOTE ? "--remote" : "--local",
    "--file",
    file,
  ],
  { stdio: "inherit" },
);

rmSync(work, { recursive: true, force: true });

console.log(`
${PAGES.length} pages published in Italian and English:
${PAGES.map((p) => `  /pagine/${p.slug}`).join("\n")}

No shipping or returns page: shipping.enabled and pickup.enabled are both false,
and writing a delivery promise the shop has not made would be an invention the
customer discovers after paying. No privacy or terms either — those belong to
the legal_documents system and must be the merchant's own reviewed words.
`);
