# Azure Push Notifications Setup

**Goal:** Connect Azure Notification Hubs + Firebase + Apple so closed mobile apps wake up when a disaster is triggered.

**Status:** All code is ready. You're doing the account logins and copying credentials.

---

## Quick Overview

| System | Your action | Gets you |
|---|---|---|
| **Azure** | Log in → get connection string | Backend delivery pipeline |
| **Firebase** | Create Android app → get `google-services.json` + service account | Android (FCM) delivery |
| **Apple Developer** | Create push key → get `.p8` file + IDs | iOS (APNs) delivery |
| **Expo (EAS)** | Run `npx eas login` | Ability to build native apps |

Once these are wired, a disaster trigger fires **two** paths:
1. **Socket.IO** (while app is running) → instant alert
2. **Azure NH push** (even if closed) → native OS notification → opens app → disaster gate

---

## Step 1: Azure Portal — Get the Connection String

### Option A: Azure CLI (fastest)

```bash
az login
```

Choose your subscription, then run:

```bash
az notification-hub authorization-rule list-keys \
  --resource-group report-safe-rg \
  --namespace-name report-safe-ns \
  --notification-hub-name report-safe-hub \
  --name DefaultFullSharedAccessSignature \
  --query primaryConnectionString -o tsv
```

**Output:** a long string starting with `Endpoint=sb://`

### Option B: Azure Portal (point-and-click)

1. portal.azure.com → search **Notification Hubs**
2. Click your hub → **Access Policies**
3. Click `DefaultFullSharedAccessSignature` → copy **Connection string–primary key**

### Next: Save It

Copy the string (either way) and paste into `.env.prod`:

```bash
AZURE_NH_CONNECTION_STRING=Endpoint=sb://report-safe-ns.servicebus.windows.net/;SharedAccessKeyName=DefaultFullSharedAccessSignature;SharedAccessKey=AbCdEfGh...==
AZURE_NH_HUB_NAME=report-safe-hub
```

✓ Backend now has what it needs.

---

## Step 2: Firebase Console — Android Delivery (FCM)

### 2.1 Create a Firebase project

1. Go to **console.firebase.google.com**
2. Click **Add project** → name it `report-safe`
3. Disable Google Analytics (optional) → **Create project**
4. Wait for it to initialize (~1 min)

### 2.2 Add an Android app

1. Home → click the **Android** icon (Android app icon)
2. Package name: `com.reportsafe.app` ← matches `mobile/app.json`
3. App nickname: `Report Safe Android`
4. Click **Register app**
5. **Download** `google-services.json`

### 2.3 Where does `google-services.json` go?

```
mobile/google-services.json  ← EAS will read this when building
```

This file is **already gitignored** — it contains credentials, so it stays local.

### 2.4 Wire Firebase to Azure

Now get the **service account** (different from `google-services.json`):

1. Firebase Console → **Project Settings** (⚙️, top-left)
2. Tab: **Service Accounts**
3. Click **Generate New Private Key**
4. You get a JSON file. Do NOT save it locally — open it and copy the contents.

Then in Azure:

1. portal.azure.com → your Notification Hub
2. **Settings** → **Google (FCM v1)**
3. Paste the **entire service-account JSON** into the text box
4. Click **Save**

✓ Android delivery now works.

---

## Step 3: Apple Developer — iOS Delivery (APNs)

### 3.1 Create an APNs key

1. Go to **developer.apple.com** → sign in with your Apple ID
2. **Certificates, IDs & Profiles** (left sidebar)
3. Tab: **Keys**
4. Click **+** button
5. Name it `Report Safe Push`
6. Check **Apple Push Notifications service (APNs)**
7. Click **Create**
8. **Download** the `.p8` file (one-time offer — Apple won't show it again)

### 3.2 Get your Key ID and Team ID

- **Key ID:** shown on the Keys page next to your new key (e.g., `5A6B7C8D9E`)
- **Team ID:** top-right corner of developer.apple.com (e.g., `AB12CD34EF`)

Copy both.

### 3.3 Wire to Azure

1. portal.azure.com → your Notification Hub
2. **Settings** → **Apple (APNS)**
3. Auth mode: **Token** (recommended) or **Certificate**
4. Upload your `.p8` file
5. Enter:
   - **Key ID**: `5A6B7C8D9E`
   - **Team ID**: `AB12CD34EF`
6. **Application Mode**: set to **Production** (for release builds)
7. Click **Save**

✓ iOS delivery now works.

---

## Step 4: Build the Mobile App (EAS)

The app can't actually register a native push handle (FCM/APNs) in Expo Go — you must build a standalone app.

### 4.1 Log into Expo

```bash
cd mobile
npx eas login
# Opens a browser → sign in with your Expo account (create one if needed)
```

### 4.2 Edit `eas.json` to point at your backend

Open `mobile/eas.json` and find `EXPO_PUBLIC_API_URL`. Update it:

```json
"preview": {
  "env": {
    "EXPO_PUBLIC_API_URL": "https://yourdomain.com"
  }
},
"production": {
  "env": {
    "EXPO_PUBLIC_API_URL": "https://yourdomain.com"
  }
}
```

(Keep `development` as `http://localhost:3001` if you're testing locally.)

### 4.3 Place `google-services.json` in `mobile/`

The file you downloaded from Firebase in Step 2.3 → drop it in:

```
mobile/google-services.json
```

### 4.4 Build Android

```bash
npx eas build --platform android --profile production
```

Takes ~10–15 minutes. When done, you get a download link for the `.apk` or the ability to upload to Google Play.

### 4.5 Build iOS

```bash
npx eas build --platform ios --profile production
```

Takes ~20–30 minutes. Outputs a `.ipa` file.

**First time?** EAS may ask to set up provisioning — follow the prompts.

### 4.6 Install on real devices

- **Android:** Download the APK from EAS → install on a test phone
- **iOS:** Download the `.ipa` → use Xcode / Apple Configurator 2 / TestFlight to install

---

## Step 5: Test End-to-End

### 5.1 Bring your backend online

```bash
# Edit .env.prod with all your secrets:
# - AZURE_NH_CONNECTION_STRING
# - AZURE_NH_HUB_NAME
# - DATABASE_URL (PostgreSQL)
# - GOV_TOKEN (something strong)
# - DOMAIN (your public domain)

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# Or deploy to Azure
```

### 5.2 Open the app on a real phone

- Launch the installed build (not Expo Go)
- Grant notification permission when prompted
- Let it sit for 5 seconds (registers location + push handle)
- Check backend logs for: `[device] Device registered: token=...`

### 5.3 Trigger a test disaster

From your machine:

```bash
curl -X POST https://yourdomain.com/api/disasters/trigger \
  -H "Authorization: Bearer <YOUR_GOV_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "typhoon",
    "severity": 5,
    "lat": 22.3,
    "lng": 114.17,
    "radius_km": 50
  }'
```

### 5.4 Verify

✓ **Phone (even if app is closed):**
- Gets a native banner notification
- Tapping it opens the app → disaster-mode gate

✓ **Backend logs:**
```
push_disaster_sent {disasterId: "...", sent: 1, failed: 0, skipped: 0}
```

✓ **Device table is clean:**
- Dead/stale handles (410/404 from Azure) are auto-deleted
- Table only holds active, responsive tokens

---

## Credential Cheat Sheet

Print this or bookmark it:

| What | From | Goes to | File/Env Var |
|---|---|---|---|
| NH connection string | Azure portal → Access Policies | Backend | `.env.prod` → `AZURE_NH_CONNECTION_STRING` |
| Hub name | You choose it (e.g., `report-safe-hub`) | Backend | `.env.prod` → `AZURE_NH_HUB_NAME` |
| `google-services.json` | Firebase → Android app | Mobile build | `mobile/google-services.json` |
| FCM service-account JSON | Firebase → Service Accounts | Azure portal → Google (FCM v1) | Pasted in the portal |
| `.p8` file | Apple Developer → Keys | Azure portal → Apple (APNS) | Uploaded in the portal |
| Key ID | Apple Developer → Keys page | Azure portal → Apple (APNS) | Text field in the portal |
| Team ID | Apple Developer → top-right | Azure portal → Apple (APNS) | Text field in the portal |

---

## Common Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| `google-services.json` in wrong location | Build fails with "services not found" | Place it in `mobile/google-services.json` exactly |
| EXPO_PUBLIC_API_URL points to localhost in prod build | App can't reach backend | Edit `mobile/eas.json` before building |
| APNs mode is Sandbox in Azure, but you're testing a Production build | iOS pushes silently fail (no error, no notification) | Set Azure APNS to **Production** |
| Device `lat`/`lng` is NULL in the database | Push never fires (you're outside the disaster radius) | Make sure the app has location permission + took a GPS reading |
| `AZURE_NH_CONNECTION_STRING` malformed | Backend logs `push_bad_connection_string` | Copy the full string from Azure; check for typos |

---

## Graceful Degradation

**If any step is incomplete:**

- **No Azure NH config** → pushes silently skip (local push still works, app wakes on socket if running)
- **No Firebase/APNs config in Azure** → relevant platform gets `400 Bad Request` (logged, doesn't crash)
- **Device offline when disaster fires** → gets push when it reconnects (Azure NH queues for ~24h)

**The app always falls back to the socket path** — if a device is running, it gets the alert via Socket.IO. Remote push is a *supplement*, not a requirement.

---

## Next Steps (After Setup)

1. **Test locally first:** Use `docker compose.yml` + `npx eas build --profile development` for faster iteration
2. **Monitor in production:** Check logs for `push_disaster_sent` and device registration counts
3. **Prune stale tokens:** Dead tokens (410/404) are auto-deleted; monitor `device_push_tokens` table size
4. **Scale up:** Multi-instance setup in `docker-compose.prod.yml` uses Redis to sync Socket.IO across replicas

---

## Questions?

- **Firebase issue?** Check [Firebase docs](https://firebase.google.com/docs)
- **Apple issue?** Check [Apple Push Notification docs](https://developer.apple.com/documentation/usernotifications)
- **Azure issue?** Check [Azure Notification Hubs docs](https://learn.microsoft.com/en-us/azure/notification-hubs)
- **Code issue?** Backend logs will say `push_skipped_unconfigured` or `push_bad_connection_string`

Everything is wired. You've got this. 🚀
