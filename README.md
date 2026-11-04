# Lumină inteligentă web v6: temporizare LED

Păstrează autentificarea, rolurile, camerele, comenzile și aspectul aplicației Stream v5. Adaugă temporizare independentă pentru banda LED din fiecare cameră, executată de firmware-ul v6 pe ESP, nu de un cronometru în browser.

## Actualizare

Înlocuiește pe găzduirea/GitHub Pages existentă fișierele `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest` și `icon.svg`. Nu publica `config.h` al plăcii sau parola contului Firebase.

Încarcă firmware-ul v6 pe fiecare ESP pe care dorești temporizarea, cu propriul `ROOM_ID`. Nu trebuie șters nodul `sufragerie` sau `dormitor`. Camerele cu firmware vechi își păstrează comenzile manuale; temporizarea lor este dezactivată în interfață până când placa raportează `timer_supported: true`.

Pe aceeași adresă de găzduire, configurația și politica de păstrare a autentificării sunt menținute. Cheia locală de configurare nu s-a schimbat. Cache-ul aplicației are versiunea nouă `lumina-shell-timer-v6`; închide și redeschide aplicația/reîncarcă pagina după înlocuirea fișierelor, fără să ștergi inutil datele site-ului.

Dacă salvarea este refuzată de Firebase, urmează `REGULI-TEMPORIZARE.md`. Exemplul complet de reguli nu se aplică automat și nu trebuie lipit peste reguli funcționale fără verificarea UID-urilor și permisiunilor.

## Două moduri

- **Întârziere:** ON, număr de ore între 0,01 și 720, acțiune Aprinde/Stinge, apoi „Pornește / repornește întârzierea”. 0,5 înseamnă 30 minute, 1,5 înseamnă 90 minute.
- **Program zilnic:** ON, ora de pornire, ora de oprire și fusul orar al camerei, apoi „Salvează temporizarea”. La pornire aprinde banda, la oprire o stinge; se repetă zilnic. Acceptă intervale peste miezul nopții.
- **Anulare:** OFF, apoi salvare. Nu schimbă imediat starea benzii, ci dezactivează programul.

Există un singur program activ pe cameră. ON/OFF și editările nu se aplică înainte de salvare. Dacă editezi formularul, o actualizare de temperatură sau trecerea la altă cameră nu șterge editările; dacă altă sesiune schimbă programul între timp, trebuie reîncărcate setările înainte de salvare.

Comenzile manuale nu anulează întârzierea. Pentru programul zilnic, o comandă manuală rămâne până la următoarea pornire/oprire programată. La activarea programului zilnic, ESP-ul aliniază imediat cererea LED la intervalul curent.

## Confirmare reală și funcționare fără telefon

„Setări trimise în Firebase” confirmă numai scrierea pe server. Așteaptă „Confirmat pe ESP”, pentru același identificator de program, înainte de a considera că placa l-a primit.

Numărătoarea din aplicație este doar informativă. Executarea este în ESP, cu setările salvate în NVS și ceas sincronizat prin NTP. După sincronizarea inițială, programul poate continua cu telefonul închis și fără internet cât timp placa rămâne alimentată. După pierderea alimentării, fără RTC extern, are nevoie de sincronizarea orei înainte de executare.

Dacă apare „Așteaptă sincronizarea orei”, verifică accesul ESP-ului la internet/NTP. Eroarea de memorie sau configurația invalidă sunt afișate distinct. După o întârziere terminată, selectează ON și salvează pentru una nouă.

Un ON temporizat schimbă cererea LED, dar nu anulează protecția de 70/50 °C. Banda poate rămâne BLOCATĂ dacă există supratemperatură. Temporizarea nu comandă releul și nu modifică luminozitatea.

## Siguranță și permisiuni

Autentificarea persistentă și separarea meniului administrator/client sunt păstrate. Ascunderea unui meniu nu este autorizare: accesul real este impus de Firebase Rules. Exemplul moștenit permite tuturor utilizatorilor autentificați acces la clientul `luci`; nu izolează mai mulți clienți într-un proiect comun.

Politica existentă pentru citirile invalide ale sondei nu a fost schimbată: avertizare fără oprire automată dacă nu exista deja blocare termică. Fără senzor valid nu se poate detecta supraîncălzirea; este recomandată o protecție termică hardware.

## Verificare

Compilarea firmware-ului, testele de logică și verificările UI sunt rezumate în `VERIFICARE.md`. Browserul a fost testat cu Firebase simulat, nu cu modificări în proiectul tău real; trebuie verificată separat instalarea pe cele două module.
