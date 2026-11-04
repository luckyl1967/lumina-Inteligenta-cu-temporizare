# Permisiuni Firebase pentru temporizarea LED

Acest update adaugă `led_timer` sub fiecare cameră, de exemplu `/luci/sufragerie/led_timer` și `/luci/dormitor/led_timer`. Nu muta și nu șterge nodurile existente.

## Ce trebuie verificat

În Firebase Console, Realtime Database → Rules, verifică dacă utilizatorul aplicației poate scrie `led_timer`, iar contul ESP-ului poate publica telemetria camerei, inclusiv `timer_state`, `timer_supported` și `firmware`. Dacă regulile acordă deja aceste drepturi la nivelul camerei, este posibil să nu ai nevoie de o modificare.

Nu înlocui toate regulile cu exemplul din arhivă: acesta conține `UID_DISPOZITIV`, un marcaj de înlocuit, nu UID-ul real. Nu modifica nodul `admins` sau UID-urile care funcționează deja.

## Bloc de adăugat la regulile camerei

Dacă ai permisiuni separate pentru comenzile `releu`, `led_on` și `led_brightness`, adaugă blocul de mai jos lângă ele, în interiorul `rules → luci → $room`. Păstrează și celelalte reguli existente; verifică virgulele JSON dintre blocuri.

```json
"led_timer": {
  ".write": "auth != null",
  ".validate": "newData.hasChildren(['id','enabled','mode','action','hours','due_at','start','stop','timezone']) && (!newData.child('enabled').val() || newData.child('mode').val() !== 'daily' || newData.child('start').val() !== newData.child('stop').val())",
  "id": { ".validate": "newData.isString() && newData.val().matches(/^[A-Za-z0-9_-]{1,40}$/)" },
  "enabled": { ".validate": "newData.isBoolean()" },
  "mode": { ".validate": "newData.val() === 'delay' || newData.val() === 'daily'" },
  "action": { ".validate": "newData.val() === 'on' || newData.val() === 'off'" },
  "hours": { ".validate": "newData.isNumber() && newData.val() >= 0.01 && newData.val() <= 720" },
  "due_at": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() < 4102444800000" },
  "start": { ".validate": "newData.isString() && newData.val().matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)" },
  "stop": { ".validate": "newData.isString() && newData.val().matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)" },
  "timezone": { ".validate": "newData.val() === 'Europe/Bucharest' || newData.val() === 'Europe/Madrid' || newData.val() === 'Atlantic/Canary' || newData.val() === 'Europe/London' || newData.val() === 'UTC'" },
  "$other": { ".validate": false }
}
```

Acesta păstrează modelul exemplului aplicației pentru un singur client: oricine este autentificat în proiect poate scrie această comandă. Dacă ai restricții pe utilizator/client, nu folosi `.write: auth != null` ca lărgire a accesului; folosește aceeași condiție de autorizare specifică pe care o aplici comenzilor existente.

Nu da clientului drept de scriere în `admins`, `timer_state` sau telemetria dispozitivului. Nu seta global `.write: true` pentru a elimina o eroare de permisiuni.

## Verificare după modificare

Publică regulile numai după verificarea lor și testează o salvare din contul clientului. În camera actualizată trebuie să apară `led_timer`, apoi un `timer_state` cu același `id` și stare precum `armed`, `daily` sau `disabled`.

Dacă configurația apare în baza de date, dar nu vine confirmarea ESP-ului, verifică versiunea firmware-ului, `ROOM_ID`, conexiunea stream și dreptul contului dispozitivului de a scrie telemetria. Nu șterge camera ca metodă de reparare a permisiunilor.
