# TDAI RIS/PACS — Medical Imaging System

Welcome! This guide will help you get the system running on your computer.

---

## STEP 1 — ONE-TIME SETUP (do this only once)

1. Download **Docker Desktop** from here:
   👉 https://www.docker.com/products/docker-desktop

2. Install it — just follow the on-screen instructions (click Next, Next, Finish).

3. **Restart your computer** after installing.

4. Open Docker Desktop and wait until it says **"Docker Desktop is running"** in the bottom-left corner.

That's it! You only need to do this once.

---

## STEP 2 — START THE SYSTEM

1. Make sure **Docker Desktop is open** and running.

2. Open the `TDAI-RIS-PACS` folder you received.

3. Start the system:
   - **Windows:** Double-click **`start.bat`**
   - **Mac/Linux:** Double-click **`start.sh`**

4. Wait about **2–3 minutes** on the first run. You'll see a progress indicator.

5. Your browser will **open automatically** when the system is ready.

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
