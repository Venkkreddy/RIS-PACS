# TDAI RIS/PACS — Medical Imaging System

Welcome! This guide will help you get the system running on your computer.

---

## INSTALLATION METHODS

You can run the system either using the desktop installer app (recommended) or manually via scripts.

### Option 1: Installer (Recommended)
1. Run **`TDAI RIS-PACS Setup.exe`** from the `TDAI-RIS-PACS` distribution folder.
2. Install like any normal Windows app (a desktop shortcut will be created automatically).
3. Ensure Docker Desktop is installed.
4. Double-click the **TDAI RIS/PACS** desktop icon. The app will automatically check for and launch Docker silently in the background and open the workstation window. No CMD window or manual steps are needed!

### Option 2: Manual Startup (Advanced)
1. Download **Docker Desktop** from here:
   👉 https://www.docker.com/products/docker-desktop
2. Install it and restart your computer.
3. Open Docker Desktop and ensure it is running.
4. Double-click **`start.bat`** (Windows) or run `./start.sh` (Mac/Linux) in the `TDAI-RIS-PACS` folder.
5. Wait about 2–3 minutes on the first run, and the workstation will open automatically.

---

## STEP 3 — LOGIN

The system will open at: **https://localhost:5173**

Use any of these accounts to log in. The **password is the same for all accounts:**

| Email                        | Role          | Password         |
|------------------------------|---------------|------------------|
| super_admin@example.com      | Super Admin   | TDAI#Demo1234    |
| admin@example.com            | Admin         | TDAI#Demo1234    |
| radiologist@example.com      | Radiologist   | TDAI#Demo1234    |
| radiographer@example.com     | Radiographer  | TDAI#Demo1234    |
| developer@example.com        | Developer     | TDAI#Demo1234    |
| billing@example.com          | Billing       | TDAI#Demo1234    |
| reception@example.com        | Reception     | TDAI#Demo1234    |
| viewer@example.com           | Viewer        | TDAI#Demo1234    |

> **Note:** Your browser may show a security warning because the system uses a
> self-signed certificate. This is normal. Click **"Advanced"** → **"Proceed"**
> (or "Accept the Risk") to continue.

---

## STEP 4 — STOP THE SYSTEM

When you're done, stop the system to free up your computer's resources:

- **Windows:** Double-click **`stop.bat`**
- **Mac/Linux:** Double-click **`stop.sh`**

You can start it again anytime by repeating Step 2.

---

## TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| **Browser didn't open** | Open your browser manually and go to **https://localhost:5173** |
| **"Docker is not running" error** | Open Docker Desktop first, wait until it says "Running", then try again |
| **"Port already in use" error** | Restart your computer and try again |
| **System is slow on first run** | The first start takes longer because it loads all components. After that, it starts in under a minute. |
| **Page shows "connection refused"** | Wait 1–2 more minutes — the system may still be loading |

---

## NEED HELP?

If you're stuck, contact the TDAI support team:

- 📧 Email: **support@tdai.in**
- 📞 Phone: **+91 98765 43210**

Please include a screenshot of any error message when reaching out.

---

*TDAI RIS/PACS v1.0 — Radiology Information & Picture Archiving System*
