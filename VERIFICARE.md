# Verificare software v6

Verificare efectuată la 4 noiembrie 2026, pe sursele incluse în pachetele v6. Aceste rezultate nu reprezintă un test fizic al modulelor sau al proiectului Firebase al utilizatorului.

## Compilare firmware

Comandă folosită: `arduino-cli compile --fqbn esp32:esp32:waveshare_esp32_s3_zero`, cu Arduino-ESP32 3.3.5, Firebase 4.4.17, OneWire 2.3.8 și DallasTemperature 4.0.5. A fost folosit un `config.h` de test, fără credențialele utilizatorului.

| Rezultat | Valoare |
|---|---|
| Compilare finală | Reușită |
| Program | 1.254.259 bytes / 1.310.720 bytes, raportat 95% |
| Variabile globale | 49.616 bytes / 327.680 bytes, raportat 15% |
| RAM rămasă conform compilatorului | 278.064 bytes |

Memoria disponibilă raportată de compilator nu este o măsurare a heap-ului în funcționare cu două conexiuni TLS. Versiunea 3.3.12 a core-ului nu a fost compilată separat în acest mediu.

## Teste C++ pe calculator

Au trecut testele de logică și testele care extrag funcțiile efective din firmware. Pinii, ceasul, cozile, sonda și Preferences sunt simulate în aceste teste.

- **Comenzi existente:** apăsare simplă/dublă/lungă, trepte PWM, cerere portal, prioritate locală, revizii și confirmări vechi.
- **Regresie v5.1:** parserul real a primit mesaje parțiale de releu, LED, nivel și telemetrie. O sută de mesaje numai pentru releu au păstrat cererea LED, PWM, nivelul și reviziile celorlalte câmpuri.
- **Protecție termică:** praguri valide 70/50 °C; citirile invalide nu declanșează și nu deblochează singure protecția; o cerere ON temporizată nu ocolește blocarea.
- **Întârziere:** ON și OFF, termen exact, fără execuție înainte de termen, finalizare, lipsa orei valide, termen expirat în timpul unei reporniri simulate.
- **Memorie:** funcția reală de temporizare a salvat și restaurat o înregistrare simulată; un ID finalizat nu s-a rearmat la primirea aceleiași configurații. Au fost testate eroarea de scriere și reluarea cu un program nou.
- **Program zilnic:** aliniere inițială, start/stop, interval peste miezul nopții și păstrarea comenzilor manuale până la următoarea limită programată.
- **Schimbarea orei:** calculele implementate pentru zonele oferite, trecerile europene din martie/octombrie 2026, ora repetată și ora inexistentă.
- **Validare:** configurație incompletă sau invalidă, anulare, ID, fus orar, interval și termen.

Scrierea fizică în flash/NVS, stabilitatea alimentării și accesul NTP nu au fost măsurate pe hardware.

## Interfață web

JavaScript-ul aplicației și service worker-ului a trecut verificarea sintactică. Exemplul de reguli a trecut parsarea JSON; regulile nu au fost instalate și nu au fost executate într-un emulator Firebase Rules.

Interfața a fost verificată în Chromium cu SDK Firebase simulat:

- **Autentificare:** configurare inițială, eroare de parolă, login, politica de persistență locală, reload, logout și ștergerea ciornelor temporizării la schimbarea autentificării.
- **Administrator/client:** setări, anularea schimbării proiectului, link client, meniu ascuns clientului, redenumire, creare cameră, respingere ID duplicat și fallback de copiere a linkului.
- **Comenzi manuale:** releu și LED în ambele sensuri, toate cele cinci niveluri, lipsa scrierii redundante pentru nivelul deja selectat, alt buton utilizabil cât o scriere așteaptă.
- **Temporizare:** ON/OFF, ambele moduri, acțiuni Aprinde/Stinge, ore zecimale, program 22:00–06:00, fus orar explicit, anulare chiar cu un câmp ore gol.
- **Separare camere:** salvările au vizat numai `led_timer` al camerei selectate; o salvare în așteptare nu a modificat formularul celeilalte camere.
- **Ciorne și conflicte:** editările au rezistat la actualizări de date/navigare; o schimbare remote a împiedicat suprascrierea accidentală până la reîncărcarea setărilor.
- **Confirmări:** ID-ul vechi nu a fost acceptat pentru noul program; au fost verificate afișările pending, armed, daily, done, disabled, waiting_clock, storage_error și invalid.
- **Cazuri negative:** firmware vechi, offline, refuz de scriere, număr de ore lipsă și ore start/stop identice.
- **Temperatură:** avertizare senzor, blocare termică prioritară, cerere ON cu ieșire OFF afișată distinct.

Au fost inspectate capturi la 1.280 px și 375 px, inclusiv revenirea desktop → telefon → desktop și fereastră scurtă. Nu s-a observat overflow orizontal sau suprapunere a câmpurilor; pagina permite derulare verticală pentru întregul formular. Etichetele mici și textele de stare măsurate au avut contrast minim 6,58:1 în starea testată. Nu au fost înregistrate erori JavaScript ale paginii în fluxurile parcurse.

## Ce rămâne de verificat pe instalație

Autentificarea reală, regulile reale, primirea și confirmarea prin stream, sincronizarea NTP, ceasul în lipsa internetului, comportamentul după pierderea alimentării, cele două module simultan, calitatea semnalului și proba de durată trebuie verificate pe montaj. Nu există o latență cloud maximă garantată și nu s-a efectuat un test continuu de 24 h.
