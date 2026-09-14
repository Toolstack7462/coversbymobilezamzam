# Guida al Centro di controllo

Per chi gestisce **Covers by Mobile Zam Zam**.

Questa guida non richiede conoscenze tecniche. Ogni cosa descritta qui si fa dal
pannello, con il telefono o con il computer del negozio: non serve nessuno che
scriva codice, e non serve toccare il database.

---

## 1. Entrare

L'indirizzo del pannello finisce con `/admin`.

Servono tre cose:

1. la vostra email;
2. la password;
3. il codice a sei cifre dell'app di autenticazione sul telefono.

**Il terzo non è un fastidio inutile.** Da questo pannello si cambiano i prezzi
e si conferma il denaro ricevuto: se qualcuno vi rubasse la password e basta,
non entrerebbe comunque.

Se perdete il telefono, usate uno dei **codici di recupero** salvati durante
l'attivazione. Ogni codice funziona una volta sola.

---

## 2. La Panoramica: cosa guardare per prima cosa

È la pagina che si apre entrando, ed è costruita attorno a una domanda: _cosa
devo fare adesso?_

**Da fare adesso** elenca solo le cose che aspettano una persona — pagamenti da
controllare, ritiri da preparare, scorte finite. Se è vuota, non c'è nulla in
sospeso. Non viene inventato niente per riempire lo spazio.

**Ultime 24 ore** dà due numeri grandi e alcuni contatori.

> **Attenzione a un numero in particolare.** _Valore degli ordini_ non è
> l'incasso. È quanto valgono gli ordini arrivati, e la maggior parte non è
> ancora stata pagata. Il denaro davvero ricevuto è _Pagamenti verificati_, e
> quello sale soltanto quando una persona ha controllato il conto.

**Funzioni nascoste sul sito** spiega perché una parte del sito non compare.
Se manca il numero di telefono nelle impostazioni, il sito non lo mostra: non
inventa un numero e non lascia uno spazio vuoto. Ogni riga dice cosa manca e
dove inserirlo.

---

## 3. Cercare qualsiasi cosa

In alto c'è una casella di ricerca. Cerca **ovunque**: ordini, prodotti,
clienti, modelli di telefono.

Serve quando avete in mano una cosa sola e non sapete in quale schermata sta:

- un cliente telefona e legge il numero d'ordine → scrivetelo lì;
- avete una scatola in mano → scrivete il codice SKU stampato sopra;
- vi ricordate solo il cognome → scrivete quello.

---

## 4. I prodotti

### Trovare

**Prodotti** mostra il catalogo. Ogni riga ha la foto, il nome, lo SKU, il
prezzo, le scorte e se è pubblicato — così si scorre la lista senza aprire
niente.

Le linguette in alto sono domande pratiche: _Senza prezzo_, _Senza immagine_,
_Senza compatibilità_ sono l'elenco di cosa resta da finire.

### Le scorte nella lista

Il numero è **quanto potete ancora vendere**: la giacenza meno i pezzi già
prenotati da ordini non pagati. Se un prodotto ha più varianti e una è finita,
accanto al numero compare _1 esaurita_ — perché il totale da solo nasconde che
il colore richiesto non c'è.

### Modificare

Aprite un prodotto. In alto c'è una barra con le sezioni: **Stato**,
**Dettagli**, **Varianti e prezzo**, **Foto**, **Compatibilità**. Cliccandone
una si salta lì: non serve scorrere tutta la pagina per cambiare un prezzo.

**Stato del prodotto** elenca cosa manca e cosa succede se resta così. Non è un
elenco di compiti: è la risposta a "perché non riesco a pubblicarlo".

### Pubblicare

Il pulsante **Pubblica sul sito** è nella sezione Pubblicazione.

**Un prodotto senza prezzo non può essere pubblicato.** Il pannello rifiuta e
spiega perché: sul sito comparirebbe una pagina che nessuno può acquistare.
Mettete prima il prezzo.

### Le specifiche tecniche

Nella sezione **Varianti**, sotto la tabella, ci sono le **specifiche
tecniche**: lunghezza, connettori, capacità, peso, dimensioni, pezzi nella
confezione.

**I campi cambiano a seconda del tipo di prodotto.** Un cavo vi chiede la
lunghezza e i connettori. Una cover no, e non vi chiede la capacità della
batteria: non ne ha una. Il tipo si sceglie in **Dettagli → Tipo di prodotto**,
e cambiandolo cambiano i campi.

Se il tipo non è impostato, i campi non compaiono affatto e il pannello ve lo
dice. Non è un errore: è che nessuno sa ancora che cosa chiedervi.

I numeri si scrivono come vengono: **10.000** e **10000** vanno bene entrambi.
Una lunghezza in millimetri: un cavo da un metro è **1000**.

### Duplicare un prodotto

Lo stesso articolo in un altro colore non si riscrive da capo. In fondo alla
pagina del prodotto c'è **Duplica prodotto**.

La copia arriva **in bozza**, con lo stesso nome più «(copia)», le stesse
descrizioni, le stesse foto, le stesse compatibilità e gli stessi prezzi.

> **Le giacenze partono da zero, sempre.** Una copia non è merce che avete in
> negozio: quanti pezzi ci sono davvero lo dite voi dall'inventario. I codici
> delle varianti finiscono con `-C`, così li riconoscete sulle scatole.

Dopo aver duplicato: cambiate il nome, controllate le compatibilità, registrate
le giacenze, poi pubblicate.

### Se due persone modificano insieme

Se qualcun altro salva lo stesso prodotto mentre voi lo avete aperto, il vostro
salvataggio viene **rifiutato** con un messaggio.

Non è un errore del programma: è la protezione. Se avesse salvato, avrebbe
cancellato il lavoro dell'altra persona senza dirlo a nessuno. Ricaricate la
pagina, guardate cosa è cambiato, e rifate la vostra modifica.

Accanto al pulsante Salva compare **l'ora dell'ultimo salvataggio riuscito**.
Quell'ora arriva dal server: se c'è, il dato è al sicuro.

---

## 5. Le scorte

**Inventario** mostra tre numeri per ogni variante, e sono diversi apposta:

|                 |                                                            |
| --------------- | ---------------------------------------------------------- |
| **Giacenza**    | i pezzi fisicamente in negozio                             |
| **Prenotato**   | pezzi già impegnati da ordini non ancora pagati            |
| **Disponibile** | giacenza meno prenotato — quello che potete ancora vendere |

**Prenotato non si modifica a mano.** Lo calcola il sistema dagli ordini veri.
Se si potesse correggere, si avrebbero due numeri in disaccordo e nessun modo di
sapere quale è giusto.

### Correggere una giacenza

Premete **Rettifica** sulla riga, scrivete la quantità reale e **il motivo**.

Il motivo è obbligatorio. Fra tre mesi, davanti a una differenza fra scaffale e
sistema, "2 mancanti al conteggio del lunedì" è la differenza fra una
spiegazione e un mistero. Ogni rettifica resta scritta in **Inventario →
Movimenti**.

---

## 6. Gli ordini

**Ordini** raggruppa per domanda pratica: _Da contattare_, _In attesa di
pagamento_, _Da preparare_.

Aprendo un ordine, la pagina è divisa in due:

- **a sinistra** l'ordine: articoli, totali, pagamento, cronologia;
- **a destra** chi contattare e cosa fare adesso.

Il numero di telefono del cliente è a destra, in alto, senza scorrere — perché
telefonare è la cosa che si fa più spesso da questa schermata.

### Gli articoli non cambiano mai

Nome, prezzo e quantità sono la **fotografia dell'ordine al momento
dell'acquisto**. Se domani cambiate il prezzo del prodotto, quell'ordine resta
com'era. È così che deve essere: il cliente ha comprato a quel prezzo.

### Spostare un ordine

Il menu **Sposta l'ordine a** mostra solo i passaggi legittimi da dove si trova
adesso. Non è un elenco libero di stati.

**"Pagato" non compare mai in quel menu.** Un ordine diventa pagato soltanto
verificando il pagamento, e la verifica è una persona che guarda il conto.

### WhatsApp

**Apri WhatsApp con il messaggio pronto** apre una chat con il numero lasciato
dal cliente e il riepilogo già scritto. Potete modificarlo prima di inviarlo.

Il messaggio contiene numero d'ordine, articoli e totale — **mai** l'indirizzo
né codici interni, perché una chat viene inoltrata e salvata altrove.

---

## 7. I pagamenti

**Pagamenti da verificare** è la coda dei clienti che dicono di aver pagato.

Verificare significa una cosa sola: **avete guardato il conto e i soldi ci
sono.** Non che è arrivata una schermata su WhatsApp — una schermata si
falsifica in trenta secondi.

Per questo la verifica chiede di reinserire le credenziali anche se avete già
fatto l'accesso, e resta scritta con il vostro nome e l'ora.

Se l'importo non corrisponde, il pannello ha stati diversi per _pagato in parte_
e _pagato in eccesso_: non forzate un "verificato" su un importo sbagliato.

---

## 8. I contenuti del sito

**Contenuti** permette di cambiare, senza nessun intervento tecnico:

- la fascia principale della homepage;
- il testo delle pagine;
- i menu e i link in fondo;
- i documenti legali.

**Impostazioni** contiene i dati del negozio: nome, indirizzo, orari, telefono,
WhatsApp, email, metodi di pagamento.

Ogni dato sta **in un posto solo**. Cambiando il numero di telefono lì, cambia
ovunque compaia sul sito: non va modificato in cinque punti.

Un campo vuoto **nasconde** la funzione che dipende da lui, invece di mostrare
uno spazio vuoto. La Panoramica elenca cosa è nascosto e perché.

---

## 9. Il personale

**Personale** serve a invitare un collega. Non esiste un modo per creare
l'account di qualcun altro scegliendo voi la sua password — riceve un invito e
la sceglie lui.

Ogni persona vede solo le sezioni per cui ha il permesso. Chi non può verificare
i pagamenti non vede quella voce nel menu, e se arrivasse all'indirizzo
direttamente il server rifiuterebbe comunque.

Un collega che se ne va va **sospeso**, non cancellato: la sua firma sugli
ordini e sulle verifiche deve restare leggibile.

---

## 10. Cosa fa il pannello per proteggervi

Vale la pena saperlo, perché a volte sembra che stia dicendo di no senza motivo.

| Rifiuta                               | Perché                                                        |
| ------------------------------------- | ------------------------------------------------------------- |
| Pubblicare un prodotto senza prezzo   | Sul sito ci sarebbe una pagina che nessuno può comprare       |
| Vendere l'ultimo pezzo due volte      | Il database rifiuta la seconda prenotazione, non il programma |
| Salvare sopra il lavoro di un collega | Meglio un rifiuto che una modifica sparita                    |
| Rettificare una scorta senza motivo   | Fra tre mesi nessuno ricorderebbe perché                      |
| Modificare "prenotato"                | Lo decidono gli ordini veri                                   |
| Segnare "pagato" da un menu           | Solo la verifica di una persona sposta il denaro              |
| Cancellare un prodotto già ordinato   | Si archivia: gli ordini storici restano leggibili             |

---

## 11. Se qualcosa non va

1. **Ricaricate la pagina.** Se il messaggio parla di un collega che ha
   salvato, è la risposta giusta.
2. **Guardate la Panoramica.** Se il negozio non è pronto a vendere, lo dice lì
   con la percentuale di configurazione.
3. **Aprite `/admin/sistema`.** Dice se il database e l'archivio dei file
   rispondono, e da quale versione del programma è servito il pannello.
4. **Non ci sono comandi da scrivere.** Nessuna operazione ordinaria di questa
   guida richiede il database o un terminale. Se qualcuno vi propone di
   "sistemarlo via SQL" per una modifica normale, manca una funzione al
   pannello: va segnalata.
