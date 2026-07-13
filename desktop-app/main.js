const { app, BrowserWindow, Tray, Menu, nativeImage, shell, session } = require('electron')
const { exec, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

let mainWindow = null
let tray = null
let splashWindow = null

app.commandLine.appendSwitch('ignore-certificate-errors')

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() }

app.on('second-instance', () => {
  if (mainWindow) { 
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus() 
  } else if (splashWindow) {
    if (splashWindow.isMinimized()) splashWindow.restore()
    splashWindow.show()
    splashWindow.focus()
  }
})

function getResourcePath(filename) {
  return app.isPackaged
    ? path.join(process.resourcesPath, filename)
    : path.join(__dirname, '..', filename)
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
}

function updateSplash(message) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.executeJavaScript(
      `document.getElementById('status').innerText = ${JSON.stringify(message)}`
    ).catch(() => {})
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'TDAI RIS/PACS — TrivitronDigital.ai',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  mainWindow.loadURL('https://localhost:5173')
  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
    }
    mainWindow.show()
    mainWindow.maximize()
  })
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow.hide()
  })
}

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault()
  callback(true)
})

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'))
  tray = new Tray(icon)
  tray.setToolTip('TDAI RIS/PACS')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open TDAI RIS/PACS', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: 'Stop All Services', click: () => {
        updateSplash('Stopping services...')
        const cwd = path.dirname(getResourcePath('docker-compose.yml'))
        exec('docker compose down', { cwd }, () => {
          app.exit(0)
        })
    }},
    { label: 'Quit', click: () => app.exit(0) }
  ]))
  tray.on('click', () => mainWindow && mainWindow.show())
}

async function checkAndStartDocker() {
  return new Promise((resolve, reject) => {
    // First check if Docker CLI is installed/available
    exec('docker --version', (err) => {
      if (err) {
        updateSplash('Docker Desktop not found.\nOpening download page...')
        setTimeout(() => {
          shell.openExternal('https://www.docker.com/products/docker-desktop/')
        }, 2000)
        setTimeout(() => app.exit(0), 5000)
        return
      }

      // Check if Docker engine is running
      exec('docker info', (err2) => {
        if (err2) {
          // Docker installed but not running
          updateSplash('Starting Docker Desktop...\nPlease wait (30-60 seconds)...')
          
          const possiblePaths = [
            'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
            'C:\\Program Files (x86)\\Docker\\Docker\\Docker Desktop.exe'
          ]
          let foundPath = null
          for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
              foundPath = p
              break
            }
          }

          if (foundPath) {
            exec(`start "" "${foundPath}"`, (err3) => {
              if (err3) {
                reject(new Error('Failed to run Docker Desktop executable automatically.'))
              } else {
                waitForDocker(resolve, reject)
              }
            })
          } else {
            updateSplash('Docker Desktop installer path not found.\nPlease start Docker Desktop manually.')
            setTimeout(() => app.exit(1), 6000)
          }
        } else {
          // Docker already running
          resolve()
        }
      })
    })
  })
}

function waitForDocker(resolve, reject) {
  let attempts = 0
  const maxAttempts = 24 // 24 * 5s = 2 minutes
  const interval = setInterval(() => {
    attempts++
    updateSplash(`Waiting for Docker to start...\n(${attempts * 5} seconds)`)
    
    exec('docker info', (err) => {
      if (!err) {
        clearInterval(interval)
        updateSplash('Docker is ready!')
        resolve()
      } else if (attempts >= maxAttempts) {
        clearInterval(interval)
        reject(new Error('Docker took too long to start.\nPlease start Docker Desktop manually and retry.'))
      }
    })
  }, 5000)
}

async function startServices() {
  const cwd = path.dirname(getResourcePath('docker-compose.yml'))
  const tarPath = getResourcePath('tdai-images.tar')

  // Step 1: Check if the custom image is already loaded locally
  let imageLoaded = false;
  try {
    imageLoaded = await new Promise((resolve) => {
      exec('docker images -q tdai-orthanc-custom:latest', (err, stdout) => {
        if (!err && stdout && stdout.trim().length > 0) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  } catch (e) {
    imageLoaded = false;
  }

  // Step 2: If the image does not exist locally, load it from the tar file
  if (!imageLoaded) {
    // Self-healing fallback: If tarPath doesn't exist, search user Downloads and Desktop folders
    if (!fs.existsSync(tarPath)) {
      const homeDir = require('os').homedir();
      const searchDirs = [
        path.join(homeDir, 'Downloads', 'TDAI-RIS-PACS'),
        path.join(homeDir, 'Desktop', 'TDAI-RIS-PACS'),
        path.join(homeDir, 'Downloads'),
        path.join(homeDir, 'Desktop')
      ];
      let foundPath = null;
      for (const dir of searchDirs) {
        const candidate = path.join(dir, 'tdai-images.tar');
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          foundPath = candidate;
          break;
        }
      }
      if (foundPath) {
        updateSplash('Copying components (this will take 1-2 mins)...');
        try {
          fs.copyFileSync(foundPath, tarPath);
          console.log(`Self-healing: copied tdai-images.tar from ${foundPath} to ${tarPath}`);
        } catch (e) {
          console.error("Self-healing copy failed:", e);
        }
      }
    }

    // Load images if tar exists
    if (fs.existsSync(tarPath)) {
      updateSplash('Loading components (first run: 3-5 mins)...')
      await new Promise((resolve, reject) => {
        exec(`docker load -i "${tarPath}"`, { cwd }, (err, stdout, stderr) => {
          if (err) {
            console.error("Docker load failed:", err, stderr);
            reject(new Error(`Failed to load components: ${stderr || err.message}`));
          } else {
            try {
              fs.unlinkSync(tarPath);
              console.log("Successfully loaded and deleted tdai-images.tar to reclaim disk space.");
            } catch (e) {
              console.error("Could not delete loaded tar file:", e);
            }
            resolve();
          }
        })
      })
    } else {
      // If we still don't have the images and the load failed, throw a descriptive setup error
      throw new Error("Pre-built Docker images not found.\nPlease make sure 'tdai-images.tar' is located in the unzipped folder next to the installer.");
    }
  } else {
    console.log("Docker images already loaded locally. Skipping docker load step.");
  }

  // Stop any previous session and force-remove any conflicting container names
  updateSplash('Cleaning up previous session...')
  await new Promise((resolve) => {
    exec('docker compose down', { cwd }, () => {
      exec('docker rm -f tdai-postgres orthanc dicoogle monai-server medasr-server reporting-app-backend reporting-app-frontend ohif-viewer', () => {
        resolve()
      })
    })
  })

  // Start services
  updateSplash('Starting 8 services...')
  await new Promise((resolve, reject) => {
    exec('docker compose up -d', { cwd }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })

  // Wait for frontend
  updateSplash('Waiting for system to be ready...')
  const waitOn = require('wait-on')
  await waitOn({
    resources: ['https://localhost:5173'],
    timeout: 180000,
    interval: 3000,
    strictSSL: false
  })
}

app.whenReady().then(async () => {
  createSplash()
  createTray()

  try {
    await session.defaultSession.clearCache()
    await session.defaultSession.clearStorageData()
  } catch (e) {
    console.error('Failed to clear cache:', e)
  }

  try {
    await checkAndStartDocker()
    await startServices()
    createMainWindow()
  } catch (err) {
    updateSplash(`Error: ${err.message}`)
    setTimeout(() => app.exit(1), 8000)
  }
})

app.on('window-all-closed', (e) => {
  e.preventDefault()
})
