# RiskArena — Auth sistema (kaip veikia)

## Trumpai: kas yra session token?

Kai žaidėjas prisijungia per Telegram — serveris jam duoda "kortelę" (token).
Kiekvieną kartą kai žaidėjas daro request — parodo tą kortelę.
Serveris patikrina ar kortelė tikra ir kas tas žaidėjas.

---

## 1. Konstantos (auth.py viršus)

```python
SESSION_COOKIE = "arena_session"
# Vardas cookie kuris saugomas naršyklėje/app

SESSION_TTL_SECONDS = 86400
# Kiek laiko token galioja — 86400 sekundžių = 1 para

SESSION_SECRET = os.environ.get("SESSION_SECRET")
# Slaptas žodis kurį žino TIK serveris
# Iš .env failo — niekada nekeldamas į GitHub
# Naudojamas kaip "antspaudas" — be jo negalima sukurti tikro token
```

---

## 2. create_session_token() — token kūrimas

```python
def create_session_token(user_id: str) -> str:
```
Iškviečiama kai žaidėjas sėkmingai prisijungia per Telegram.
Grąžina string — tai ir yra token.

```python
    payload = {
        "user_id": str(user_id),   # kieno token — pvz "123"
        "exp": int(time.time()) + SESSION_TTL_SECONDS,
        # exp = expiration = kada baigiasi
        # time.time() = dabar (Unix timestamp)
        # + 86400 = rytoj tuo pačiu laiku
    }
```

```python
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    # payload → JSON string → bytes
    # sort_keys=True — kad visada ta pati tvarka (svarbu signature'ui)

    payload_part = _b64encode(payload_bytes)
    # bytes → base64 string
    # base64 = būdas perduoti binary duomenis kaip tekstą
    # pvz: {"user_id":"123"} → eyJ1c2VyX2lkIjoiMTIzIn0
```

```python
    signature = hmac.new(
        SESSION_SECRET.encode(),   # slaptas žodis
        payload_part.encode(),     # payload kurį "antspauduojame"
        hashlib.sha256             # algoritmas
    ).digest()
    # HMAC = Hash-based Message Authentication Code
    # Iš SECRET + PAYLOAD gaunamas unikalus "pirštų atspaudas"
    # Jei payload pasikeičia byteliu — signature visiškai kitoks
```

```python
    return f"{payload_part}.{_b64encode(signature)}"
    # Galutinis token = payload + "." + signature
    # Pvz: eyJ1c2VyX2lkIjoiMTIzIn0.a8f3k2j9xPqR...
    #       ^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^
    #            payload (matomas)      signature (apsauga)
```

### Kodėl payload matomas bet saugus?

Payload nėra šifruotas — jį galima decode'inti.
Bet pakeisti negalima — nes signature nebebus teisingas.
Serveris žino SECRET → gali patikrinti ar payload nepakeistas.

---

## 3. verify_session_token() — token tikrinimas

```python
def verify_session_token(token: str) -> Optional[str]:
```
Iškviečiama kiekvieno request metu.
Grąžina `user_id` jei token tikras, arba `None` jei ne.

```python
    if not token or "." not in token:
        return None
    # Bazinis patikrinimas — ar token apskritai egzistuoja
    # Tikras token visada turi tašką: payload.signature
```

```python
    payload_part, signature_part = token.split(".", 1)
    # Atskiriame payload nuo signature pagal tašką
```

```python
    expected = hmac.new(
        SESSION_SECRET.encode(),
        payload_part.encode(),
        hashlib.sha256
    ).digest()
    # Serveris PATS suskaičiuoja kaip turėtų atrodyti signature
    # naudodamas tą patį SECRET
```

```python
    supplied = _b64decode(signature_part)
    # Decode'iname signature kurį atsiuntė žaidėjas
```

```python
    if not hmac.compare_digest(expected, supplied):
        return None
    # Lyginame: ar serverio suskaičiuotas == atsiųstas?
    # compare_digest — specialus palyginimas apsaugantis nuo timing attacks
    # (paprastas == galėtų išduoti informaciją per atsakymo greitį)
    # Jei nesutampa — token suklastotas arba sugadintas → None
```

```python
    payload = json.loads(_b64decode(payload_part))
    # Decode'iname payload — gauname originalų dict
    # {"user_id": "123", "exp": 1234567890}
```

```python
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    # Ar token dar galioja?
    # exp < dabar → token pasibaigęs → None
    # Žaidėjas turės prisijungti iš naujo
```

```python
    return str(payload.get("user_id"))
    # Viskas gerai — grąžiname user_id
    # Serveris žino kas šis žaidėjas
```

---

## 4. get_authenticated_user_id() — kiekvieno request tikrinimas

```python
def get_authenticated_user_id(request: Request) -> str:
```
Iškviečiama kiekviename endpoint'e kuris reikalauja prisijungimo.

```python
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    # Pirma ieško Authorization header'yje
    # Frontend siunčia: Authorization: Bearer eyJ1c2VyX2lkIjoiMTIzIn0...
    # Tai API standartas — "Bearer token"
```

```python
    if not token:
        token = request.cookies.get(SESSION_COOKIE, "")
    # Jei header'yje nėra — ieško cookie "arena_session"
    # Cookie automatiškai siunčiamas naršyklės su kiekvienu request
```

```python
    user_id = verify_session_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id
    # Jei token netikras/pasibaigęs → 401 klaida
    # Frontend gauna 401 → nukreipia į prisijungimą
    # Jei viskas gerai → grąžina user_id endpoint'ui
```

---

## 5. Visas flow nuo prisijungimo iki request

```
1. Žaidėjas atidaro Telegram Mini App
         ↓
2. Telegram siunčia initData į frontend
         ↓
3. Frontend siunčia initData į /api/auth/telegram
         ↓
4. Serveris tikrina Telegram HMAC (ar tikras Telegram?)
         ↓
5. Serveris sukuria session token:
   create_session_token(user_id) → "eyJ...abc123"
         ↓
6. Token saugomas dviem būdais:
   - Cookie "arena_session" (naršyklė siunčia automatiškai)
   - localStorage "riskarena_user.session_token" (axios interceptor)
         ↓
7. Žaidėjas daro request (pvz. gauti inventory)
         ↓
8. get_authenticated_user_id() tikrina token
         ↓
9. verify_session_token() grąžina user_id
         ↓
10. Endpoint vykdo logiką su tuo user_id
```

---

## 6. Kodėl ne JWT?

JWT (JSON Web Token) yra populiarus standartas — panašus principas.
RiskArena naudoja custom HMAC variantą nes:
- Mažesnė bibliotekų priklausomybė
- Pilna kontrolė
- Funkcionalumas identiškas — payload + signature

Interviu jei klaustų: "Naudojame custom HMAC-SHA256 signed token — panašus į JWT bet be papildomų bibliotekų."

---

## 7. Svarbiausi terminai

| Terminas | Kas tai |
|----------|---------|
| `HMAC` | Algoritmas kuris iš duomenų + slapto žodžio sukuria unikalų "pirštų atspaudą" |
| `SHA256` | Hash funkcija — iš bet kokio teksto sukuria 256-bit skaičių |
| `base64` | Būdas perduoti binary duomenis kaip tekstą |
| `exp` | Expiration — kada token baigiasi |
| `Bearer token` | HTTP standartas kaip siųsti token header'yje |
| `401` | HTTP status "Unauthorized" — reikia prisijungti |
| `SESSION_SECRET` | Slaptas žodis tik serveryje — be jo negalima sukurti/patikrinti token |
